var http = require('http');
var https = require('https');
var httpProxy = require('http-proxy');
var url = require('url');
var domain = require('domain');
var EventEmitter = require('events').EventEmitter;
var async = require('async');

var SCBalancer = function (options) {
  var self = this;

  this._errorDomain = domain.create();
  this._errorDomain.on('error', function (err) {
    if (!err.message || (err.message != 'read ECONNRESET' && err.message != 'socket hang up')) {
      self.emit('error', err);
    }
  });

  this.MIDDLEWARE_REQUEST = 'request';
  this.MIDDLEWARE_UPGRADE = 'upgrade';
  this.MIDDLEWARE_ERROR = 'error';

  this._middleware = {};
  this._middleware[this.MIDDLEWARE_REQUEST] = [];
  this._middleware[this.MIDDLEWARE_UPGRADE] = [];
  this._middleware[this.MIDDLEWARE_ERROR] = [];

  this.protocol = options.protocol;
  this.protocolOptions = options.protocolOptions;

  this.sourcePort = options.sourcePort;

  this.dataKey = options.dataKey;
  this.statusCheckInterval = options.statusCheckInterval || 5000;
  this.checkStatusTimeout = options.checkStatusTimeout || 10000;
  this.statusURL = options.statusURL || '/~status';
  this.balancerCount = options.balancerCount || 1;
  this.appBalancerControllerPath = options.appBalancerControllerPath;
  this.useSmartBalancing = options.useSmartBalancing;
  this.downgradeToUser = options.downgradeToUser;
  this.socketDirPath = options.socketDirPath;
  
  this._destRegex = /^([^_]*)_([^_]*)_([^_]*)_([^_]*)_/;
  this._sidRegex = /([^A-Za-z0-9]|^)s?sid=([^;]*)/;

  this.setWorkers(options.workers);

  this._proxyHTTP = this._errorDomain.bind(this._proxyHTTP.bind(this));
  this._proxyWebSocket = this._errorDomain.bind(this._proxyWebSocket.bind(this));

  this.workerStatuses = {};
  this.workerQuotas = [];

  this._proxy = httpProxy.createProxyServer({
    xfwd: true,
    ws: true
  });
  
  this._proxy.on('error', this._handleError.bind(this));

  if (this.protocol == 'https') {
    if(this.protocolOptions.pfx) this.protocolOptions.pfx = require('fs').readFileSync(this.protocolOptions.pfx);
    this._server = https.createServer(this.protocolOptions, this._handleRequest.bind(this));
  } else {
    this._server = http.createServer(this._handleRequest.bind(this));
  }

  this._errorDomain.add(this._server);

  this._server.on('upgrade', this._handleUpgrade.bind(this));

  if (this.useSmartBalancing) {
    setInterval(this._errorDomain.bind(this._updateStatus.bind(this)), this.statusCheckInterval);
  }
};

SCBalancer.prototype = Object.create(EventEmitter.prototype);

SCBalancer.prototype.start = function () {
  var self = this;

  if (this.appBalancerControllerPath) {
    this._errorDomain.run(function () {
      self.balancerController = require(self.appBalancerControllerPath);
      self.balancerController.run(self);
    });
  }

  this._server.listen(this.sourcePort);
  
  if (this.downgradeToUser && process.setuid) {
    try {
      process.setuid(this.downgradeToUser);
    } catch (err) {
      this._errorDomain.emit('error', new Error('Could not downgrade to user "' + this.downgradeToUser +
      '" - Either this user does not exist or the current process does not have the permission' +
      ' to switch to it.'));
    }
  }
};

SCBalancer.prototype.addMiddleware = function (type, middleware) {
  this._middleware[type].push(middleware);
};

SCBalancer.prototype._defaultErrorHandler = function (err, req, res) {
  if (res.writeHead) {
    res.writeHead(500, {
      'Content-Type': 'text/html'
    });
  }

  res.end('Load balancer error - ' + (err.message || err));
};

SCBalancer.prototype._handleError = function (error, req, res) {
  var self = this;

  this.emit('notice', error.message || error);
  
  var errorMiddleware = this._middleware[this.MIDDLEWARE_ERROR];
  if (errorMiddleware.length) {
    async.applyEachSeries(errorMiddleware, error, req, res, function (err) {
      if (err) {
        self._errorDomain.emit('error', err);
      } else {
        self._defaultErrorHandler(error, req, res);
      }
    });
  } else {
    this._defaultErrorHandler(error, req, res);
  }
};

SCBalancer.prototype._handleRequest = function (req, res) {
  var self = this;

  var requestMiddleware = this._middleware[this.MIDDLEWARE_REQUEST];
  if (requestMiddleware.length) {
    async.applyEachSeries(requestMiddleware, req, res, function (err) {
      if (err) {
        self._errorDomain.emit('error', err);
      } else {
        self._proxyHTTP(req, res);
      }
    });
  } else {
    this._proxyHTTP(req, res);
  }
};

SCBalancer.prototype._handleUpgrade = function (req, socket, head) {
  var self = this;
  
  var upgradeMiddleware = this._middleware[this.MIDDLEWARE_UPGRADE];
  if (upgradeMiddleware.length) {
    async.applyEachSeries(upgradeMiddleware, req, socket, head, function (err) {
      if (err) {
        self._errorDomain.emit('error', err);
      } else {
        self._proxyWebSocket(req, socket, head);
      }
    });
  } else {
    this._proxyWebSocket(req, socket, head);
  }
};

SCBalancer.prototype._proxyHTTP = function (req, res) {
  var dest;
  if (this.useSmartBalancing) {
    dest = this._parseSessionDest(req);
    if (dest) {
      if (this.destSocketPaths[dest.socketPath] == null) {
        dest.socketPath = this._chooseTargetSocketPath();
      }
    } else {
      dest = {
        socketPath: this._chooseTargetSocketPath()
      };
    }
  } else {
    dest = this._parseIPDest(req);
  }
  this._proxy.web(req, res, {
    target: dest
  });
};

