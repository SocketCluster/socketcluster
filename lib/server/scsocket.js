var EventEmitter = require('events').EventEmitter;
var formatter = require('./formatter');
var Response = require('./response').Response;


var SCSocket = function (id, server, socket) {
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
  
  this.id = id;
  this.server = server;
  this.socket = socket;
  
  this.request = this.socket.upgradeReq;
  
  // TODO: Deprecate remoteAddress in favor of firstAddress
  this.firstAddress = this.remoteAddress = this.request.firstAddress;
  
  this._cid = 1;
  this._callbackMap = {};
  
  this.socket.onerror = function (err) {
    EventEmitter.prototype.emit.call(self, 'error', err);
  };
  
  this.socket.onclose = function (code, message) {
    EventEmitter.prototype.emit.call(self, 'disconnect', code, message);
  };
  
  // Receive incoming raw messages
  this.socket.onmessage = function (messageEvent, flags) {
    var message = messageEvent.data;
    
    EventEmitter.prototype.emit.call(self, 'message', message);
    var json = formatter.parse(message);
    
    if (json.event) {
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
              EventEmitter.prototype.emit.call(self, json.event, json.data, response);
            }
          }
        });
      }
    } else if (json.cid == null) {
      // If incoming message has no cid, then we emit it as raw data
      EventEmitter.prototype.emit.call(self, 'raw', message);
    } else {
      // If incoming message is a response to a previously sent message
      var ret = self._callbackMap[json.cid];
      if (ret) {
        clearTimeout(ret.timeout);
        delete self._callbackMap[json.cid];
        ret.callback(json.error, json.data);
      }
    }
  };
};

SCSocket.prototype = Object.create(EventEmitter.prototype);

SCSocket.prototype._nextCallId = function () {
  return this._cid++;
};

SCSocket.prototype.disconnect = function (code, data) {
  this.socket.close(code, data);
  return this;
};

SCSocket.prototype.terminate = function () {
  this.socket.terminate();
  return this;
};

SCSocket.prototype.send = function (data, options, callback) {
  this.socket.send(data, options, callback);
  return this;
};

SCSocket.prototype.emitRaw = function (eventObject) {
  this.send(formatter.stringify(eventObject));
  return this;
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
  return this;
};

module.exports = SCSocket;