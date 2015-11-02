var ws = require('ws');
var WSServer = ws.Server;
var SCSocket = require('./scsocket');
var AuthEngine = require('../auth').AuthEngine;
var EventEmitter = require('events').EventEmitter;
var base64id = require('base64id');
var async = require('async');
var url = require('url');
var domain = require('domain');


var SCServer = function (options) {
  var self = this;

  var opts = {
    ackTimeout: 10000,
    allowClientPublish: true
  };

  for (var i in options) {
    if (options.hasOwnProperty(i)) {
      opts[i] = options[i];
    }
  }

  if (opts.path == null) {
    opts.path = '/socketcluster/';
  }

  this.MIDDLEWARE_HANDSHAKE = 'handshake';
  this.MIDDLEWARE_EMIT = 'emit';
  this.MIDDLEWARE_SUBSCRIBE = 'subscribe';
  this.MIDDLEWARE_PUBLISH_IN = 'publishIn';
  this.MIDDLEWARE_PUBLISH_OUT = 'publishOut';

  // Deprecated
  this.MIDDLEWARE_PUBLISH = this.MIDDLEWARE_PUBLISH_IN;

  this._subscribeEvent = '#subscribe';
  this._publishEvent = '#publish';

  this.ERROR_NO_PUBLISH = 'Error: Client publish feature is disabled';

  this._middleware = {};
  this._middleware[this.MIDDLEWARE_HANDSHAKE] = [];
  this._middleware[this.MIDDLEWARE_EMIT] = [];
  this._middleware[this.MIDDLEWARE_SUBSCRIBE] = [];
  this._middleware[this.MIDDLEWARE_PUBLISH_IN] = [];
  this._middleware[this.MIDDLEWARE_PUBLISH_OUT] = [];

  this.origins = opts.origins;
  this._allowAllOrigins = this.origins.indexOf('*:*') != -1;

  this.ackTimeout = opts.ackTimeout;
  this.pingInterval = opts.pingInterval;
  this.pingTimeout = opts.pingTimeout;
  this.allowClientPublish = opts.allowClientPublish;
  this.perMessageDeflate = opts.perMessageDeflate;
  this.httpServer = opts.httpServer;

  this._ioClusterClient = opts.ioClusterClient;
  this.appName = opts.appName || '';
  this.middlewareEmitNotices = opts.middlewareEmitNotices;
  this._path = opts.path;

  this.authKey = opts.authKey;
  this.defaultAuthTokenExpiryInMinutes = opts.defaultAuthTokenExpiryInMinutes;

  if (opts.authEngine) {
    this.auth = opts.authEngine;
  } else {
    // Default authentication engine
    this.auth = new AuthEngine();
  }

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

SCServer.prototype.setAuthEngine = function (authEngine) {
  this.auth = authEngine;
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

SCServer.prototype._handleHandshakeTimeout = function (scSocket) {
  var errorMessage = new Error('Did not receive #handshake from client before timeout');
  scSocket.emit('error', errorMessage);
};

SCServer.prototype._processTokenError = function (socket, err, encryptedAuthToken) {
  // In case of an expired, malformed or invalid token, emit an event
  // and keep going without a token.
  var authError = null;

  if (err) {
    err.encryptedAuthToken = encryptedAuthToken;
    socket.emit('badAuthToken', err);
    this.emit('badSocketAuthToken', socket, err);

    authError = {
      name: err.name,
      message: err.message
    };
  }

  return authError;
};

SCServer.prototype._handleSocketConnection = function (wsSocket) {
  var self = this;

  var id = this.generateId();

  var socketDomain = domain.createDomain();
  var scSocket = new SCSocket(id, this, wsSocket);
  socketDomain.add(scSocket);

  // Emit event to signal that a socket handshake has been initiated.
  // The _handshake event is for internal use (including third-party plugins)
  this.emit('_handshake', scSocket);
  this.emit('handshake', scSocket);

  socketDomain.on('error', function (err) {
    self._handleSocketError(err);
  });

  scSocket.on('#authenticate', function (encryptedAuthToken, respond) {
    self.auth.verifyToken(encryptedAuthToken, self.authKey, function (err, authToken) {
      scSocket.authToken = authToken || null;

      var authError = self._processTokenError(scSocket, err, encryptedAuthToken);

      var authStatus = {
        isAuthenticated: !!authToken,
        authError: authError
      };

      // Treat authentication failure as a 'soft' error
      respond(null, authStatus);
    });
  });

  scSocket.once('_disconnect', function () {
    clearTimeout(scSocket._handshakeTimeout);
    scSocket.off('#handshake');
    scSocket.off('#authenticate');
  });

  scSocket._handshakeTimeout = setTimeout(this._handleHandshakeTimeout.bind(this, scSocket), this.ackTimeout);

  scSocket.once('#handshake', function (data, respond) {
    if (!data) {
      data = {};
    }
    var encryptedAuthToken = data.authToken;
    clearTimeout(scSocket._handshakeTimeout);

    self.auth.verifyToken(encryptedAuthToken, self.authKey, function (err, authToken) {
      scSocket.authToken = authToken || null;

      var authError;

      if (encryptedAuthToken != null) {
        authError = self._processTokenError(scSocket, err, encryptedAuthToken);
      }

      self.clients[id] = scSocket;
      self.clientsCount++;

      self._ioClusterClient.bind(scSocket, function (err, sock, isNotice) {
        if (err) {
          var errorMessage = 'Failed to bind socket to io cluster - ' + err;
          scSocket.emit('#fail', errorMessage);
          scSocket.disconnect();
          if (isNotice) {
            self.emit('notice', errorMessage);
          } else {
            self.emit('error', new Error(errorMessage));
          }
          respond(err);

        } else {
          scSocket.state = scSocket.OPEN;
          scSocket.global = self.global;

          self.emit('_connection', scSocket);
          self.emit('connection', scSocket);

          var status = {
            id: scSocket.id,
            isAuthenticated: !!authToken,
            pingTimeout: self.pingTimeout
          };

          if (authError) {
            status.authError = authError;
          }

          // Treat authentication failure as a 'soft' error
          respond(null, status);
        }
      });

      scSocket.once('_disconnect', function () {
        delete self.clients[id];
        self.clientsCount--;

        self._ioClusterClient.unbind(scSocket, function (err) {
          if (err) {
            self.emit('error', new Error('Failed to unbind socket from io cluster - ' + err));
          } else {
            self.emit('_disconnection', scSocket);
            self.emit('disconnection', scSocket);
          }
        });
      });
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

SCServer.prototype.removeMiddleware = function (type, middleware) {
  var middlewareFunctions = this._middleware[type];

  this._middleware[type] = middlewareFunctions.filter(function (fn) {
    return fn != middleware;
  });
};

SCServer.prototype.verifyHandshake = function (info, cb) {
  var self = this;

  var req = info.req;
  var origin = info.origin;
  if (origin == 'null' || origin == null) {
    origin = '*';
  }
  var ok = false;

  if (this._allowAllOrigins) {
    ok = true;
  } else {
    try {
      var parts = url.parse(origin);
      parts.port = parts.port || 80;
      ok = ~this.origins.indexOf(parts.hostname + ':' + parts.port) ||
        ~this.origins.indexOf(parts.hostname + ':*') ||
        ~this.origins.indexOf('*:' + parts.port);
    } catch (e) {}
  }

  if (ok) {
    var handshakeMiddleware = this._middleware[this.MIDDLEWARE_HANDSHAKE];
    if (handshakeMiddleware.length) {
      var callbackInvoked = false;
      async.applyEachSeries(handshakeMiddleware, req, function (err) {
        if (callbackInvoked) {
          self.emit('notice', new Error('Callback for ' + self.MIDDLEWARE_HANDSHAKE + ' middleware was already invoked'));
        } else {
          callbackInvoked = true;
          if (err) {
            if (self.middlewareEmitNotices) {
              self.emit('notice', err);
            }
            cb(false, 401, err);
          } else {
            cb(true);
          }
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
};

SCServer.prototype._isPrivateTransmittedEvent = function (event) {
  return !!event && event.indexOf('#') == 0;
};

SCServer.prototype.verifyInboundEvent = function (socket, event, data, cb) {
  var self = this;

  var callbackInvoked = false;

  if (this._isPrivateTransmittedEvent(event)) {
    if (event == this._subscribeEvent) {
      async.applyEachSeries(this._middleware[this.MIDDLEWARE_SUBSCRIBE], socket, data,
        function (err) {
          if (callbackInvoked) {
            self.emit('notice', new Error('Callback for ' + self.MIDDLEWARE_SUBSCRIBE + ' middleware was already invoked'));
          } else {
            callbackInvoked = true;
            if (err && self.middlewareEmitNotices) {
              self.emit('notice', err);
            }
            cb(err);
          }
        }
      );
    } else if (event == this._publishEvent) {
      if (this.allowClientPublish) {
        async.applyEachSeries(this._middleware[this.MIDDLEWARE_PUBLISH_IN], socket, data.channel, data.data,
          function (err) {
            if (callbackInvoked) {
              self.emit('notice', new Error('Callback for ' + self.MIDDLEWARE_PUBLISH_IN + ' middleware was already invoked'));
            } else {
              callbackInvoked = true;
              if (err) {
                if (self.middlewareEmitNotices) {
                  self.emit('notice', err);
                }
                cb(err);
              } else {
                self.global.publish(data.channel, data.data, function (err) {
                  cb(err);
                });
              }
            }
          }
        );
      } else {
        cb(this.ERROR_NO_PUBLISH);
      }
    } else {
      // Do not allow blocking other reserved events or it could interfere with SC behaviour
      cb();
    }
  } else {
    async.applyEachSeries(this._middleware[this.MIDDLEWARE_EMIT], socket, event, data,
      function (err) {
        if (callbackInvoked) {
          self.emit('notice', new Error('Callback for ' + self.MIDDLEWARE_EMIT + ' middleware was already invoked'));
        } else {
          callbackInvoked = true;
          if (err && self.middlewareEmitNotices) {
            self.emit('notice', err);
          }
          cb(err);
        }
      }
    );
  }
};

SCServer.prototype.verifyOutboundEvent = function (socket, event, data, cb) {
  var self = this;

  var callbackInvoked = false;

  if (event == this._publishEvent) {
    async.applyEachSeries(this._middleware[this.MIDDLEWARE_PUBLISH_OUT], socket, data.channel, data.data,
      function (err) {
        if (callbackInvoked) {
          self.emit('notice', new Error('Callback for ' + self.MIDDLEWARE_PUBLISH_OUT + ' middleware was already invoked'));
        } else {
          callbackInvoked = true;
          if (err) {
            if (err !== true && self.middlewareEmitNotices) {
              self.emit('notice', err);
            }
            cb(err);
          } else {
            cb();
          }
        }
      }
    );
  } else {
    cb();
  }
};

module.exports = SCServer;
