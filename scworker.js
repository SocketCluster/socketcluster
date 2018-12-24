const socketClusterServer = require('socketcluster-server');
const AsyncStreamEmitter = require('async-stream-emitter');
const uuid = require('uuid');
const http = require('http');
const https = require('https');
const async = require('async');
const AuthEngine = require('sc-auth').AuthEngine;

const scErrors = require('sc-errors');
const InvalidActionError = scErrors.InvalidActionError;
const ResourceLimitError = scErrors.ResourceLimitError;
const BrokerError = scErrors.BrokerError;
const HTTPServerError = scErrors.HTTPServerError;
const TimeoutError = scErrors.TimeoutError;

const workerInitOptions = JSON.parse(process.env.workerInitOptions);
let processTermTimeout = 10000;

let handleError = function (isFatal, err) {
  let error = scErrors.dehydrateError(err, true);
  process.send({
    type: 'error',
    data: {
      error: error,
      workerPid: process.pid
    }
  }, null, () => {
    if (isFatal) {
      process.exit(1);
    }
  });
};

let handleWarning = function (warning) {
  warning = scErrors.dehydrateError(warning, true);
  process.send({
    type: 'warning',
    data: {
      error: warning,
      workerPid: process.pid
    }
  });
};

let handleReady = function () {
  process.send({type: 'ready'});
};

let handleExit = function () {
  process.exit();
};

let scWorker;

function SCWorker(options) {
  AsyncStreamEmitter.call(this);

  if (scWorker) {
    // SCWorker is a singleton; it can only be instantiated once per process.
    throw new InvalidActionError('Attempted to instantiate a worker which has already been instantiated');
  }
  options = options || {};
  scWorker = this;

  this.type = 'worker';
  this.isTerminating = false;
  this._pendingResponseHandlers = {};

  if (options.run != null) {
    this.run = options.run;
  }
  if (options.createHTTPServer != null) {
    this.createHTTPServer = options.createHTTPServer;
  }

  let workerOptions = Object.assign({}, options, workerInitOptions);
  this._init(workerOptions);
}

SCWorker.prototype = Object.create(AsyncStreamEmitter.prototype);

SCWorker.create = function (options) {
  return new SCWorker(options);
};

SCWorker.EVENT_ERROR = SCWorker.prototype.EVENT_ERROR = 'error';
SCWorker.EVENT_WARNING = SCWorker.prototype.EVENT_WARNING = 'warning';
SCWorker.EVENT_EXIT = SCWorker.prototype.EVENT_EXIT = 'exit';
SCWorker.EVENT_READY = SCWorker.prototype.EVENT_READY = 'ready';
SCWorker.EVENT_CONNECTION = SCWorker.prototype.EVENT_CONNECTION = 'connection';
SCWorker.MIDDLEWARE_START = SCWorker.prototype.MIDDLEWARE_START = 'start';

SCWorker.prototype.setAuthEngine = function (authEngine) {
  this.auth = authEngine;

  this.httpServer.auth = this.auth;
  this.scServer.setAuthEngine(this.auth);
};

SCWorker.prototype.setCodecEngine = function (codecEngine) {
  this.codec = codecEngine;
  this.scServer.setCodecEngine(this.codec);
};

