var path = require('path');
var crypto = require('crypto');
var EventEmitter = require('events').EventEmitter;
var domain = require('domain');
var fork = require('child_process').fork;

var SocketCluster = function (options) {
  var self = this;

  self.EVENT_FAIL = 'fail';
  self.EVENT_NOTICE = 'notice';
  self.EVENT_INFO = 'info';
  self.EVENT_LEADER_START = 'leaderstart';

  self._errorDomain = domain.create();
  self._errorDomain.on('error', function (err) {
    self.errorHandler(err, 'master');
  });
  self._errorDomain.add(self);

  self._errorDomain.run(function () {
    self._init(options);
  });
};

SocketCluster.prototype = Object.create(EventEmitter.prototype);

SocketCluster.prototype._init = function (options) {
  var self = this;

  var backslashRegex = /\\/g;
  var appDirPath = path.dirname(require.main.filename).replace(backslashRegex, '/');

  self.options = {
    port: 8000,
    workers: null,
    stores: null,
    appName: null,
    workerController: null,
    dataKey: null,
    rebootWorkerOnError: true,
    protocol: 'http',
    protocolOptions: null,
    autoReconnect: true,
    autoReconnectOptions: {
      delay: 10,
      randomness: 10
    },
    transports: ['polling', 'websocket'],
    logLevel: 1,
    connectTimeout: 10,
    sessionTimeout: 1200,
    sessionHeartRate: 4,
    minifyTimeout: 120,
    origins: '*:*',
    matchOriginProtocol: true,
    addressSocketLimit: null,
    pollingDuration: 30,
    heartbeatInterval: 25,
    heartbeatTimeout: 60,
    workerStatusInterval: 10,
    propagateErrors: true,
    host: 'localhost',
    balancerCount: null,
    workerController: null,
    balancerController: null,
    clusterEngine: 'iocluster'
  };

  self._active = false;

  var i;
  for (i in options) {
    self.options[i] = options[i];
  }

  if (self.options.appName == null) {
    throw new Error("Compulsory option 'appName' was not specified " +
      "- It needs to be a string which uniquely identifies this application");
  }

  if (self.options.workerController == null) {
    throw new Error("Compulsory option 'workerController' was not specified " +
      "- It needs to be a path to a JavaScript file which will act as the " +
      "boot controller for each worker in the cluster");
  }

  self._paths = {
    appDirPath: appDirPath,
    statusURL: '/~status',
    appWorkerControllerPath: path.resolve(self.options.workerController)
  };

  if (self.options.balancerController) {
    self._paths.appBalancerControllerPath = path.resolve(self.options.balancerController);
  } else {
    self._paths.appBalancerControllerPath = null;
  }

  if (self.options.logLevel > 3) {
    process.env.DEBUG = 'engine*';
  } else if (self.options.logLevel > 2) {
    process.env.DEBUG = 'engine';
  }

  if (self.options.protocolOptions) {
    var protoOpts = self.options.protocolOptions;
    if (protoOpts.key instanceof Buffer) {
      protoOpts.key = protoOpts.key.toString();
    }
    if (protoOpts.cert instanceof Buffer) {
      protoOpts.cert = protoOpts.cert.toString();
    }
    if (protoOpts.pfx instanceof Buffer) {
      protoOpts.pfx = protoOpts.pfx.toString();
    }
    if (protoOpts.passphrase == null) {
      var privKeyEncLine = protoOpts.key.split('\n')[1];
      if (privKeyEncLine.toUpperCase().indexOf('ENCRYPTED') > -1) {
        var message = 'The supplied private key is encrypted and cannot be used without a passphrase - ' +
          'Please provide a valid passphrase as a property to protocolOptions';
        throw new Error(message);
      }
      process.exit();
    }
  }

  if (self.options.stores) {
    var newStores = [];
    var curStore;

    for (i in self.options.stores) {
      curStore = self.options.stores[i];
      if (typeof curStore == 'number') {
        curStore = {port: curStore};
      } else {
        if (curStore.port == null) {
          throw new Error('One or more store objects is missing a port property');
        }
      }
      newStores.push(curStore);
    }
    self.options.stores = newStores;
  }

  if (!self.options.stores || self.options.stores.length < 1) {
    self.options.stores = [{port: self.options.port + 2}];
  }

  if (self.options.workers) {
    var newWorkers = [];
    var curWorker;

    for (i in self.options.workers) {
      curWorker = self.options.workers[i];
      if (typeof curWorker == 'number') {
        curWorker = {port: curWorker};
      } else {
        if (curWorker.port == null) {
          throw new Error('One or more worker objects is missing a port property');
        }
      }
      newWorkers.push(curWorker);
    }
    self.options.workers = newWorkers;
  } else {
    self.options.workers = [{port: self.options.port + 3}];
  }

  if (!self.options.balancerCount) {
    self.options.balancerCount = Math.floor(self.options.workers.length / 2);
    if (self.options.balancerCount < 1) {
      self.options.balancerCount = 1;
    }
  }

  self._extRegex = /[.][^\/\\]*$/;
  self._slashSequenceRegex = /\/+/g;
  self._startSlashRegex = /^\//;

  self._minAddressSocketLimit = 20;
  self._dataExpiryAccuracy = 5000;

  if (self.options.addressSocketLimit == null) {
    var limit = self.options.sessionTimeout / 40;
    if (limit < self._minAddressSocketLimit) {
      limit = self._minAddressSocketLimit;
    }
    self.options.addressSocketLimit = limit;
  }

  self._clusterEngine = require(self.options.clusterEngine);

  self._colorCodes = {
    red: 31,
    green: 32,
    yellow: 33
  };

  if (self.options.logLevel > 0) {
    console.log('   ' + self.colorText('[Busy]', 'yellow') + ' Launching SocketCluster');
  }

  process.stdin.on('error', function (err) {
    self.noticeHandler(err, {type: 'master'});
  });
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  self._start();
};

