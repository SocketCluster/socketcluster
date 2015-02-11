var ws = require('ws');
var WSServer = ws.Server;
var SCSocket = require('./scsocket');
var EventEmitter = require('events').EventEmitter;
var base64id = require('base64id');
var async = require('async');
var url = require('url');
var domain = require('domain');

var SCServer = function (options) {
  var self = this;
  
  var opts = {
    ackTimeout: 10000,
    allowClientPublish: true,
    path: '/socketcluster/'
  };
  
  var i;
  for (i in options) {
    opts[i] = options[i];
  }
  
  this.MIDDLEWARE_HANDSHAKE = 'handshake';
  this.MIDDLEWARE_EMIT = 'emit';
  this.MIDDLEWARE_SUBSCRIBE = 'subscribe';
  this.MIDDLEWARE_PUBLISH = 'publish';
  
  this.ERROR_NO_PUBLISH = 'Error: Client publish feature is disabled';

  this._middleware = {};
  this._middleware[this.MIDDLEWARE_HANDSHAKE] = [];
  this._middleware[this.MIDDLEWARE_EMIT] = [];
  this._middleware[this.MIDDLEWARE_SUBSCRIBE] = [];
  this._middleware[this.MIDDLEWARE_PUBLISH] = [];
  
  this.origins = opts.origins;
  this._allowAllOrigins = this.origins.indexOf('*:*') != -1;
  
  this.ackTimeout = opts.ackTimeout;
  this.allowClientPublish = opts.allowClientPublish;
  this.perMessageDeflate = opts.perMessageDeflate;
  this.httpServer = opts.httpServer;
  
  this._ioClusterClient = opts.ioClusterClient;
  this._appName = opts.appName;
  this._path = opts.path;
  
  this.clients = {};
  this.clientsCount = 0;
  
  this.global = this._ioClusterClient.global();
  
  this.wsServer = new WSServer({
    server: this.httpServer,
    clientTracking: false,
    perMessageDeflate: this.perMessageDeflate,
    handleProtocols: opts.handleProtocols,
    verifyClient: this.verifyHandshake.bind(this)
  });
  
  this.wsServer.on('error', this._handleServerError.bind(this));
  this.wsServer.on('connection', this._handleSocketConnection.bind(this));
};

SCServer.prototype = Object.create(EventEmitter.prototype);

SCServer.errorStatuses = {
  0: 'Failed handshake'
};

SCServer.prototype.sendErrorMessage = function (res, code) {
  res.writeHead(400, {'Content-Type': 'application/json'});
  res.end(JSON.stringify({
    code: code,
    message: SCServer.errorStatuses[code]
  }));
};

SCServer.prototype._handleServerError = function (error) {
  this.emit('error', error);
};

SCServer.prototype._handleSocketError = function (error) {
  // We don't want to crash the entire worker on socket error
  // so we emit it as a notice instead.
  var errorPrefix = 'Socket Error: ';
  if (error.message) {
    error.message = errorPrefix + error.message;
  } else if (typeof error == 'string') {
    error = errorPrefix + error;
  }
  this.emit('notice', error);
};

SCServer.prototype._handleSocketConnection = function (wsSocket) {
  var self = this;
  
  var socketDomain = domain.createDomain();
  var id = this.generateId();
  
  var scSocket = new SCSocket(id, this, wsSocket);
  
  this.clients[id] = scSocket;
  this.clientsCount++;
  
  socketDomain.on('error', function (err) {
    self._handleSocketError(err);
    scSocket.disconnect();
  });
  socketDomain.add(scSocket);
  
  this._ioClusterClient.bind(scSocket, function (err, sock, isNotice) {
    if (err) {
      var errorMessage = 'Failed to bind socket to io cluster - ' + err;
      scSocket.emit('fail', errorMessage);
      scSocket.disconnect();
      if (isNotice) {
        self.emit('notice', errorMessage);
      } else {
        self.emit('error', new Error(errorMessage));
      }
    } else {
      scSocket.global = self.global;
      
      scSocket.once('ready', function () {
        self.emit('connection', scSocket);
      });
      
      scSocket.emit('connect', {
        soid: scSocket.id,
        appName: self._appName
      });
    }
  });
  
  scSocket.once('disconnect', function () {
    delete self.clients[id];
    self.clientsCount--;
    self._ioClusterClient.unbind(scSocket, function (err) {
      if (err) {
        self.emit('error', new Error('Failed to unbind socket from io cluster - ' + err));
      } else {
        self.emit('disconnection', scSocket);
      }
    });
  });
};

