var socketClusterServer = require('./server');
var EventEmitter = require('events').EventEmitter;
var crypto = require('crypto');
var domain = require('domain');
var http = require('http');
var https = require('https');
var fs = require('fs');
var base64id = require('base64id');
var AuthEngine = require('./auth').AuthEngine;

var SCWorker = function (options) {
  var self = this;
  
  self.EVENT_ERROR = 'error';
  self.EVENT_NOTICE = 'notice';
  self.EVENT_EXIT = 'exit';
  self.EVENT_READY = 'ready';
  self.EVENT_CONNECTION = 'connection';

  this._errorDomain = domain.create();
  this._errorDomain.on('error', function () {
    self.errorHandler.apply(self, arguments);
    if (self.options.rebootWorkerOnCrash) {
      self.emit(self.EVENT_EXIT);
    }
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
    this.options[i] = options[i];
  }
  
  this.id = this.options.id;
  this.isLeader = this.id == 0;
  
  if (this.options.downgradeToUser && process.setuid) {
    try {
      process.setuid(this.options.downgradeToUser);
    } catch (err) {
      this._errorDomain.emit('error', new Error('Could not downgrade to user "' + this.options.downgradeToUser +
        '" - Either this user does not exist or the current process does not have the permission' +
        ' to switch to it.'));
    }
  }
  
  this._clusterEngine = require(this.options.clusterEngine);

  this._paths = options.paths;

  this._httpRequestCount = 0;
  this._wsRequestCount = 0;
  this._httpRPM = 0;
  this._wsRPM = 0;

  this._ioClusterClient = new this._clusterEngine.IOClusterClient({
    brokers: this.options.brokers,
    secretKey: this.options.secretKey,
    socketChannelLimit: this.options.socketChannelLimit
  });

  this._errorDomain.add(this._ioClusterClient);
  this._ioClusterClient.on('notice', function () {
    self.noticeHandler.apply(self, arguments);
  });
  this.global = this._ioClusterClient.global();

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
  
  this.httpServer.global = this.global;
  
  this._errorDomain.add(this.httpServer);
  
  var secure = this.options.protocol == 'https' ? 1 : 0;

  this.scServer = socketClusterServer.attach(this.httpServer, {
    ioClusterClient: this._ioClusterClient,
    allowClientPublish: this.options.allowClientPublish,
    ackTimeout: this.options.ackTimeout,
    pingTimeout: this.options.pingTimeout,
    pingInterval: this.options.pingInterval,
    origins: this.options.origins,
    appName: this.options.appName,
    defaultAuthTokenExpiryInMinutes: this.options.defaultAuthTokenExpiryInMinutes,
    path: this.options.path,
    authKey: this.options.authKey,
    middlewareEmitNotices: this.options.middlewareEmitNotices
  });
  
  // Default authentication engine
  this.setAuthEngine(new AuthEngine());
  
  this.scServer.on('connection', function (socket) {
    // The connection event counts as a WS request
    self._wsRequestCount++;
    socket.on('message', function () {
      self._wsRequestCount++;
    });
    self.emit(self.EVENT_CONNECTION, socket);
  });
  
  this.scServer.on('notice', function () {
    self.noticeHandler.apply(self, arguments);
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

SCWorker.prototype._startServer = function () {
  if (this.options.tcpSynBacklog != null) {
    this.httpServer.listen(this.options.sourcePort, this.options.host, this.options.tcpSynBacklog);
  } else if (this.options.host != null) {
    this.httpServer.listen(this.options.sourcePort, this.options.host);
  } else {
    this.httpServer.listen(this.options.sourcePort);
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
  
  this._workerController = require(this._paths.appWorkerControllerPath);
  this._workerController.run(this);
  
  this._startServer();
};

SCWorker.prototype._httpRequestHandler = function (req, res) {
  var self = this;
  
  this._httpRequestCount++;
  
  req.global = this.global;
  
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
      var notice = new Error(message);
      this.noticeHandler(notice);
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

SCWorker.prototype.noticeHandler = function (notice) {
  if (notice.stack != null) {
    notice = notice.stack;
  } else if (notice.message != null) {
    notice = notice.message;
  }
  this.emit(this.EVENT_NOTICE, notice);
};

module.exports = SCWorker;