SocketCluster.prototype.errorHandler = function (err, origin) {
  if (err.stack == null) {
    if (!(err instanceof Object)) {
      err = new Error(err);
    }
    err.stack = err.message;
  }
  if (origin instanceof Object) {
    err.origin = origin;
  } else {
    err.origin = {
      type: origin
    };
  }
  err.time = Date.now();

  this.emit(this.EVENT_FAIL, err);
  this.log(err.stack);
};

SocketCluster.prototype.noticeHandler = function (notice, origin) {
  if (notice.stack == null) {
    if (!(notice instanceof Object)) {
      notice = new Error(notice);
    }
    notice.stack = notice.message;
  }
  if (origin instanceof Object) {
    notice.origin = origin;
  } else {
    notice.origin = {
      type: origin
    };
  }
  notice.time = Date.now();

  this.emit(this.EVENT_NOTICE, notice);
};

SocketCluster.prototype.triggerInfo = function (info, origin) {
  if (this._active) {
    if (!(origin instanceof Object)) {
      origin = {
        type: origin
      };
    }
    var infoData = {
      origin: origin,
      info: info,
      time: Date.now()
    };
    this.emit(this.EVENT_INFO, infoData);

    if (this.options.logLevel > 0) {
      this.log(info, infoData.time);
    }
  }
};