SCServer.prototype.close = function () {
  this.wsServer.close();
};

SCServer.prototype.getPath = function () {
  return this._path;
};

SCServer.prototype.generateId = function () {
  return base64id.generateId();
};

SCServer.prototype.on = function (event, listener) {
  if (event == 'ready') {
    this._ioClusterClient.once(event, listener);
  } else {
    EventEmitter.prototype.on.apply(this, arguments);
  }
};

SCServer.prototype.removeListener = function (event, listener) {
  if (event == 'ready') {
    this._ioClusterClient.removeListener(event, listener);
  } else {
    EventEmitter.prototype.removeListener.apply(this, arguments);
  }
};

SCServer.prototype.addMiddleware = function (type, middleware) {
  this._middleware[type].push(middleware);
};

SCServer.prototype.verifyHandshake = function (info, cb) {
  var self = this;
  
  var req = info.req;
  var origin = info.origin;
  if (origin == 'null' || origin == null) {
    origin = '*';
  }
  
  if (this._allowAllOrigins) {
    cb(true);
  } else {
    var ok;
    try {
      var parts = url.parse(origin);
      parts.port = parts.port || 80;
      ok = ~this.origins.indexOf(parts.hostname + ':' + parts.port) ||
        ~this.origins.indexOf(parts.hostname + ':*') ||
        ~this.origins.indexOf('*:' + parts.port);
    } catch (ex) {}
    
    if (ok) {
      var handshakeMiddleware = this._middleware[this.MIDDLEWARE_HANDSHAKE];
      if (handshakeMiddleware.length) {
        async.applyEachSeries(handshakeMiddleware, req, function (err) {
          if (err) {
            self.emit('notice', err);
            cb(false, 401, err);
          } else {
            cb(true);
          }
        });
      } else {
        cb(true);
      }
    } else {
      var err = 'Failed to authorize socket handshake - Invalid origin: ' + origin;
      this.emit('notice', err);
      cb(false, 403, err);
    }
  }
};

SCServer.prototype.verifyEvent = function (socket, event, data, cb) {
  var self = this;
  
  if (event == this.MIDDLEWARE_SUBSCRIBE) {
    async.applyEachSeries(this._middleware[this.MIDDLEWARE_SUBSCRIBE], socket, data,
      function (err) {
        if (err) {
          self.emit('notice', err); 
        }
        cb(err);
      }
    );
  } else if (event == this.MIDDLEWARE_PUBLISH) {
    if (this.allowClientPublish) {
      async.applyEachSeries(this._middleware[this.MIDDLEWARE_PUBLISH], socket, data.channel, data.data,
        function (err) {
          if (err) {
            self.emit('notice', err);
            cb(err);
          } else {
            self.global.publish(data.channel, data.data, function (err) {
              cb(err);
            });
          }
        }
      );
    } else {
      cb(this.ERROR_NO_PUBLISH);
    }
  } else if (event == 'ready') {
    cb();
  } else {
    async.applyEachSeries(this._middleware[this.MIDDLEWARE_EMIT], socket, event, data,
      function (err) {
        if (err) {
          self.emit('notice', err); 
        }
        cb(err);
      }
    );
  }
};

module.exports = SCServer;
