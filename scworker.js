var socketClusterServer = require('socketcluster-server');
var EventEmitter = require('events').EventEmitter;
var uuid = require('uuid');
var http = require('http');
var https = require('https');
var async = require('async');
var AuthEngine = require('sc-auth').AuthEngine;

var scErrors = require('sc-errors');
var InvalidActionError = scErrors.InvalidActionError;
var ResourceLimitError = scErrors.ResourceLimitError;
var BrokerError = scErrors.BrokerError;
var HTTPServerError = scErrors.HTTPServerError;
var TimeoutError = scErrors.TimeoutError;

var processTermTimeout = 10000;
var workerInitOptions = JSON.parse(process.env.workerInitOptions);

var handleError = function (isFatal, err) {
  var error = scErrors.dehydrateError(err, true);
  process.send({
    type: 'error',
    data: {
      error: error,
      workerPid: process.pid
    }
  }, null, function () {
    if (isFatal) {
      process.exit(1);
    }
  });
};

var handleWarning = function (warning) {
  warning = scErrors.dehydrateError(warning, true);
  process.send({
    type: 'warning',
    data: {
      error: warning,
      workerPid: process.pid
    }
  });
};

var handleReady = function () {
  process.send({type: 'ready'});
};

var handleExit = function () {
  process.exit();
};

var scWorker;

function SCWorker(options) {
  if (scWorker) {
    // SCWorker is a singleton; it can only be instantiated once per process.
    throw new InvalidActionError('Attempted to instantiate a worker which has already been instantiated');
  }
  options = options || {};
  scWorker = this;

  this.type = 'worker';
  this.isTerminating = false;
  this._pendingResponseHandlers = {};

  this._listenerDemux = new StreamDemux();

  if (options.run != null) {
    this.run = options.run;
  }
  if (options.createHTTPServer != null) {
    this.createHTTPServer = options.createHTTPServer;
  }

  var workerOptions = Object.assign({}, options, workerInitOptions);
  this._init(workerOptions);
}

SCWorker.create = function (options) {
  return new SCWorker(options);
};

SCWorker.prototype = Object.create(EventEmitter.prototype);

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

SCWorker.prototype._init = function (options) {
  var self = this;

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
      throw new InvalidActionError('Could not downgrade to user "' + this.options.downgradeToUser +
        '" - Either this user does not exist or the current process does not have the permission' +
        ' to switch to it');
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

  var createHTTPServerResult = this.createHTTPServer();
  // TODO 2: Use this instead of self
  // TODO 2: Use let and const instead of var
  // TODO 2: Use async/await instead of .then() and .catch()
  Promise.resolve(createHTTPServerResult)
  .then(function (httpServer) {
    self.httpServer = httpServer;
    self.httpServer.on('request', self._httpRequestHandler.bind(self));
    self.httpServer.on('upgrade', self._httpRequestHandler.bind(self));

    self.httpServer.exchange = self.exchange;

    self.httpServer.on('error', function (err) {
      var error;
      if (typeof err === 'string') {
        error = new HTTPServerError(err);
      } else {
        error = err;
      }
      self.emitError(error);
    });

    self.scServer = socketClusterServer.attach(self.httpServer, {
      brokerEngine: self.brokerEngineClient,
      wsEngine: self._paths.wsEnginePath,
      allowClientPublish: self.options.allowClientPublish,
      handshakeTimeout: self.options.handshakeTimeout,
      ackTimeout: self.options.ackTimeout,
      pingTimeout: self.options.pingTimeout,
      pingInterval: self.options.pingInterval,
      pingTimeoutDisabled: self.options.pingTimeoutDisabled,
      origins: self.options.origins,
      appName: self.options.appName,
      path: self.options.path,
      authKey: self.options.authKey,
      authPrivateKey: self.options.authPrivateKey,
      authPublicKey: self.options.authPublicKey,
      authAlgorithm: self.options.authAlgorithm,
      authVerifyAlgorithms: self.options.authVerifyAlgorithms,
      authSignAsync: self.options.authSignAsync,
      authVerifyAsync: self.options.authVerifyAsync,
      authDefaultExpiry: self.options.authDefaultExpiry,
      middlewareEmitWarnings: self.options.middlewareEmitWarnings,
      socketChannelLimit: self.options.socketChannelLimit,
      pubSubBatchDuration: self.options.pubSubBatchDuration,
      perMessageDeflate: self.options.perMessageDeflate,
      maxPayload: self.options.maxPayload,
      wsEngineServerOptions: self.options.wsEngineServerOptions
    });

    if (self.brokerEngineClient.setSCServer) {
      self.brokerEngineClient.setSCServer(self.scServer);
    }

    if (options.authEngine) {
      self.setAuthEngine(options.authEngine);
    } else {
      // Default authentication engine
      self.setAuthEngine(new AuthEngine());
    }
    if (options.codecEngine) {
      self.setCodecEngine(options.codecEngine);
    } else {
      self.codec = self.scServer.codec;
    }

    self._socketPath = self.scServer.getPath();

    (async () => {
      for await (let {socket} of self.scServer.listener('connection')) {
        // The connection event counts as a WS request
        self._wsRequestCount++;
        (async () => {
          for await (let {message} of socket.listener('message')) {
            self._wsRequestCount++;
          }
        })();
        self.emit(self.EVENT_CONNECTION, socket);
      }
    })();

    (async () => {
      for await (let {error} of self.scServer.listener('error')) {
        self.emitError(error);
      }
    })();

    (async () => {
      for await (let {warning} of self.scServer.listener('warning')) {
        self.emitWarning(warning);
      }
    })();

    if (self.scServer.isReady) {
      self.emit(self.EVENT_READY, {});
    } else {
      (async () => {
        await self.scServer.listener('ready').once();
        self.emit(self.EVENT_READY, {});
      })();
    }
  })
  .catch(function (error) {
    self.emitError(error);
  });
};

