var engine = require('engine.io');
var Server = engine.Server;
var SCSocket = require('./scsocket');
var transports = engine.transports;
var EventEmitter = require('events').EventEmitter;
var base64id = require('base64id');
var async = require('async');
var url = require('url');
var domain = require('domain');

var SCServer = function (options) {
  var self = this;
  
  var opts = {
    transports: ['polling', 'websocket'],
    ackTimeout: 10000,
    allowClientPublish: true
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
  
  var pollingEnabled = false;
  for (i in opts.transports) {
    if (opts.transports[i] == 'polling') {
      pollingEnabled = true;
      break;
    }
  }
  if (!pollingEnabled) {
    opts.transports.unshift('polling');
  }

  opts.cookie = 'n/' + opts.appName + '/io';
  opts.sessionCookie = 'n/' + opts.appName + '/ssid';
  
  opts.allowRequest = this.checkRequest.bind(this);
  
  Server.call(this, opts);
  
  this.origins = opts.origins;
  this._allowAllOrigins = this.origins.indexOf('*:*') != -1;
  
  this.sourcePort = opts.sourcePort;
  this.socketName = opts.socketName;
  this.secure = opts.secure;
  this.host = opts.host;
  this.ackTimeout = opts.ackTimeout;
  this.allowClientPublish = opts.allowClientPublish;
  
  var secureInt = this.secure ? 1 : 0;
  
  this._idPrefix = (this.host || '') + '_' + this.socketName + '_' + this.sourcePort + '_' + secureInt + '_';
  
  this._ioClusterClient = opts.ioClusterClient;
  this._sessionIdRegex = new RegExp('(' + opts.sessionCookie + '=)([^;]*)');
  
  this._appName = opts.appName;
  
  this.global = this._ioClusterClient.global();
  
  this._handleSocketError = function (error) {
    self.emit('error', error);
  };
};

SCServer.prototype = Object.create(Server.prototype);

SCServer.prototype.getPath = function () {
  return this._path;
};

SCServer.prototype._parseSessionId = function (cookieString) {
  if (typeof cookieString == 'string') {
    var result = cookieString.match(this._sessionIdRegex);
    if (result) {
      return result[2];
    }
  }
  return null;
};

SCServer.prototype._parseCookie = function (cookieString) {
  var cookies = {};
  if (typeof cookieString == 'string') {
    var cookieStrings = cookieString.split(';');
    for (var i = 0; i < cookieStrings.length; i++) {
      var cookie = cookieStrings[i];
      var parts = cookie.split('=');
      if (parts[0]) {
        var key = parts[0].trim();
        cookies[key] = decodeURIComponent((parts[1] || '').trim());
      }
    }
  }
  return cookies;
};

SCServer.prototype.generateId = function () {
  return this._idPrefix + base64id.generateId();
};

SCServer.prototype.on = function (event, listener) {
  if (event == 'ready') {
    this._ioClusterClient.once(event, listener);
  } else if (event == 'sessionEnd') {
    this._ioClusterClient.on(event, listener);
  } else {
    Server.prototype.on.apply(this, arguments);
  }
};

SCServer.prototype.removeListener = function (event, listener) {
  if (event == 'ready' || event == 'sessionEnd') {
    this._ioClusterClient.removeListener(event, listener);
  } else {
    Server.prototype.removeListener.apply(this, arguments);
  }
};

SCServer.prototype.sendErrorMessage = function (res, code) {
  res.writeHead(400, {'Content-Type': 'application/json'});
  res.end(JSON.stringify({
    code: code,
    message: Server.errorMessages[code]
  }));
};

SCServer.prototype.addMiddleware = function (type, middleware) {
  this._middleware[type].push(middleware);
};

SCServer.prototype.verifyEvent = function (socket, event, data, fn) {
  var self = this;
  
  if (event == this.MIDDLEWARE_SUBSCRIBE) {
    async.applyEachSeries(this._middleware[this.MIDDLEWARE_SUBSCRIBE], socket, data,
      function (err) {
        if (err) {
          self.emit('notice', err); 
        }
        fn(err);
      }
    );
  } else if (event == this.MIDDLEWARE_PUBLISH) {
    if (this.allowClientPublish) {
      async.applyEachSeries(this._middleware[this.MIDDLEWARE_PUBLISH], socket, data.channel, data.data,
        function (err) {
          if (err) {
            self.emit('notice', err);
            fn(err);
          } else {
            self.global.publish(data.channel, data.data, function (err) {
              fn(err);
            });
          }
        }
      );
    } else {
      fn(this.ERROR_NO_PUBLISH);
    }
  } else if (event == 'ready') {
    fn();
  } else {
    async.applyEachSeries(this._middleware[this.MIDDLEWARE_EMIT], socket, event, data,
      function (err) {
        if (err) {
          self.emit('notice', err); 
        }
        fn(err);
      }
    );
  }
};

SCServer.prototype.checkRequest = function (req, fn) {
  var self = this;

  var origin = req.headers.origin || req.headers.referer;
  if (origin == 'null') {
    origin = '*';
  }
  var ok = this._allowAllOrigins;
  if (!ok && origin) {
    try {
      var parts = url.parse(origin);
      parts.port = parts.port || 80;
      ok = ~this.origins.indexOf(parts.hostname + ':' + parts.port) ||
        ~this.origins.indexOf(parts.hostname + ':*') ||
        ~this.origins.indexOf('*:' + parts.port);
    } catch (ex) {}
  }
  
  if (ok) {
    var handshakeMiddleware = this._middleware[this.MIDDLEWARE_HANDSHAKE];
    if (handshakeMiddleware.length) {
      async.applyEachSeries(handshakeMiddleware, req, function (err) {
        if (err) {
          self.emit('notice', err);
        }
        fn(null, !err);
      });
    } else {
      fn(null, true);
    }
  } else {
    this.emit('notice', 'Failed to authorize socket handshake - Invalid origin: ' + origin);
    fn(null, false);
  }
};

SCServer.prototype.handshake = function (transport, req) {
  var self = this;
  
  var socketDomain = domain.createDomain();
  var id = this.generateId(req);
  
  var transportName = transport;
  try {
    var transport = new transports[transport](req);
    if ('polling' == transportName) {
      transport.maxHttpBufferSize = this.maxHttpBufferSize;
    }

    if (req._query && req._query.b64) {
      transport.supportsBinary = false;
    } else {
      transport.supportsBinary = true;
    }
  } catch (e) {
    this.sendErrorMessage(req.res, Server.errors.BAD_REQUEST);
    return;
  }
  
  var socket = new SCSocket(id, this, transport, req);
  
  socketDomain.on('error', function (err) {
    self._handleSocketError(err);
    socket.close();
  });
  socketDomain.add(socket);

  if (false !== this.cookie) {
    transport.on('headers', function (headers) {
      headers['Set-Cookie'] = self.cookie + '=' + id;
    });
  }

  transport.onRequest(req);

  this.clients[id] = socket;
  this.clientsCount++;
  
  var headers = req.headers || {};
  
  var ssid = this._parseSessionId(headers.cookie);
  var cookie = this._parseCookie(headers.cookie);
  socket.ssid = ssid || socket.id;
  socket.cookie = cookie;
  socket.request = req;
  
  var forwardedFor = headers['x-forwarded-for'];
  if (forwardedFor) {
    var forwardedClientIP;
    // For efficiency purposes since in many cases there won't be a comma
    if (forwardedFor.indexOf(',') > -1) {
      forwardedClientIP = forwardedFor.split(',')[0];
    } else {
      forwardedClientIP = forwardedFor;
    }
    // TODO: Deprecate clientAddress in favor of remoteAddress
    socket.remoteAddress = socket.clientAddress = forwardedClientIP;
  } else if (req.connection) {
    // TODO: Deprecate clientAddress in favor of remoteAddress
    socket.remoteAddress = socket.clientAddress = req.connection.remoteAddress; 
  }
  
  this._ioClusterClient.bind(socket, function (err, sock, isNotice) {
    if (err) {
      var errorMessage = 'Failed to bind socket to io cluster - ' + err;
      socket.emit('fail', errorMessage);
      socket.close();
      if (isNotice) {
        self.emit('notice', errorMessage);
      } else {
        self.emit('error', new Error(errorMessage));
      }
    } else {
      socket.session = self._ioClusterClient.session(socket.ssid, socket.id);
      socket.global = self.global;
      
      socket.once('ready', function () {
        self.emit('connection', socket);
      });
      
      socket.emit('connect', {
        soid: socket.id,
        appName: self._appName
      });
    }
  });
  
  socket.once('close', function () {
    self._ioClusterClient.unbind(socket, function (err) {
      if (err) {
        self.emit('error', new Error('Failed to unbind socket from io cluster - ' + err));
      } else {
        delete self.clients[id];
        self.clientsCount--;
        self.emit('disconnection', socket);
        socket.emit('disconnect', socket);
      }
    });
  });
};

SCServer.prototype.attach = function (server, options) {
  var opts = {};
  for (var i in options) {
    opts[i] = options[i];
  }
  if (opts.destroyUpgradeTimeout) {
    opts.destroyUpgradeTimeout = opts.destroyUpgradeTimeout;
  }
  this._path = opts.path = (opts.path || '/socketcluster').replace(/\/$/, '') + '/';
  
  Server.prototype.attach.call(this, server, opts);
};

module.exports = SCServer;