SCWorker.prototype._init = async function (options) {
  this.options = {};

  Object.assign(this.options, options);

  if (this.options.processTermTimeout) {
    processTermTimeout = this.options.processTermTimeout;
  }

  if (this.options && this.options.protocolOptions && this.options.protocolOptions.pfx) {
    this.options.protocolOptions.pfx = Buffer.from(this.options.protocolOptions.pfx, 'base64');
  }

  if (typeof this.options.authKey === 'object' && this.options.authKey !== null && this.options.authKey.type === 'Buffer') {
    this.options.authKey = Buffer.from(this.options.authKey.data, 'base64');
  }

  if (this.options.propagateErrors) {
    (async () => {
      for await (let {error} of this.listener('error')) {
        handleError(this.options.crashWorkerOnError, error);
      }
    })();
    if (this.options.propagateWarnings) {
      (async () => {
        for await (let {warning} of this.listener('warning')) {
          handleWarning(warning);
        }
      })();
    }
    (async () => {
      for await (let event of this.listener('exit')) {
        handleExit();
      }
    })();
  }

  (async () => {
    for await (let event of this.listener(this.EVENT_READY)) {
      try {
        await this.start();
        handleReady();
      } catch (err) {
        this.emitError(err);
      }
    }
  })();

  this.id = this.options.id;
  this.isLeader = this.id === 0;

  this._middleware = {};
  this._middleware[this.MIDDLEWARE_START] = [];

  if (this.options.downgradeToUser && process.setuid) {
    try {
      process.setuid(this.options.downgradeToUser);
    } catch (err) {
      throw new InvalidActionError(
        `Could not downgrade to user "${this.options.downgradeToUser}"` +
        ` - Either this user does not exist or the current process does not have the permission` +
        ` to switch to it`
      );
    }
  }

  this.brokerEngine = require(this.options.brokerEngine);

  this._paths = options.paths;

  this._httpRequestCount = 0;
  this._wsRequestCount = 0;
  this._httpRPM = 0;
  this._wsRPM = 0;

  this.brokerEngineClient = new this.brokerEngine.Client({
    brokers: this.options.brokers,
    secretKey: this.options.secretKey,
    pubSubBatchDuration: this.options.pubSubBatchDuration,
    connectRetryErrorThreshold: this.options.brokerConnectRetryErrorThreshold
  });

  (async () => {
    for await (let {error} of this.brokerEngineClient.listener('error')) {
      let err;
      if (typeof error === 'string') {
        err = new BrokerError(error);
      } else {
        err = error;
      }
      this.emitError(err);
    }
  })();

  (async () => {
    for await (let {warning} of this.brokerEngineClient.listener('warning')) {
      this.emitWarning(warning);
    }
  })();

  this.exchange = this.brokerEngineClient.exchange();

  let createHTTPServerResult = this.createHTTPServer();
  try {
    this.httpServer = await Promise.resolve(createHTTPServerResult);
  } catch (err) {
    this.emitError(err);
    return;
  }
  this.httpServer.on('request', this._httpRequestHandler.bind(this)); // TODO 2: support stream emitter
  this.httpServer.on('upgrade', this._httpRequestHandler.bind(this));

  this.httpServer.exchange = this.exchange;

  this.httpServer.on('error', (err) => {
    let error;
    if (typeof err === 'string') {
      error = new HTTPServerError(err);
    } else {
      error = err;
    }
    this.emitError(error);
  });

  this.scServer = socketClusterServer.attach(this.httpServer, {
    brokerEngine: this.brokerEngineClient,
    wsEngine: this._paths.wsEnginePath,
    allowClientPublish: this.options.allowClientPublish,
    handshakeTimeout: this.options.handshakeTimeout,
    ackTimeout: this.options.ackTimeout,
    pingTimeout: this.options.pingTimeout,
    pingInterval: this.options.pingInterval,
    pingTimeoutDisabled: this.options.pingTimeoutDisabled,
    origins: this.options.origins,
    appName: this.options.appName,
    path: this.options.path,
    authKey: this.options.authKey,
    authPrivateKey: this.options.authPrivateKey,
    authPublicKey: this.options.authPublicKey,
    authAlgorithm: this.options.authAlgorithm,
    authVerifyAlgorithms: this.options.authVerifyAlgorithms,
    authSignAsync: this.options.authSignAsync,
    authVerifyAsync: this.options.authVerifyAsync,
    authDefaultExpiry: this.options.authDefaultExpiry,
    middlewareEmitWarnings: this.options.middlewareEmitWarnings,
    socketChannelLimit: this.options.socketChannelLimit,
    pubSubBatchDuration: this.options.pubSubBatchDuration,
    perMessageDeflate: this.options.perMessageDeflate,
    maxPayload: this.options.maxPayload,
    wsEngineServerOptions: this.options.wsEngineServerOptions
  });

  if (this.brokerEngineClient.setSCServer) {
    this.brokerEngineClient.setSCServer(this.scServer);
  }

  if (options.authEngine) {
    this.setAuthEngine(options.authEngine);
  } else {
    // Default authentication engine
    this.setAuthEngine(new AuthEngine());
  }
  if (options.codecEngine) {
    this.setCodecEngine(options.codecEngine);
  } else {
    this.codec = this.scServer.codec;
  }

  this._socketPath = this.scServer.getPath();

  (async () => {
    for await (let {socket} of this.scServer.listener('connection')) {
      // The connection event counts as a WS request
      this._wsRequestCount++;
      (async () => {
        for await (let {message} of socket.listener('message')) {
          this._wsRequestCount++;
        }
      })();
      this.emit(this.EVENT_CONNECTION, {socket});
    }
  })();

  (async () => {
    for await (let {error} of this.scServer.listener('error')) {
      this.emitError(error);
    }
  })();

  (async () => {
    for await (let {warning} of this.scServer.listener('warning')) {
      this.emitWarning(warning);
    }
  })();

  if (!this.scServer.isReady) {
    await this.scServer.listener('ready').once();
  }
  this.emit(this.EVENT_READY, {});
};

