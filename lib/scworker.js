var socketClusterServer = require('socketcluster-server');
var EventEmitter = require('events').EventEmitter;
var crypto = require('crypto');
var domain = require('domain');
var http = require('http');
var https = require('https');
var fs = require('fs');
var base64id = require('base64id');
var async = require('async');
var AuthEngine = require('sc-auth').AuthEngine;

var scErrors = require('sc-errors');
var InvalidActionError = scErrors.InvalidActionError;
var ResourceLimitError = scErrors.ResourceLimitError;
var BrokerError = scErrors.BrokerError;
var HTTPServerError = scErrors.HTTPServerError;

var SCWorker = function (options) {
  var self = this;

  this.EVENT_ERROR = 'error';
  this.EVENT_WARNING = 'warning';
  this.EVENT_EXIT = 'exit';
  this.EVENT_READY = 'ready';
  this.EVENT_CONNECTION = 'connection';

  this.MIDDLEWARE_START = 'start';

  this.type = 'worker';

  this._errorDomain = domain.create();
  this._errorDomain.on('error', function () {
    self.errorHandler.apply(self, arguments);
  });

  this.start = this._errorDomain.bind(this._start);
  this._errorDomain.run(function () {
    self._init(options);
  });
};

SCWorker.prototype = Object.create(EventEmitter.prototype);

SCWorker.prototype.setAuthEngine = function (authEngine) {
  this.auth = authEngine;

  this.httpServer.auth = this.auth;
  this.scServer.setAuthEngine(this.auth);
};

SCWorker.prototype._init = function (options) {
  var self = this;

  this.options = {};

  for (var i in options) {
    if (options.hasOwnProperty(i)) {
      this.options[i] = options[i];
    }
  }

  this.id = this.options.id;
  this.isLeader = this.id == 0;

  this._middleware = {};
  this._middleware[this.MIDDLEWARE_START] = [];

  if (this.options.downgradeToUser && process.setuid) {
    try {
      process.setuid(this.options.downgradeToUser);
    } catch (err) {
      this._errorDomain.emit('error', new InvalidActionError('Could not downgrade to user "' + this.options.downgradeToUser +
        '" - Either this user does not exist or the current process does not have the permission' +
        ' to switch to it.'));
    }
  }

  this._brokerEngine = require(this.options.brokerEngine);

  this._paths = options.paths;

  this._httpRequestCount = 0;
  this._wsRequestCount = 0;
  this._httpRPM = 0;
  this._wsRPM = 0;

  this._brokerEngineClient = new this._brokerEngine.Client({
    brokers: this.options.brokers,
    secretKey: this.options.secretKey
  });

  this._brokerEngineClient.on('error', function (err) {
    var error;
    if (typeof err == 'string') {
      error = new BrokerError(err);
    } else {
      error = err;
    }
    self._errorDomain.emit('error', error);
  });
  this._brokerEngineClient.on('warning', function () {
    self.warningHandler.apply(self, arguments);
  });
  this.exchange = this.global = this._brokerEngineClient.exchange();

  if (this.options.httpServerModule) {
    var httpServerFactory = require(this.options.httpServerModule);
    this.httpServer = httpServerFactory.createServer(this.options.protocolOptions);
  } else {
    if (this.options.protocol == 'https') {
      this.httpServer = https.createServer(this.options.protocolOptions);
    } else {
      this.httpServer = http.createServer();
    }
  }
  this.httpServer.on('request', this._httpRequestHandler.bind(this));
  this.httpServer.on('upgrade', this._httpRequestHandler.bind(this));

  this.httpServer.exchange = this.httpServer.global = this.exchange;

  var httpServerErrorDomain = domain.create();
  httpServerErrorDomain.add(this.httpServer);
  httpServerErrorDomain.on('error', function (err) {
    if (typeof err == 'string') {
      error = new HTTPServerError(err);
    } else {
      error = err;
    }
    self._errorDomain.emit('error', error);
  });

  var secure = this.options.protocol == 'https' ? 1 : 0;

  this.scServer = socketClusterServer.attach(this.httpServer, {
    brokerEngine: this._brokerEngineClient,
    allowClientPublish: this.options.allowClientPublish,
    handshakeTimeout: this.options.handshakeTimeout,
    ackTimeout: this.options.ackTimeout,
    pingTimeout: this.options.pingTimeout,
    pingInterval: this.options.pingInterval,
    origins: this.options.origins,
    appName: this.options.appName,
    path: this.options.path,
    authKey: this.options.authKey,
    authPrivateKey: this.options.authPrivateKey,
    authPublicKey: this.options.authPublicKey,
    authAlgorithm: this.options.authAlgorithm,
    authDefaultExpiry: this.options.authDefaultExpiry,
    middlewareEmitWarnings: this.options.middlewareEmitWarnings,
    socketChannelLimit: this.options.socketChannelLimit,
    perMessageDeflate: this.options.perMessageDeflate
  });

  // Default authentication engine
  this.setAuthEngine(new AuthEngine());

  this.scServer.on('_connection', function (socket) {
    // The connection event counts as a WS request
    self._wsRequestCount++;
    socket.on('message', function () {
      self._wsRequestCount++;
    });
    self.emit(self.EVENT_CONNECTION, socket);
  });

  this.scServer.on('warning', function () {
    self.warningHandler.apply(self, arguments);
  });

  this._socketPath = this.scServer.getPath();
  this._socketPathRegex = new RegExp('^' + this._socketPath);

  this._errorDomain.add(this.scServer);

  this.scServer.on('ready', function () {
    self.emit(self.EVENT_READY);
  });
};

