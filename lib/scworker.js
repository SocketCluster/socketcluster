var socketClusterServer = require('./server');
var EventEmitter = require('events').EventEmitter;
var crypto = require('crypto');
var domain = require('domain');
var http = require('http');
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
  
  this.id = this.options.workerId;
  this.isLeader = this.options.isLeader;
  
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
  this._ioRequestCount = 0;
  this._httpRPM = 0;
  this._ioRPM = 0;

  this._ioClusterClient = new this._clusterEngine.IOClusterClient({
    stores: this.options.stores,
    secretKey: this.options.secretKey,
    connectTimeout: this.options.connectTimeout,
    socketChannelLimit: this.options.socketChannelLimit
  });

  this._errorDomain.add(this._ioClusterClient);
  this._ioClusterClient.on('notice', function () {
    self.noticeHandler.apply(self, arguments);
  });
  this.global = this._ioClusterClient.global();

  this._server = http.createServer();
  this._server.global = this.global;
  
  this._errorDomain.add(this._server);
  
  var secure = this.options.protocol == 'https' ? 1 : 0;

  this._socketServer = socketClusterServer.attach(this._server, {
    sourcePort: this.options.sourcePort,
    ioClusterClient: this._ioClusterClient,
    transports: this.options.transports,
    allowClientPublish: this.options.allowClientPublish,
    pingTimeout: this.options.pingTimeout,
    pingInterval: this.options.pingInterval,
    ackTimeout: this.options.ackTimeout,
    upgradeTimeout: this.options.connectTimeout,
    destroyUpgradeTimeout: this.options.socketUpgradeTimeout,
    defaultAuthTokenExpiryInMinutes: this.options.defaultAuthTokenExpiryInMinutes,
    maxHttpBufferSize: this.options.maxHttpBufferSize,
    socketName: this.options.socketName,
    secure: secure,
    host: this.options.host,
    origins: this.options.origins,
    appName: this.options.appName,
    socketCookieName: this.options.socketCookieName,
    authCookieName: this.options.authCookieName,
    path: this.options.path,
    authKey: this.options.authKey
  });

  this._socketServer.on('connection', function (socket) {
    socket.addMessageHandler(function () {
      self._ioRequestCount++;
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
  var socketPath = this.options.socketDirPath + this.options.socketName;
  if (process.platform != 'win32' && fs.existsSync(socketPath)) {
    fs.unlinkSync(socketPath);
  }
  this._server.listen(socketPath);
};

SCWorker.prototype._start = function () {
  var self = this;
  
  this._httpRequestCount = 0;
  this._ioRequestCount = 0;
  this._httpRPM = 0;
  this._ioRPM = 0;

  if (this._statusInterval != null) {
    clearInterval(this._statusInterval);
  }
  this._statusInterval = setInterval(this._calculateStatus.bind(this), this.options.workerStatusInterval);

  // Monkey patch Node.js http server such that only requests to unreserved URLs trigger a 'request' event. 
  // To listen to all requests (including those for reserved URLs), allow listening to a 'requestRaw' event.
  var serverOn = this._server.on;
  this._server.on = function (event) {
    if (event == 'request') {
      arguments[0] = 'req';
    } else if (event == 'rawRequest') {
      arguments[0] = 'request';
    }
    serverOn.apply(self._server, arguments);
  };
  
  this._workerController = require(this._paths.appWorkerControllerPath);
  this._workerController.run(this);
  
  this._startServer();
};

SCWorker.prototype._httpRequestHandler = function (req, res) {
  var self = this;
  
  this._httpRequestCount++;
  
  if (req.url == this._paths.statusURL) {
    this._handleStatusRequest(req, res);
  } else {
    req.global = this.global;
    
    var forwardedFor = req.headers['x-forwarded-for'];
    
    if (forwardedFor) {
      var forwardedClientIP;
      if (forwardedFor.indexOf(',') > -1) {
        forwardedClientIP = forwardedFor.split(',')[0];
      } else {
        forwardedClientIP = forwardedFor;
      }
      // TODO: Deprecate clientAddress in favor of remoteAddress
      req.remoteAddress = req.clientAddress = forwardedClientIP;
    }
    
    if (!this._socketPathRegex.test(req.url)) {
      this._server.emit('req', req, res);
    }
  }
};

SCWorker.prototype._handleStatusRequest = function (req, res) {
  var self = this;

  var isOpen = true;

  var reqTimeout = setTimeout(function () {
    if (isOpen) {
      res.writeHead(500, {
        'Content-Type': 'application/json'
      });
      res.end();
      isOpen = false;
    }
  }, this.options.connectTimeout);

  var buffers = [];
  req.on('data', function (chunk) {
    buffers.push(chunk);
  });

  req.on('end', function () {
    clearTimeout(reqTimeout);
    if (isOpen) {
      var statusReq = null;
      try {
        statusReq = JSON.parse(Buffer.concat(buffers).toString());
      } catch (e) {}

      if (statusReq && statusReq.secretKey == self.options.secretKey) {
        var status = JSON.stringify(self.getStatus());
        res.writeHead(200, {
          'Content-Type': 'application/json'
        });
        res.end(status);
      } else {
        res.writeHead(401, {
          'Content-Type': 'application/json'
        });
        res.end();
      }
      isOpen = false;
    }
  });
};

SCWorker.prototype.getSCServer = function () {
  return this._socketServer;
};

SCWorker.prototype.getHTTPServer = function () {
  return this._server;
};

SCWorker.prototype._calculateStatus = function () {
  var perMinuteFactor = 60000 / this.options.workerStatusInterval;
  this._httpRPM = this._httpRequestCount * perMinuteFactor;
  this._ioRPM = this._ioRequestCount * perMinuteFactor;
  this._httpRequestCount = 0;
  this._ioRequestCount = 0;
};

SCWorker.prototype.getStatus = function () {
  return {
    clientCount: this._socketServer.clientsCount,
    httpRPM: this._httpRPM,
    ioRPM: this._ioRPM
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
