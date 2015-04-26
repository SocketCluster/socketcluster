var engine = require('engine.io');
var EventEmitter = require('events').EventEmitter;
var Socket = engine.Socket;
var formatter = require('./formatter');

var Response = function (socket, id) {
  this.socket = socket;
  this.id = id;
  this.sent = false;
};

Response.prototype._respond = function (responseData) {
  if (this.sent) {
    throw new Error('Response ' + this.id + ' has already been sent');
  } else {
    this.sent = true;
    this.socket.send(formatter.stringify(responseData));
  }
};

Response.prototype.end = function (data) {
  if (this.id) {
    var responseData = {
      rid: this.id
    };
    if (data !== undefined) {
      responseData.data = data;
    }
    
    this._respond(responseData);
  }
};

Response.prototype.error = function (error, data) {
  if (this.id) {
    var err;
    if (error instanceof Error) {
      err = {name: error.name, message: error.message, stack: error.stack};      
    } else {
      err = error;
    }
    
    var responseData = {
      rid: this.id,
      error: err
    };
    if (data !== undefined) {
      responseData.data = data;
    }
    
    this._respond(responseData);
  }
};

Response.prototype.callback = function (error, data) {
  if (error) {
    this.error(error, data);
  } else {
    this.end(data);
  }
};

var SCSocket = function (id, server, transport, req, authData) {
  var self = this;
  
  this._localEvents = {
    'open': 1,
    'error': 1,
    'packet': 1,
    'heartbeat': 1,
    'data': 1,
    'raw': 1,
    'message': 1,
    'upgrade': 1,
    'close': 1,
    'packetCreate': 1,
    'flush': 1,
    'drain': 1,
    'disconnect': 1
  };
  
  this._autoAckEvents = {
    'ready': 1,
    'publish': 1
  };
  
  Socket.call(this, id, server, transport, req);
  
  this._cid = 1;
  this._callbackMap = {};
  this._messageHandlers = [];
  this._closeHandlers = [];
  
  this._authToken = authData.token || null;
  
  this.addMessageHandler(function (message) {
    var obj = formatter.parse(message);
    
    if (obj == null) {
      var err = new Error('Received empty message');
      EventEmitter.prototype.emit.call(self, 'error', err);
    } else if (obj.event) {
      if (self._localEvents[obj.event] == null) {
        var response = new Response(self, obj.cid);
        server.verifyInboundEvent(self, obj.event, obj.data, function (err) {
          if (err) {
            response.error(err);
          } else {
            if (self._autoAckEvents[obj.event]) {
              response.end();
              EventEmitter.prototype.emit.call(self, obj.event, obj.data);
            } else {
              EventEmitter.prototype.emit.call(self, obj.event, obj.data, function (error, data) {
                response.callback(error, data);
              });
            }
          }
        });
      }
    } else if (obj.rid != null) {
      var ret = self._callbackMap[obj.rid];
      if (ret) {
        clearTimeout(ret.timeout);
        delete self._callbackMap[obj.rid];
        ret.callback(obj.error, obj.data);
      }
    } else {
      EventEmitter.prototype.emit.call(self, 'raw', message);
    }
  });

  // Emit initial status to client
  this.emit('ready', {
    id: id,
    isAuthenticated: !!this._authToken,
    authError: authData.error,
    pingTimeout: this.server.pingTimeout
  });
  
  this._readyStateMap = {
    'opening': this.CONNECTING,
    'open': this.OPEN,
    'closing': this.CLOSING,
    'closed': this.CLOSED
  };
};

SCSocket.prototype = Object.create(Socket.prototype);

SCSocket.CONNECTING = SCSocket.prototype.CONNECTING = 'connecting';
SCSocket.OPEN = SCSocket.prototype.OPEN = 'open';
SCSocket.CLOSING = SCSocket.prototype.CLOSING = 'closing';
SCSocket.CLOSED = SCSocket.prototype.CLOSED = 'closed';

SCSocket.prototype._nextCallId = function () {
  return this._cid++;
};

SCSocket.prototype.getState = function () {
  var state = this._readyStateMap[this.readyState];
  if (state == null) {
    return this.CLOSED;
  }
  return state;
};

SCSocket.prototype._onMessage = function (message) {
  for (var i in this._messageHandlers) {
    this._messageHandlers[i](message);
  }
};

SCSocket.prototype.onClose = function (reason) {
  if (reason == 'ping timeout') {
    this.emit('pingTimeout');
  }
  if (this.readyState != this.CLOSED) {
    for (var i in this._closeHandlers) {
      this._closeHandlers[i].apply(this, arguments);
    }
  }
  Socket.prototype.onClose.apply(this, arguments);
};

SCSocket.prototype.disconnect = function () {
  this.sendObject({
    disconnect: 1
  });
  return Socket.prototype.close.apply(this);
};

SCSocket.prototype.addMessageHandler = function (callback) {
  this._messageHandlers.push(callback);
};

SCSocket.prototype.addCloseHandler = function (callback) {
  this._closeHandlers.push(callback);
};

SCSocket.prototype.sendObject = function (object) {
  Socket.prototype.send.call(this, formatter.stringify(object));
};

SCSocket.prototype.emit = function (event, data, callback) {
  var self = this;
  
  if (this._localEvents[event] == null) {
    this.server.verifyOutboundEvent(this, event, data, function (err) {
      var eventObject = {
        event: event
      };
      if (data !== undefined) {
        eventObject.data = data;
      }
      eventObject.cid = self._nextCallId();
      
      if (err) {
        callback && callback(err, eventObject);
      } else {
        if (callback) {
          var timeout = setTimeout(function () {
            var error = new Error("Event response for '" + event + "' timed out");
            error.type = 'timeout';
            
            delete self._callbackMap[eventObject.cid];
            callback(error, eventObject);
          }, self.server.ackTimeout);
          
          self._callbackMap[eventObject.cid] = {callback: callback, timeout: timeout};
        }
        self.sendObject(eventObject);
      }
    });
  } else {
    if (event == 'message') {
      this._onMessage(data);
    }
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