SCWorker.prototype.open = function () {
  this._startServer();
};

SCWorker.prototype.close = function (callback) {
  this.scServer.close();
  this.httpServer.close(callback);
};

// getSocketURL is deprecated
SCWorker.prototype.getSocketPath = SCWorker.prototype.getSocketURL = function () {
  return this._socketPath;
};

SCWorker.prototype.addMiddleware = function (type, middleware) {
  this._middleware[type].push(middleware);
};

SCWorker.prototype.removeMiddleware = function (type, middleware) {
  var middlewareFunctions = this._middleware[type];

  this._middleware[type] = middlewareFunctions.filter(function (fn) {
    return fn != middleware;
  });
};

SCWorker.prototype._startServer = function () {
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

SCWorker.prototype._start = function () {
  var self = this;

  this._httpRequestCount = 0;
  this._wsRequestCount = 0;
  this._httpRPM = 0;
  this._wsRPM = 0;

  if (this._statusInterval != null) {
    clearInterval(this._statusInterval);
  }
  this._statusInterval = setInterval(this._calculateStatus.bind(this), this.options.workerStatusInterval);

  // Run the initController to initialize the global context
  if (this._paths.appInitControllerPath != null) {
      this._initController = require(this._paths.appInitControllerPath);
      this._initController.run(this);
  }

  this._workerController = require(this._paths.appWorkerControllerPath);
  this._workerController.run(this);

  this._startServer();
};

SCWorker.prototype._httpRequestHandler = function (req, res) {
  var self = this;

  this._httpRequestCount++;

  req.exchange = req.global = this.exchange;

  var forwardedFor = req.headers['x-forwarded-for'];

  if (forwardedFor) {
    var forwardedClientIP;
    if (forwardedFor.indexOf(',') > -1) {
      forwardedClientIP = forwardedFor.split(',')[0];
    } else {
      forwardedClientIP = forwardedFor;
    }
    req.remoteAddress = forwardedClientIP;
  } else {
    if (req.connection) {
      req.remoteAddress = req.connection.remoteAddress;
    } else if (req.socket) {
      req.remoteAddress = req.socket.remoteAddress;
    }
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
      this.warningHandler(warning);
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

SCWorker.prototype.sendToMaster = function (data) {
  process.send({
    type: 'workerMessage',
    data: data,
    workerId: this.id
  });
};

SCWorker.prototype.handleMasterEvent = function () {
  this.emit.apply(this, arguments);
};

SCWorker.prototype.handleMasterMessage = function (message) {
  this.emit('masterMessage', message.data);
};

SCWorker.prototype.errorHandler = function (err) {
  this.emit(this.EVENT_ERROR, err);
};

SCWorker.prototype.warningHandler = function (warning) {
  if (warning.stack != null) {
    warning = warning.stack;
  } else if (warning.message != null) {
    warning = warning.message;
  }
  this.emit(this.EVENT_WARNING, warning);
};

module.exports = SCWorker;
