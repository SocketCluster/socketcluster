var WebSocket = require('ws');
var EventEmitter = require('events').EventEmitter;
var formatter = require('./formatter');
var Response = require('./response').Response;


var SCSocket = function (id, server, socket, authData) {
  var self = this;
  
  EventEmitter.call(this);
  
  this._localEvents = {
    'open': 1,
    'close': 1,
    'connect': 1,
    'disconnect': 1,
    'error': 1,
    'raw': 1
  };
  
  this._autoAckEvents = {
    'ready': 1,
    'publish': 1
  };
  
  this.id = id;
  this.server = server;
  this.socket = socket;
  
  this.request = this.socket.upgradeReq;
  this.connected = true;
  
  this.remoteAddress = this.request.remoteAddress;
  
  this._cid = 1;
  this._callbackMap = {};
  
  this._authToken = authData.token || null;
  
  this.socket.on('error', function (err) {
    EventEmitter.prototype.emit.call(self, 'error', err);
  });
  
  this.socket.on('close', function (code) {
    self._onSCClose(code);
  });
  
  this._pingIntervalTicker = setInterval(this._sendPing.bind(this), this.server.pingInterval);
  this._resetPingTimeout();
  
  // Receive incoming raw messages
  this.socket.on('message', function (message, flags) {
    self._resetPingTimeout();
    
    EventEmitter.prototype.emit.call(self, 'message', message);
    var json = formatter.parse(message);
    
    if (json == null) {
      var err = new Error('Received empty message');
      EventEmitter.prototype.emit.call(self, 'error', err);
    } else if (json.event) {
      if (self._localEvents[json.event] == null) {
        var response = new Response(self, json.cid);
        self.server.verifyEvent(self, json.event, json.data, function (err) {
          if (err) {
            response.error(err);
          } else {
            if (self._autoAckEvents[json.event]) {
              response.end();
              EventEmitter.prototype.emit.call(self, json.event, json.data);
            } else {
              EventEmitter.prototype.emit.call(self, json.event, json.data, response.callback.bind(response));
            }
          }
        });
      }
    } else if (json.cid == null) {
      // In case of pong, do nothing
      if (!json.pong) {
        // If incoming message has no cid, then we emit it as raw data
        EventEmitter.prototype.emit.call(self, 'raw', message);
      }
    } else {
      // If incoming message is a response to a previously sent message
      var ret = self._callbackMap[json.cid];
      if (ret) {
        clearTimeout(ret.timeout);
        delete self._callbackMap[json.cid];
        ret.callback(json.error, json.data);
      }
    }
  });
  
  // Emit initial status to client
  this.emit('ready', {
    id: this.id,
    isAuthenticated: !!this._authToken,
    authError: authData.error,
    pingTimeout: this.server.pingTimeout
  });
};

SCSocket.prototype = Object.create(EventEmitter.prototype);

SCSocket.CONNECTING = SCSocket.prototype.CONNECTING = WebSocket.prototype.CONNECTING;
SCSocket.OPEN = SCSocket.prototype.OPEN = WebSocket.prototype.OPEN;
SCSocket.CLOSING = SCSocket.prototype.CLOSING = WebSocket.prototype.CLOSING;
SCSocket.CLOSED = SCSocket.prototype.CLOSED = WebSocket.prototype.CLOSED;

SCSocket.ignoreStatuses = {
  1000: 'Socket closed normally',
  1001: 'Socket hung up'
};

SCSocket.errorStatuses = {
  1002: 'A WebSocket protocol error was encountered',
  1003: 'Server terminated socket because it received invalid data',
  1006: 'Socket hung up',
  1007: 'Message format was incorrect',
  1008: 'Encountered a policy violation',
  1009: 'Message was too big to process',
  1010: 'Client ended the connection because the server did not comply with extension requirements',
  1011: 'Server encountered an unexpected fatal condition',
  4000: 'Server ping timed out',
  4001: 'Client pong timed out'
};

SCSocket.prototype._sendPing = function () {
  if (this.getState() == this.OPEN) {
    this.emitRaw({ping: 1});
  }
};

SCSocket.prototype._resetPingTimeout = function () {
  var self = this;
  
  clearTimeout(this._pingTimeoutTicker);
  this._pingTimeoutTicker = setTimeout(function() {
    self.socket.close(4001);
  }, this.server.pingTimeout);
};

SCSocket.prototype._nextCallId = function () {
  return this._cid++;
};

SCSocket.prototype.getState = function () {
  return this.socket.readyState;
};

SCSocket.prototype.getBytesReceived = function () {
  return this.socket.bytesReceived;
};

SCSocket.prototype._onSCClose = function (code) {
  this.connected = false;
  
  clearInterval(this._pingIntervalTicker);
  EventEmitter.prototype.emit.call(this, 'disconnect', code);

  if (!SCSocket.ignoreStatuses[code]) {
    var err = new Error(SCSocket.errorStatuses[code] || 'Socket connection failed for unknown reasons');
    err.code = code;
    EventEmitter.prototype.emit.call(this, 'error', err);
  }
};

SCSocket.prototype.disconnect = function (code, data) {
  this.socket.close(code, data);
};

SCSocket.prototype.terminate = function () {
  this.socket.terminate();
};

SCSocket.prototype.send = function (data, options, callback) {
  var self = this;

  this.socket.send(data, options, function (err) {
    callback && callback(err);
    if (err) {
      EventEmitter.prototype.emit.call(self, 'error', err);
    }
  });
};

SCSocket.prototype.emitRaw = function (eventObject) {
  this.send(formatter.stringify(eventObject));
};

SCSocket.prototype.emit = function (event, data, callback) {
  var self = this;
  
  if (this._localEvents[event] == null) {
    var eventObject = {
      event: event
    };
    if (data !== undefined) {
      eventObject.data = data;
    }
    eventObject.cid = this._nextCallId();
    
    if (callback) {
      var timeout = setTimeout(function () {
        var error = new Error("Event response for '" + event + "' timed out");
        delete self._callbackMap[eventObject.cid];
        callback(error, eventObject);
      }, this.server.ackTimeout);
      
      this._callbackMap[eventObject.cid] = {callback: callback, timeout: timeout};
    }
    this.emitRaw(eventObject);
  } else {
    EventEmitter.prototype.emit.call(this, event, data);
  }
};

SCSocket.prototype.setAuthToken = function (data, options, callback) {
  this._authToken = data;
  var signedToken = this.server.auth.signToken(data, options);
  this.emit('setAuthToken', signedToken, callback);
};

SCSocket.prototype.getAuthToken = function () {
  return this._authToken;
};

SCSocket.prototype.removeAuthToken = function (callback) {
  this._authToken = null;
  this.emit('removeAuthToken', null, callback);
};

module.exports = SCSocket;