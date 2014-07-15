var path = require('path');
var crypto = require('crypto');
var EventEmitter = require('events').EventEmitter;
var domain = require('domain');
var fork = require('child_process').fork;

var SocketCluster = function (options) {
  var self = this;
  
  self.EVENT_FAIL = 'fail';
  self.EVENT_NOTICE = 'notice';
  self.EVENT_READY = 'ready';
  
  // These events don't get triggered on SocketCluster (yet)
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
    logLevel: 2,
    connectTimeout: 10,
    sessionTimeout: 1200,
    sessionHeartRate: 4,
    origins: '*:*',
    matchOriginProtocol: true,
    addressSocketLimit: null,
    socketEventLimit: 100,
    pollingDuration: 30,
    heartbeatInterval: 25,
    heartbeatTimeout: 60,
    workerStatusInterval: 10,
    propagateErrors: true,
    host: 'localhost',
    balancerCount: null,
    workerController: null,
    balancerController: null,
    storeController: null,
    rebootOnSignal: true,
    useSmartBalancing: false,
    clusterEngine: 'iocluster'
  };

  self._active = false;
  
  self._colorCodes = {
    red: 31,
    green: 32,
    yellow: 33
  };

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

  if (self.options.sessionTimeout < 60) {
    console.log('   ' + self.colorText('[Warning]', 'yellow') +
      " The sessionTimeout option should be at least 60 seconds " +
      "- A low sessionTimeout requires fast heartbeats which may use " +
      "a lot of CPU at high concurrency levels.");
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
  
  if (self.options.storeController) {
    self._paths.appStoreControllerPath = path.resolve(self.options.storeController);
  } else {
    self._paths.appStoreControllerPath = null;
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

  self._minAddressSocketLimit = 30;
  self._dataExpiryAccuracy = 5000;

  if (self.options.addressSocketLimit == null) {
    var limit = self.options.sessionTimeout / 40;
    if (limit < self._minAddressSocketLimit) {
      limit = self._minAddressSocketLimit;
    }
    self.options.addressSocketLimit = limit;
  }

  self._clusterEngine = require(self.options.clusterEngine);

  if (self.options.logLevel > 0) {
    console.log('   ' + self.colorText('[Busy]', 'yellow') + ' Launching SocketCluster');
  }

  process.stdin.on('error', function (err) {
    self.noticeHandler(err, {type: 'master'});
  });

  /*
    To allow inserting blank lines in console on Windows to aid with debugging.
  */
  if (/^win/.test(process.platform)) {
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
  }

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
  
  if (this.options.logLevel > 1) {
    this.log(notice.stack);
  }
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

SocketCluster.prototype._initLoadBalancer = function () {
  this._balancer.send({
    type: 'init',
    data: {
      dataKey: this._dataKey,
      sourcePort: this.options.port,
      workers: this.options.workers,
      host: this.options.host,
      balancerCount: this.options.balancerCount,
      protocol: this.options.protocol,
      protocolOptions: this.options.protocolOptions,
      useSmartBalancing: this.options.useSmartBalancing,
      checkStatusTimeout: this.options.connectTimeout * 1000,
      statusURL: this._paths.statusURL,
      statusCheckInterval: this.options.workerStatusInterval * 1000,
      appBalancerControllerPath: this._paths.appBalancerControllerPath
    }
  });
};

SocketCluster.prototype._launchLoadBalancer = function (callback) {
  var self = this;
  
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

  self._balancer.on('exit', self._launchLoadBalancer.bind(self));
  self._balancer.on('message', function (m) {
    if (m.type == 'error') {
      balancerErrorHandler(m.data);
    } else if (m.type == 'notice') {
      balancerNoticeHandler(m.data);
    } else if (m.type == 'ready') {
      callback && callback();
    }
  });

  if (self._workersActive) {
    self._initLoadBalancer();
  }
};

SocketCluster.prototype._workerErrorHandler = function (worker, err) {
  var origin = {
    type: 'worker',
    pid: worker.pid
  };
  this.errorHandler(err, origin);
};

SocketCluster.prototype._workerNoticeHandler = function (worker, noticeMessage) {
  var origin = {
    type: 'worker',
    pid: worker.pid
  };
  this.noticeHandler(noticeMessage, origin);
};

SocketCluster.prototype._workerReadyHandler = function (worker, data) {
  var self = this;
  
  self._workers.push(worker);
  
  if (worker.id == self._leaderId) {
    worker.send({
      type: 'emit',
      event: self.EVENT_LEADER_START
    });
  }

  if (self._active && self.options.logLevel > 0) {
    self.log('Worker ' + worker.data.id + ' was respawned on port ' + worker.data.port);
  }

  if (self._workers.length >= self.options.workers.length) {
    if (self._firstTime) {
      self._firstTime = false;

      if (!self._workersActive) {
        self._initLoadBalancer();
        self._workersActive = true;
      }
      
      if (self.options.rebootOnSignal) {
        process.on('SIGUSR2', function () {
          self.killWorkers();
        });
      }
    } else {
      var workersData = [];
      for (var i in self._workers) {
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

SocketCluster.prototype._handleWorkerExit = function (worker, code, signal) {
  this._errorDomain.remove(worker);
  var message = '   Worker ' + worker.id + ' died - Exit code: ' + code;

  if (signal) {
    message += ', signal: ' + signal;
  }

  var workersData = [];
  var newWorkers = [];
  for (var i in this._workers) {
    if (this._workers[i].id != worker.id) {
      newWorkers.push(this._workers[i]);
      workersData.push(this._workers[i].data);
    }
  }

  this._workers = newWorkers;
  this._balancer.send({
    type: 'setWorkers',
    data: workersData
  });

  var lead = worker.id == this._leaderId;
  this._leaderId = -1;
  this.errorHandler(new Error(message), {type: 'master'});

  if (this.options.rebootWorkerOnError) {
    if (this.options.logLevel > 0) {
      this.log('Respawning worker ' + worker.id);
    }
    this._launchWorker(worker.data, lead, true);
  }
};

SocketCluster.prototype._launchWorker = function (workerData, lead, respawn) {
  var self = this;
  
  var worker = fork(__dirname + '/worker.js');
  worker.on('error', self._workerErrorHandler.bind(self, worker));

  if (!workerData.id) {
    workerData.id = self._workerIdCounter++;
  }

  worker.id = workerData.id;
  worker.data = workerData;

  var workerOpts = self._cloneObject(self.options);
  workerOpts.paths = self._paths;
  workerOpts.workerId = worker.id;
  workerOpts.sourcePort = self.options.port;
  workerOpts.workerPort = workerData.port;
  workerOpts.stores = self.options.stores;
  workerOpts.dataKey = self._dataKey;
  workerOpts.lead = lead ? 1 : 0;

  worker.send({
    type: 'init',
    data: workerOpts
  });

  worker.on('message', function workerHandler(m) {
    if (m.type == 'error') {
      self._workerErrorHandler(worker, m.data);
    } else if (m.type == 'notice') {
      self._workerNoticeHandler(worker, m.data);
    } else if (m.type == 'ready') {
      if (lead) {
        self._leaderId = worker.id;
      }
      if (self._firstTime || respawn) {
        self._workerReadyHandler(worker, m);
      }
    }
  });

  worker.on('exit', self._handleWorkerExit.bind(self, worker));
};

SocketCluster.prototype._start = function () {
  var self = this;
  
  self._dataKey = crypto.randomBytes(32).toString('hex');

  self._workers = [];
  self._active = false;

  self._leaderId = -1;
  self._firstTime = true;
  self._workersActive = false;

  // Load balancers are last to launch
  self._launchLoadBalancer(function () {
    if (self.options.logLevel > 0) {
      console.log('   ' + self.colorText('[Active]', 'green') + ' SocketCluster started');
      console.log('            Port: ' + self.options.port);
      console.log('            Master PID: ' + process.pid);
      console.log('            Balancer count: ' + self.options.balancerCount);
      console.log('            Worker count: ' + self.options.workers.length);
      console.log('            Store count: ' + self.options.stores.length);
      console.log();
    }
    self.emit(self.EVENT_READY);
  });
  
  self._workerIdCounter = 1;

  var ioClusterReady = function () {
    self._ioCluster.removeListener('ready', ioClusterReady);

    var len = self.options.workers.length;
    if (len > 0) {
      self._launchWorker(self.options.workers[0], true);
      for (var j = 1; j < len; j++) {
        self._launchWorker(self.options.workers[j]);
      }
    }
  };

  var launchIOCluster = function () {
    self._ioCluster = new self._clusterEngine.IOCluster({
      stores: self.options.stores,
      dataKey: self._dataKey,
      appStoreControllerPath: self._paths.appStoreControllerPath,
      expiryAccuracy: self._dataExpiryAccuracy
    });

    self._ioCluster.on('error', function (err) {
      self.errorHandler(err, {type: 'store'});
    });
  };

  launchIOCluster();
  self._ioCluster.on('ready', ioClusterReady);
};

SocketCluster.prototype.killWorkers = function () {
  for (var i in this._workers) {
    this._workers[i].kill();
  }
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
