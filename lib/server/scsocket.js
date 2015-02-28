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
      cid: this.id
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
      cid: this.id,
      error: err
    };
    if (data !== undefined) {
      responseData.data = data;
    }
    
    this._respond(responseData);
  }
};

var SCSocket = function (id, server, transport, req) {
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
  
  this.addMessageHandler(function (message) {
    var e = formatter.parse(message);
    
    if (e.event) {
      if (self._localEvents[e.event] == null) {
        var response = new Response(self, e.cid);
        server.verifyEvent(self, e.event, e.data, function (err) {
          if (err) {
            response.error(err);
          } else {
            if (self._autoAckEvents[e.event]) {
              response.end();
              EventEmitter.prototype.emit.call(self, e.event, e.data);
            } else {
              EventEmitter.prototype.emit.call(self, e.event, e.data, response);
            }
          }
        });
      }
    } else if (e.cid == null) {
      EventEmitter.prototype.emit.call(self, 'raw', message);
    } else {
      var ret = self._callbackMap[e.cid];
      if (ret) {
        clearTimeout(ret.timeout);
        delete self._callbackMap[e.cid];
        ret.callback(e.error, e.data);
      }
    }
  });
};

SCSocket.prototype = Object.create(Socket.prototype);

SCSocket.prototype._nextCallId = function () {
  return this._cid++;
};

SCSocket.prototype._onMessage = function (message) {
  for (var i in this._messageHandlers) {
    this._messageHandlers[i](message);
  }
};

SCSocket.prototype.disconnect = function () {
  return Socket.prototype.close.apply(this);
};

SCSocket.prototype.addMessageHandler = function (callback) {
  this._messageHandlers.push(callback);
};

SCSocket.prototype.emitRaw = function (eventObject) {
  Socket.prototype.send.call(this, formatter.stringify(eventObject));
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
    if (event == 'message') {
      this._onMessage(data);
    }
    EventEmitter.prototype.emit.call(this, event, data);
  }
};

module.exports = SCSocket;