SCWorker.prototype.createHTTPServer = function () {
  let httpServer;
  if (this.options.protocol === 'https') {
    httpServer = https.createServer(this.options.protocolOptions);
  } else {
    httpServer = http.createServer();
  }
  return httpServer;
};

// To be overriden.
SCWorker.prototype.run = function () {};

SCWorker.prototype.open = function () {
  this.startHTTPServer();
};

SCWorker.prototype.close = function (callback) {
  this.scServer.close();
  this.httpServer.close(callback);
};

SCWorker.prototype.getSocketPath = function () {
  return this._socketPath;
};

SCWorker.prototype.addMiddleware = function (type, middleware) {
  this._middleware[type].push(middleware);
};

SCWorker.prototype.removeMiddleware = function (type, middleware) {
  let middlewareFunctions = this._middleware[type];

  this._middleware[type] = middlewareFunctions.filter((fn) => {
    return fn !== middleware;
  });
};

SCWorker.prototype.startHTTPServer = function () {
  let options = this.options;

  let start = () => {
    if (options.tcpSynBacklog != null) {
      this.httpServer.listen(options.sourcePort, options.host, options.tcpSynBacklog);
    } else if (options.host != null) {
      this.httpServer.listen(options.sourcePort, options.host);
    } else {
      this.httpServer.listen(options.sourcePort);
    }
  };

  let startMiddleware = this._middleware[this.MIDDLEWARE_START];
  if (startMiddleware.length) {
    let callbackInvoked = false;

    async.applyEachSeries(startMiddleware, options, (err) => {
      if (callbackInvoked) {
        this.emitWarning(
          new InvalidActionError(`Callback for ${this.MIDDLEWARE_START} middleware was already invoked`)
        );
      } else {
        callbackInvoked = true;
        if (err) {
          throw err;
        } else {
          start();
        }
      }
    });
  } else {
    start();
  }
};

SCWorker.prototype.start = async function () {
  this._httpRequestCount = 0;
  this._wsRequestCount = 0;
  this._httpRPM = 0;
  this._wsRPM = 0;

  if (this._statusInterval != null) {
    clearInterval(this._statusInterval);
  }
  this._statusInterval = setInterval(this._calculateStatus.bind(this), this.options.workerStatusInterval);

  let runResult = this.run();

  await Promise.resolve(runResult);
  this.startHTTPServer();
};

SCWorker.prototype._httpRequestHandler = function (req, res) {
  this._httpRequestCount++;

  req.exchange = this.exchange;

  let forwardedFor = req.headers['x-forwarded-for'];

  if (forwardedFor) {
    let forwardedClientIP;
    if (forwardedFor.indexOf(',') > -1) {
      forwardedClientIP = forwardedFor.split(',')[0];
    } else {
      forwardedClientIP = forwardedFor;
    }
    req.forwardedForAddress = forwardedClientIP;
  }
  if (req.connection) {
    req.remoteAddress = req.connection.remoteAddress;
    req.remoteFamily = req.connection.remoteFamily;
    req.remotePort = req.connection.remotePort;
  } else if (req.socket) {
    req.remoteAddress = req.socket.remoteAddress;
    req.remoteFamily = req.socket.remoteFamily;
    req.remotePort = req.socket.remotePort;
  }
};

SCWorker.prototype.getSCServer = function () {
  return this.scServer;
};

SCWorker.prototype.getHTTPServer = function () {
  return this.httpServer;
};

SCWorker.prototype._calculateStatus = function () {
  let perMinuteFactor = 60000 / this.options.workerStatusInterval;
  this._httpRPM = this._httpRequestCount * perMinuteFactor;
  this._wsRPM = this._wsRequestCount * perMinuteFactor;
  this._httpRequestCount = 0;
  this._wsRequestCount = 0;

  let memThreshold = this.options.killWorkerMemoryThreshold;

  if (memThreshold != null) {
    let memoryUsage = process.memoryUsage();
    if (memoryUsage.heapUsed > memThreshold) {
      let message = `Worker killed itself because its memory `;
      message += `usage of ${memoryUsage.heapUsed} exceeded `;
      message += `the killWorkerMemoryThreshold of ${memThreshold}`;
      let warning = new ResourceLimitError(message);
      this.emitWarning(warning);
      process.exit();
    }
  }
};

