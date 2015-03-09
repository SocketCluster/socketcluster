var socketClusterServer = require('./server');
var EventEmitter = require('events').EventEmitter;
var crypto = require('crypto');
var domain = require('domain');
var http = require('http');
var https = require('https');
var fs = require('fs');
var base64id = require('base64id');

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

SCWorker.prototype._init = function (options) {
  var self = this;
  
  this.options = {
    transports: ['polling', 'websocket']
  };

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
  
  http.globalAgent.maxSockets = this.options.maxHttpSockets || Infinity;

  this._clusterEngine = require(this.options.clusterEngine);

  this._paths = options.paths;

  this._httpRequestCount = 0;
  this._wsRequestCount = 0;
  this._httpRPM = 0;
  this._wsRPM = 0;

  this._ioClusterClient = new this._clusterEngine.IOClusterClient({
    stores: this.options.stores,
    secretKey: this.options.secretKey,
    socketChannelLimit: this.options.socketChannelLimit
  });

  this._errorDomain.add(this._ioClusterClient);
  this._ioClusterClient.on('notice', function () {
    self.noticeHandler.apply(self, arguments);
  });
  this.global = this._ioClusterClient.global();

  if (this.options.protocol == 'https') {
    this._server = https.createServer(this.options.protocolOptions);
  } else {
    this._server = http.createServer();
  }
  this._server.global = this.global;
  
  this._errorDomain.add(this._server);
  
  var secure = this.options.protocol == 'https' ? 1 : 0;

  this._socketServer = socketClusterServer.attach(this._server, {
    ioClusterClient: this._ioClusterClient,
    transports: this.options.transports,
    allowClientPublish: this.options.allowClientPublish,
    ackTimeout: this.options.ackTimeout * 1000,
    origins: this.options.origins,
    appName: this.options.appName,
    authCookieName: this.options.authCookieName,
    defaultAuthTokenExpiryInMinutes: this.options.defaultAuthTokenExpiryInMinutes,
    path: this.options.path,
    secretKey: this.options.secretKey
  });

  this._socketServer.on('connection', function (socket) {
    // The connection event counts as a WS request
    self._wsRequestCount++;
    socket.on('message', function () {
      self._wsRequestCount++;
    });
    self.emit(self.EVENT_CONNECTION, socket);
  });
  
  this._socketServer.on('notice', function () {
    self.noticeHandler.apply(self, arguments);
  });

  this._socketPath = this._socketServer.getPath();
  this._socketPathRegex = new RegExp('^' + this._socketPath);
  
  this._errorDomain.add(this._socketServer);
  
  // Make sure _httpRequestHandler is the first to handle HTTP requests
  var oldRequestListeners = this._server.listeners('request');
  this._server.removeAllListeners('request');
  this._server.on('request', this._httpRequestHandler.bind(this));
  for (var i in oldRequestListeners) {
    this._server.on('request', oldRequestListeners[i]);
  }
  
  // Make sure _httpRequestHandler is the first to handle HTTP upgrade requests
  var oldUpgradeListeners = this._server.listeners('upgrade');
  this._server.removeAllListeners('upgrade');
  this._server.on('upgrade', this._httpRequestHandler.bind(this));
  for (var i in oldUpgradeListeners) {
    this._server.on('upgrade', oldUpgradeListeners[i]);
  }
  
  this._socketServer.on('ready', function () {
    self.emit(self.EVENT_READY);
  });
};

SCWorker.prototype.open = function () {
  this._startServer();
};

SCWorker.prototype.close = function (callback) {
  this._socketServer.close();
  this._server.close(callback);
};

SCWorker.prototype.getSocketURL = function () {
  return this._socketPath;
};

SCWorker.prototype._startServer = function () {
  this._server.listen(this.options.sourcePort);
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
  this._statusInterval = setInterval(this._calculateStatus.bind(this), this.options.workerStatusInterval * 1000);
  
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
    req.remoteAddress = req.connection.remoteAddress;
  }
};

SCWorker.prototype.getSCServer = function () {
  return this._socketServer;
};

SCWorker.prototype.getHTTPServer = function () {
  return this._server;
};

SCWorker.prototype._calculateStatus = function () {
  var perMinuteFactor = 60 / this.options.workerStatusInterval;
  this._httpRPM = this._httpRequestCount * perMinuteFactor;
  this._wsRPM = this._wsRequestCount * perMinuteFactor;
  this._httpRequestCount = 0;
  this._wsRequestCount = 0;
};

SCWorker.prototype.getStatus = function () {
  return {
    clientCount: this._socketServer.clientsCount,
    httpRPM: this._httpRPM,
    wsRPM: this._wsRPM
  };
};

SCWorker.prototype.handleMasterEvent = function () {
  this.emit.apply(this, arguments);
};

SCWorker.prototype.errorHandler = function (err) {
  this.emit(this.EVENT_ERROR, err);
};

SCWorker.prototype.noticeHandler = function (notice) {
  if (notice.message != null) {
    notice = notice.message;
  }
  this.emit(this.EVENT_NOTICE, notice);
};

module.exports = SCWorker;