SCWorker.prototype.listener = function (eventName) {
  return this._listenerDemux.stream(eventName);
};

SCWorker.prototype.closeListener = function (eventName) {
  this._listenerDemux.close(eventName);
};

SCWorker.prototype.emit = function (eventName, data) {
  this._listenerDemux.write(eventName, data);
};

SCWorker.prototype.createHTTPServer = function () {
  var httpServer;
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
  var middlewareFunctions = this._middleware[type];

  this._middleware[type] = middlewareFunctions.filter(function (fn) {
    return fn !== middleware;
  });
};

SCWorker.prototype.startHTTPServer = function () {
  var self = this;

  var options = this.options;

  var start = function () {
    if (options.tcpSynBacklog != null) {
      self.httpServer.listen(options.sourcePort, options.host, options.tcpSynBacklog);
    } else if (options.host != null) {
      self.httpServer.listen(options.sourcePort, options.host);
    } else {
      self.httpServer.listen(options.sourcePort);
    }
  };

  var startMiddleware = this._middleware[this.MIDDLEWARE_START];
  if (startMiddleware.length) {
    var callbackInvoked = false;

    async.applyEachSeries(startMiddleware, options, function (err) {
      if (callbackInvoked) {
        self.emit('warning', new InvalidActionError('Callback for ' + self.MIDDLEWARE_START + ' middleware was already invoked'));
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

SCWorker.prototype.start = function () {
  this._httpRequestCount = 0;
  this._wsRequestCount = 0;
  this._httpRPM = 0;
  this._wsRPM = 0;

  if (this._statusInterval != null) {
    clearInterval(this._statusInterval);
  }
  this._statusInterval = setInterval(this._calculateStatus.bind(this), this.options.workerStatusInterval);

  var runResult = this.run();

  return Promise.resolve(runResult)
  .then(this.startHTTPServer.bind(this));
};

SCWorker.prototype._httpRequestHandler = function (req, res) {
  this._httpRequestCount++;

  req.exchange = this.exchange;

  var forwardedFor = req.headers['x-forwarded-for'];

  if (forwardedFor) {
    var forwardedClientIP;
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
  var perMinuteFactor = 60000 / this.options.workerStatusInterval;
  this._httpRPM = this._httpRequestCount * perMinuteFactor;
  this._wsRPM = this._wsRequestCount * perMinuteFactor;
  this._httpRequestCount = 0;
  this._wsRequestCount = 0;

  var memThreshold = this.options.killWorkerMemoryThreshold;

  if (memThreshold != null) {
    var memoryUsage = process.memoryUsage();
    if (memoryUsage.heapUsed > memThreshold) {
      var message = 'Worker killed itself because its memory ';
      message += 'usage of ' + memoryUsage.heapUsed + ' exceeded ';
      message += 'the killWorkerMemoryThreshold of ' + memThreshold;
      var warning = new ResourceLimitError(message);
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
  var self = this;
  var cid = uuid.v4();

  var responseTimeout = setTimeout(function () {
    var responseHandler = self._pendingResponseHandlers[cid];
    delete self._pendingResponseHandlers[cid];
    var timeoutError = new TimeoutError('IPC response timed out');
    responseHandler.callback(timeoutError);
  }, this.options.ipcAckTimeout);

  this._pendingResponseHandlers[cid] = {
    callback: callback,
    timeout: responseTimeout
  };

  return cid;
};

SCWorker.prototype.handleMasterResponse = function (message) {
  var responseHandler = this._pendingResponseHandlers[message.rid];
  if (responseHandler) {
    clearTimeout(responseHandler.timeout);
    delete this._pendingResponseHandlers[message.rid];
    var properError = scErrors.hydrateError(message.error, true);
    responseHandler.callback(properError, message.data);
  }
};

// TODO 2: Test
SCWorker.prototype.sendRequestToMaster = function (data) {
  var messagePacket = {
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
  var messagePacket = {
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
  this.emit('masterMessage', message.data);
};

SCWorker.prototype.handleMasterRequest = function (request) {
  var self = this

  self.emit('masterRequest', request.data, function (err, data) {
    self.respondToMaster(err, data, request.cid);
  });
};

SCWorker.prototype.emitError = function (err) {
  this.emit(this.EVENT_ERROR, err);
};

SCWorker.prototype.emitWarning = function (warning) {
  this.emit(this.EVENT_WARNING, warning);
};

var handleWorkerClusterMessage = function (wcMessage) {
  if (wcMessage.type === 'terminate') {
    if (scWorker && !wcMessage.data.immediate) {
      if (!scWorker.isTerminating) {
        scWorker.isTerminating = true;
        scWorker.close(function () {
          process.exit();
        });
        setTimeout(function () {
          process.exit();
        }, processTermTimeout);
      }
    } else {
      process.exit();
    }
  } else {
    if (!scWorker) {
      throw new InvalidActionError(`Attempted to send '${wcMessage.type}' to worker ${workerInitOptions.id} before it was instantiated`);
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

process.on('uncaughtException', function (err) {
  handleError(workerInitOptions.crashWorkerOnError, err);
});

module.exports = SCWorker;