SCWorker.prototype.getStatus = function () {
  return {
    clientCount: this.scServer.clientsCount,
    httpRPM: this._httpRPM,
    wsRPM: this._wsRPM
  };
};

SCWorker.prototype._createIPCResponseHandler = function (callback) {
  let cid = uuid.v4();

  let responseTimeout = setTimeout(() => {
    let responseHandler = this._pendingResponseHandlers[cid];
    delete this._pendingResponseHandlers[cid];
    let timeoutError = new TimeoutError('IPC response timed out');
    responseHandler.callback(timeoutError);
  }, this.options.ipcAckTimeout);

  this._pendingResponseHandlers[cid] = {
    callback: callback,
    timeout: responseTimeout
  };

  return cid;
};

SCWorker.prototype.handleMasterResponse = function (message) {
  let responseHandler = this._pendingResponseHandlers[message.rid];
  if (responseHandler) {
    clearTimeout(responseHandler.timeout);
    delete this._pendingResponseHandlers[message.rid];
    let properError = scErrors.hydrateError(message.error, true);
    responseHandler.callback(properError, message.data);
  }
};

// TODO 2: Test
SCWorker.prototype.sendRequestToMaster = function (data) {
  let messagePacket = {
    type: 'workerRequest',
    data: data,
    workerId: this.id
  };
  return new Promise((resolve, reject) => {
    messagePacket.cid = this._createIPCResponseHandler((err, data) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(data);
    });
    process.send(messagePacket);
  });
};

SCWorker.prototype.sendMessageToMaster = function (data) {
  let messagePacket = {
    type: 'workerMessage',
    data: data,
    workerId: this.id
  };
  process.send(messagePacket);
  return Promise.resolve();
};

SCWorker.prototype.respondToMaster = function (err, data, rid) {
  process.send({
    type: 'workerResponse',
    error: scErrors.dehydrateError(err, true),
    data: data,
    workerId: this.id,
    rid: rid
  });
};

SCWorker.prototype.handleMasterEvent = function () {
  this.emit.apply(this, arguments);
};

SCWorker.prototype.handleMasterMessage = function (message) {
  this.emit('masterMessage', {data: message.data});
};

SCWorker.prototype.handleMasterRequest = function (request) {
  this.emit('masterRequest', {
    data: request.data,
    end: (data) => {
      this.respondToMaster(null, data, request.cid);
    },
    error: (err) => {
      this.respondToMaster(err, null, request.cid);
    }
  });
};

SCWorker.prototype.emitError = function (error) {
  this.emit(this.EVENT_ERROR, {error});
};

SCWorker.prototype.emitWarning = function (warning) {
  this.emit(this.EVENT_WARNING, {warning});
};

let handleWorkerClusterMessage = function (wcMessage) {
  if (wcMessage.type === 'terminate') {
    if (scWorker && !wcMessage.data.immediate) {
      if (!scWorker.isTerminating) {
        scWorker.isTerminating = true;
        scWorker.close(() => {
          process.exit();
        });
        setTimeout(() => {
          process.exit();
        }, processTermTimeout);
      }
    } else {
      process.exit();
    }
  } else {
    if (!scWorker) {
      throw new InvalidActionError(`Attempted to send ${wcMessage.type} to worker ${workerInitOptions.id} before it was instantiated`);
    }
    if (wcMessage.type === 'emit') {
      if (wcMessage.data) {
        scWorker.handleMasterEvent(wcMessage.event, wcMessage.data);
      } else {
        scWorker.handleMasterEvent(wcMessage.event);
      }
    } else if (wcMessage.type === 'masterMessage') {
      scWorker.handleMasterMessage(wcMessage);
    } else if (wcMessage.type === 'masterRequest') {
      scWorker.handleMasterRequest(wcMessage);
    } else if (wcMessage.type === 'masterResponse') {
      scWorker.handleMasterResponse(wcMessage);
    }
  }
};

process.on('message', handleWorkerClusterMessage);

process.on('uncaughtException', (err) => {
  handleError(workerInitOptions.crashWorkerOnError, err);
});

module.exports = SCWorker;