SocketCluster.prototype._start = function () {
  var self = this;

  self._workers = [];
  self._active = false;

  var leaderId = -1;
  var firstTime = true;

  var workersActive = false;

  var initLoadBalancer = function () {
    self._balancer.send({
      type: 'init',
      data: {
        dataKey: pass,
        sourcePort: self.options.port,
        workers: self.options.workers,
        host: self.options.host,
        balancerCount: self.options.balancerCount,
        protocol: self.options.protocol,
        protocolOptions: self.options.protocolOptions,
        checkStatusTimeout: self.options.connectTimeout * 1000,
        statusURL: self._paths.statusURL,
        statusCheckInterval: self.options.workerStatusInterval * 1000,
        appBalancerControllerPath: self._paths.appBalancerControllerPath
      }
    });
  };

  var launchLoadBalancer = function () {
    if (self._balancer) {
      self._errorDomain.remove(self._balancer);
    }

    var balancerErrorHandler = function (err) {
      self.errorHandler(err, {type: 'balancer'});
    };

    var balancerNoticeHandler = function (noticeMessage) {
      self.noticeHandler(noticeMessage, {type: 'balancer'});
    };

    self._balancer = fork(__dirname + '/balancer.js');
    self._balancer.on('error', balancerErrorHandler);
    self._balancer.on('notice', balancerNoticeHandler);

    self._balancer.on('exit', launchLoadBalancer);
    self._balancer.on('message', function (m) {
      if (m.type == 'error') {
        balancerErrorHandler(m.data);
      } else if (m.type == 'notice') {
        balancerNoticeHandler(m.data);
      }
    });

    if (workersActive) {
      initLoadBalancer();
    }
  };

  launchLoadBalancer();

  var workerIdCounter = 1;

  var ioClusterReady = function () {
    var i;
    var workerReadyHandler = function (data, worker) {
      self._workers.push(worker);
      if (worker.id == leaderId) {
        worker.send({
          type: 'emit',
          event: self.EVENT_LEADER_START
        });
      }

      if (self._active && self.options.logLevel > 0) {
        self.log('Worker ' + worker.data.id + ' was respawned on port ' + worker.data.port);
      }

      if (self._workers.length >= self.options.workers.length) {
        if (firstTime) {
          if (self.options.logLevel > 0) {
            console.log('   ' + self.colorText('[Active]', 'green') + ' SocketCluster started');
            console.log('            Port: ' + self.options.port);
            console.log('            Master PID: ' + process.pid);
            console.log('            Balancer count: ' + self.options.balancerCount);
            console.log('            Worker count: ' + self.options.workers.length);
            console.log('            Store count: ' + self.options.stores.length);
            console.log();
          }
          firstTime = false;

          if (!workersActive) {
            initLoadBalancer();
            workersActive = true;
          }

          process.on('SIGUSR2', function () {
            for (var i in self._workers) {
              self._workers[i].kill();
            }
          });
        } else {
          var workersData = [];
          var i;
          for (i in self._workers) {
            workersData.push(self._workers[i].data);
          }
          self._balancer.send({
            type: 'setWorkers',
            data: workersData
          });
        }
        self._active = true;
      }
    };

    var launchWorker = function (workerData, lead) {
      var workerErrorHandler = function (err) {
        var origin = {
          type: 'worker',
          pid: worker.pid
        };
        self.errorHandler(err, origin);
      };

      var workerNoticeHandler = function (noticeMessage) {
        var origin = {
          type: 'worker',
          pid: worker.pid
        };
        self.noticeHandler(noticeMessage, origin);
      };

      var worker = fork(__dirname + '/worker-bootstrap.js');
      worker.on('error', workerErrorHandler);

      if (!workerData.id) {
        workerData.id = workerIdCounter++;
      }

      worker.id = workerData.id;
      worker.data = workerData;

      var workerOpts = self._cloneObject(self.options);
      workerOpts.paths = self._paths;
      workerOpts.workerId = worker.id;
      workerOpts.sourcePort = self.options.port;
      workerOpts.workerPort = workerData.port;
      workerOpts.stores = stores;
      workerOpts.dataKey = pass;
      workerOpts.lead = lead ? 1 : 0;

      worker.send({
        type: 'init',
        data: workerOpts
      });

      worker.on('message', function workerHandler(m) {
        if (m.type == 'ready') {
          if (lead) {
            leaderId = worker.id;
          }
          workerReadyHandler(m, worker);
        } else if (m.type == 'error') {
          workerErrorHandler(m.data);
        } else if (m.type == 'notice') {
          workerNoticeHandler(m.data);
        }
      });

      worker.on('exit', function (code, signal) {
        self._errorDomain.remove(worker);
        var message = '   Worker ' + worker.id + ' died - Exit code: ' + code;

        if (signal) {
          message += ', signal: ' + signal;
        }

        var workersData = [];
        var newWorkers = [];
        var i;
        for (i in self._workers) {
          if (self._workers[i].id != worker.id) {
            newWorkers.push(self._workers[i]);
            workersData.push(self._workers[i].data);
          }
        }

        self._workers = newWorkers;
        self._balancer.send({
          type: 'setWorkers',
          data: workersData
        });

        var lead = worker.id == leaderId;
        leaderId = -1;
        self.errorHandler(new Error(message), {type: 'master'});

        if (self.options.logLevel > 0) {
          self.log('Respawning worker ' + worker.id);
        }
        launchWorker(workerData, lead);
      });

      return worker;
    };

    var len = self.options.workers.length;
    if (len > 0) {
      launchWorker(self.options.workers[0], true);
      for (i = 1; i < len; i++) {
        launchWorker(self.options.workers[i]);
      }
    }
  };

  var stores = self.options.stores;
  var pass = crypto.randomBytes(32).toString('hex');

  var launchIOCluster = function () {
    self._ioCluster = new self._clusterEngine.IOCluster({
      stores: stores,
      dataKey: pass,
      expiryAccuracy: self._dataExpiryAccuracy
    });

    self._ioCluster.on('error', function (err) {
      self.errorHandler(err, {type: 'store'});
    });
  };

  launchIOCluster();
  self._ioCluster.on('ready', ioClusterReady);
};

SocketCluster.prototype.log = function (message, time) {
  if (time == null) {
    time = Date.now();
  }
  console.log(time + ' - ' + message);
};

SocketCluster.prototype._cloneObject = function (object) {
  var clone = {};
  for (var i in object) {
    clone[i] = object[i];
  }
  return clone;
};

SocketCluster.prototype.colorText = function (message, color) {
  if (this._colorCodes[color]) {
    return '\033[0;' + this._colorCodes[color] + 'm' + message + '\033[0m';
  } else if (color) {
    return '\033[' + color + 'm' + message + '\033[0m';
  }
  return message;
};

module.exports.SocketCluster = SocketCluster;