SCBalancer.prototype._proxyWebSocket = function (req, socket, head) {
  var dest;
  if (this.useSmartBalancing) {
    dest = this._parseSessionDest(req);
    if (dest) {
      if (this.destSocketPaths[dest.socketPath] == null) {
        dest.socketPath = this._randomSocketPath();
      }
    } else {
      dest = {
        socketPath: this._chooseTargetSocketPath()
      };
    }
  } else {
    dest = this._parseIPDest(req);
  }
  this._proxy.ws(req, socket, head, {
    target: dest
  });
};

SCBalancer.prototype.setWorkers = function (workers) {
  this.destSocketPaths = {};
  for (var i in workers) {
    this.destSocketPaths[this.socketDirPath + workers[i]] = 1;
  }
  this.workers = workers;
};

SCBalancer.prototype._randomSocketPath = function () {
  var rand = Math.floor(Math.random() * this.workers.length);
  return this.socketDirPath + this.workers[rand];
};

SCBalancer.prototype._chooseTargetSocketPath = function () {
  if (this.workerQuotas.length) {
    var leastBusyWorker = this.workerQuotas[this.workerQuotas.length - 1];
    leastBusyWorker.quota--;
    if (leastBusyWorker.quota < 1) {
      this.workerQuotas.pop();
    }
    return leastBusyWorker.socketPath;
  }
  return this._randomSocketPath();
};

SCBalancer.prototype._calculateWorkerQuotas = function () {
  var clientCount;
  var maxClients = 0;
  var workerClients = {};
  this.workerQuotas = [];
  
  for (var i in this.workerStatuses) {
    if (this.workerStatuses[i]) {
      clientCount = this.workerStatuses[i].clientCount;
      if (clientCount > maxClients) {
        maxClients = clientCount;
      }
    } else {
      clientCount = Infinity;
    }
    workerClients[i] = clientCount;
  }

  for (var j in workerClients) {
    var targetQuota = Math.round((maxClients - workerClients[j]) / this.balancerCount);
    if (targetQuota > 0) {
      this.workerQuotas.push({
        socketPath: j,
        quota: targetQuota
      });
    }
  }

  this.workerQuotas.sort(function (a, b) {
    return a.quota - b.quota;
  });
};

SCBalancer.prototype._updateStatus = function () {
  var self = this;
  var statusesRead = 0;
  var workerCount = this.workers.length;

  var body = {
    dataKey: self.dataKey
  };

  for (var i in this.workers) {
    (function (workerSocketName) {
      var workerSocketPath = self.socketDirPath + workerSocketName;
      
      var options = {
        socketPath: workerSocketPath,
        method: 'POST',
        path: self.statusURL
      };

      var req = http.request(options, function (res) {
        res.setEncoding('utf8');
        var buffers = [];

        res.on('data', function (chunk) {
          buffers.push(chunk);
        });

        res.on('end', function () {
          var result = Buffer.concat(buffers).toString();
          if (result) {
            try {
              self.workerStatuses[workerSocketPath] = JSON.parse(result);
            } catch (err) {
              self.workerStatuses[workerSocketPath] = null;
            }
          } else {
            self.workerStatuses[workerSocketPath] = null;
          }

          if (++statusesRead >= workerCount) {
            self._calculateWorkerQuotas.call(self);
          }
        });
      });

      req.on('socket', function (socket) {
        socket.setTimeout(self.checkStatusTimeout);
        socket.on('timeout', function () {
          req.abort();
        })
      });

      req.write(JSON.stringify(body));
      req.end();
    })(this.workers[i]);
  }
};

SCBalancer.prototype._hash = function (str, maxValue) {
  var ch;
  var hash = 0;
  if (str.length == 0) return hash;
  for (var i = 0; i < str.length; i++) {
    ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash = hash & hash;
  }
  return Math.abs(hash) % maxValue;
};

SCBalancer.prototype._parseIPDest = function (req) {
  if (req.connection) {
    var ipAddress;
    var headers = req.headers || {};
    var forwardedFor = headers['x-forwarded-for'];
    if (forwardedFor) {
      var forwardedClientIP;
      // For efficiency purposes since in many cases there won't be a comma
      if (forwardedFor.indexOf(',') > -1) {
        forwardedClientIP = forwardedFor.split(',')[0];
      } else {
        forwardedClientIP = forwardedFor;
      }
      ipAddress = forwardedClientIP;
    } else {
      ipAddress = req.connection.remoteAddress;
    }
    
    var workerIndex = this._hash(ipAddress, this.workers.length);
    
    var dest = {
      socketPath: this.socketDirPath + this.workers[workerIndex]
    };
    return dest;
  }
  return null;
};

SCBalancer.prototype._parseSessionDest = function (req) {
  if (!req.headers || !req.headers.host) {
    return null;
  }

  var urlData = url.parse(req.url);
  var query = urlData.query || '';
  var cookie = '';

  if (req.headers && req.headers.cookie) {
    cookie = req.headers.cookie;
  }

  if (!query && !cookie) {
    return null;
  }

  var matches = query.match(this._sidRegex) || cookie.match(this._sidRegex);

  if (!matches) {
    return null;
  }

  var routString = matches[2];
  var destMatch = routString.match(this._destRegex);

  if (!destMatch) {
    return null;
  }

  var destSocketName = destMatch[2];
  if (!destSocketName) {
    return null;
  }

  var dest = {
    socketPath: this.socketDirPath + destSocketName
  };

  return dest;
};

module.exports = SCBalancer;
