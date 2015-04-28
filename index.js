var path = require('path');
var crypto = require('crypto');
var EventEmitter = require('events').EventEmitter;
var domain = require('domain');
var fork = require('child_process').fork;
var os = require('os');
var fs = require('fs');
var uidNumber = require('uid-number');
var wrench = require('wrench');
var uuid = require('node-uuid');

var SocketCluster = function (options) {
  var self = this;
  
  self.EVENT_FAIL = 'fail';
  self.EVENT_NOTICE = 'notice';
  self.EVENT_READY = 'ready';
  self.EVENT_WORKER = 'worker';
  
  // These events don't get triggered on SocketCluster (yet)
  self.EVENT_INFO = 'info';

  self._errorDomain = domain.create();
  self._errorDomain.on('error', function (err) {
    self.errorHandler(err, 'master');
  });
  self._errorDomain.add(self);

  self._errorDomain.run(function () {
    self._init(options);
  });
  
  process.on('SIGTERM', function () {
    self.killBalancers();
    self.killWorkers();
    self.killStores();
    process.exit();
  });
};

SocketCluster.prototype = Object.create(EventEmitter.prototype);

SocketCluster.prototype._init = function (options) {
  var self = this;

  var backslashRegex = /\\/g;
  var appDirPath = path.dirname(require.main.filename).replace(backslashRegex, '/');

  self.options = {
    port: 8000,
    balancers: null,
    workers: null,
    stores: null,
    appName: null,
    instanceId: null,
    secretKey: null,
    authKey: null,
    rebootWorkerOnCrash: true,
    protocol: 'http',
    protocolOptions: null,
    transports: ['polling', 'websocket'],
    logLevel: 2,
    connectTimeout: 10000,
    ackTimeout: 10000,
    pingInterval: 25000,
    pingTimeout: 60000,
    socketUpgradeTimeout: 1000,
    maxHttpBufferSize: null,
    maxHttpSockets: null,
    origins: '*:*',
    matchOriginProtocol: true,
    socketChannelLimit: 100,
    pollingDuration: 30000,
    workerStatusInterval: 10000,
    processTermTimeout: 10000,
    defaultAuthTokenExpiryInMinutes: 1440,
    propagateErrors: true,
    propagateNotices: true,
    host: null,
    workerController: null,
    balancerController: null,
    storeController: null,
    balancerOptions: null,
    storeOptions: null,
    rebootOnSignal: true,
    useSmartBalancing: true,
    downgradeToUser: false,
    socketCookieName: null,
    authCookieName: null,
    path: null,
    socketRoot: null,
    schedulingPolicy: null,
    allowClientPublish: true,
    clusterEngine: 'iocluster'
  };

  self._active = false;
  
  self._colorCodes = {
    red: 31,
    green: 32,
    yellow: 33
  };

  for (var i in options) {
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
  
  if (self.options.socketCookieName == null) {
    self.options.socketCookieName = 'n/' + self.options.appName + '/io';
  }

  self._paths = {
    appDirPath: appDirPath,
    statusURL: '/~status',
    appWorkerControllerPath: path.resolve(self.options.workerController)
  };
  
  var pathHasher = crypto.createHash('md5');
  pathHasher.update(self._paths.appDirPath, 'utf8');
  var pathHash = pathHasher.digest('hex').substr(0, 10);

  if (process.platform == 'win32') {
    if (self.options.socketRoot) {
      self._socketDirPath = self.options.socketRoot + '_';
    } else {
      self._socketDirPath = '\\\\.\\pipe\\socketcluster_' + self.options.appName + '_' + pathHash + '_';
    }
  } else {
    var socketDir, socketParentDir;
    if (self.options.socketRoot) {
      socketDir = self.options.socketRoot.replace(/\/$/, '') + '/';
    } else {
      socketParentDir = os.tmpdir() + '/socketcluster/';
      socketDir = socketParentDir + self.options.appName + '_' + pathHash + '/';
    }
    if (fs.existsSync(socketDir)) {
      try {
        wrench.rmdirSyncRecursive(socketDir);
      } catch (err) {
        throw new Error('Failed to remove old socket directory ' + socketDir + '. Try removing it manually.');
      }
    }
    wrench.mkdirSyncRecursive(socketDir);
    if (socketParentDir) {
      try {
        fs.chmodSync(socketParentDir, '1777');
      } catch (err) {}
    }
    self._socketDirPath = socketDir;
  }

  if (self.options.balancerController) {
    self._paths.balancerControllerPath = path.resolve(self.options.balancerController);
  } else {
    self._paths.balancerControllerPath = null;
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
      protoOpts.pfx = protoOpts.pfx.toString('base64');
    }
    if (protoOpts.passphrase == null) {
      if (protoOpts.key) {
        var privKeyEncLine = protoOpts.key.split('\n')[1];
        if (privKeyEncLine.toUpperCase().indexOf('ENCRYPTED') > -1) {
          var message = 'The supplied private key is encrypted and cannot be used without a passphrase - ' +
            'Please provide a valid passphrase as a property to protocolOptions';
          throw new Error(message);
        }
      } else if (protoOpts.pfx) {
        var message = 'The supplied pfx certificate cannot be used without a passphrase - ' +
            'Please provide a valid passphrase as a property to protocolOptions';
        throw new Error(message);
      } else {
        var message = 'The supplied protocolOptions were invalid - ' +
          'Please provide either a key and cert pair or a pfx certificate';
        throw new Error(message);
      }
    }
  }

  if (!self.options.stores || self.options.stores < 1) {
    self.options.stores = 1;
  }
  if (typeof self.options.stores != 'number') {
    throw new Error('The stores option must be a number');
  }

  if (!self.options.workers || self.options.workers < 1) {
    self.options.workers = 1;
  }
  if (typeof self.options.workers != 'number') {
    throw new Error('The workers option must be a number');
  }

  if (!self.options.balancers) {
    self.options.balancers = Math.floor(self.options.workers / 2);
    if (self.options.balancers < 1) {
      self.options.balancers = 1;
    }
  }
  if (typeof self.options.balancers != 'number') {
    throw new Error('The balancers option must be a number');
  }

  self._extRegex = /[.][^\/\\]*$/;
  self._slashSequenceRegex = /\/+/g;
  self._startSlashRegex = /^\//;

  self._dataExpiryAccuracy = 5000;

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
  if (process.platform == 'win32') {
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
  }

  if (self.options.downgradeToUser && process.platform != 'win32') {
    if (typeof self.options.downgradeToUser == 'number') {
      fs.chownSync(self._socketDirPath, self.options.downgradeToUser, 0);
      self._start();
    } else {
      uidNumber(self.options.downgradeToUser, function (err, uid, gid) {
        if (err) {
          throw new Error('Failed to downgrade to user "' + self.options.downgradeToUser + '" - ' + err);
        } else {
          fs.chownSync(self._socketDirPath, uid, gid);
          self._start();
        }
      });
    }
  } else {
    self._start();
  }
};

SocketCluster.prototype._getWorkerSocketName = function (workerId) {
  return 'w' + workerId;
};

SocketCluster.prototype._getWorkerSocketNames = function () {
  var socketNames = [];
  for (var i = 0; i < this.options.workers; i++) {
    socketNames.push(this._getWorkerSocketName(i));
  }
  return socketNames;
};

SocketCluster.prototype._getStoreSocketName = function (storeId) {
  return 's' + storeId;
};

SocketCluster.prototype._getStoreSocketPaths = function () {
  var socketPaths = [];
  for (var i = 0; i < this.options.stores; i++) {
    socketPaths.push(this._socketDirPath + this._getStoreSocketName(i));
  }
  return socketPaths;
};

SocketCluster.prototype._capitaliseFirstLetter = function (str) {
  if (str == null) {
    str = '';
  }
  return str.charAt(0).toUpperCase() + str.slice(1);
};

SocketCluster.prototype._logObject = function (obj, objType, time) {
  if (!objType) {
    objType = 'Error';
  }
  if (!obj.origin) {
    obj.origin = {};
  }
  if (!obj.origin.type) {
    obj.origin.type = 'Undefined';
  }
  var output = obj.stack || obj.message || obj;
  
  var logMessage;
  if (obj.origin.pid == null) {
    logMessage = 'Origin: ' + this._capitaliseFirstLetter(obj.origin.type) + '\n    ' +
      objType + ': ' + output;
  } else {
    logMessage = 'Origin: ' + this._capitaliseFirstLetter(obj.origin.type) + ' (PID ' + obj.origin.pid + ')\n    ' +
      objType + ': ' + output;
  }
  this.log(logMessage, time);
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
  
  this._logObject(err, 'Error');
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
    this._logObject(notice, 'Notice');
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
      message: info,
      time: Date.now()
    };
    this.emit(this.EVENT_INFO, infoData);

    if (this.options.logLevel > 0) {
      this._logObject(infoData, 'Info', infoData.time)
    }
  }
};

SocketCluster.prototype._initLoadBalancer = function () {
  this._balancer.send({
    type: 'init',
    data: {
      secretKey: this.options.secretKey,
      sourcePort: this.options.port,
      socketDirPath: this._socketDirPath,
      workers: this._getWorkerSocketNames(),
      balancerCount: this.options.balancers,
      balancerOptions: this.options.balancerOptions,
      protocol: this.options.protocol,
      protocolOptions: this.options.protocolOptions,
      useSmartBalancing: this.options.useSmartBalancing,
      statusURL: this._paths.statusURL,
      checkStatusTimeout: this.options.connectTimeout,
      statusCheckInterval: this.options.workerStatusInterval,
      processTermTimeout: this.options.processTermTimeout,
      downgradeToUser: this.options.downgradeToUser,
      schedulingPolicy: this.options.schedulingPolicy,
      balancerControllerPath: this._paths.balancerControllerPath
    }
  });
};

SocketCluster.prototype._launchLoadBalancer = function (callback) {
  var self = this;

  var balancerErrorHandler = function (err) {
    self.errorHandler(err, {type: 'balancer'});
  };

  var balancerNoticeHandler = function (noticeMessage) {
    self.noticeHandler(noticeMessage, {type: 'balancer'});
  };

  self._balancer = fork(__dirname + '/lib/balancer.js');
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

SocketCluster.prototype._workerReadyHandler = function (worker) {
  var self = this;
  
  self._workers.push(worker);

  if (self._active && self.options.logLevel > 0) {
    self.log('Worker ' + worker.id + ' was respawned');
  }

  if (self._workers.length >= self.options.workers) {
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
      self._balancer.send({
        type: 'setWorkers',
        data: self._getWorkerSocketNames()
      });
    }
    self._active = true;
  }
  
  self.emit(self.EVENT_WORKER, worker);
};

SocketCluster.prototype._handleWorkerExit = function (worker, code, signal) {
  this._errorDomain.remove(worker);
  var message = '   Worker ' + worker.id + ' died - Exit code: ' + code;

  if (signal) {
    message += ', signal: ' + signal;
  }

  var newWorkers = [];
  var newWorkerSockets = [];
  for (var i in this._workers) {
    if (this._workers[i].id != worker.id) {
      newWorkers.push(this._workers[i]);
      newWorkerSockets.push(this._getWorkerSocketName(this._workers[i].id));
    }
  }

  this._workers = newWorkers;
  this._balancer.send({
    type: 'setWorkers',
    data: newWorkerSockets
  });

  this.errorHandler(new Error(message), {type: 'master'});

  if (this.options.rebootWorkerOnCrash) {
    if (this.options.logLevel > 0) {
      this.log('Respawning worker ' + worker.id);
    }
    this._launchWorker(worker.id, true);
  }
};

SocketCluster.prototype._launchWorker = function (workerId, respawn) {
  var self = this;
  
  var worker = fork(__dirname + '/lib/worker.js');
  worker.on('error', self._workerErrorHandler.bind(self, worker));
  
  worker.id = workerId;

  var workerOpts = self._cloneObject(self.options);
  workerOpts.processTermTimeout;
  workerOpts.paths = self._paths;
  workerOpts.workerId = workerId;
  workerOpts.sourcePort = self.options.port;
  workerOpts.socketDirPath = self._socketDirPath;
  workerOpts.socketName = self._getWorkerSocketName(workerId);
  workerOpts.stores = self._getStoreSocketPaths();
  workerOpts.secretKey = self.options.secretKey;
  workerOpts.authKey = self.options.authKey;
  workerOpts.isLeader = workerId ? false : true;

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
      if (self._firstTime || respawn) {
        self._workerReadyHandler(worker, m);
      }
    }
  });

  worker.on('exit', self._handleWorkerExit.bind(self, worker));
};

SocketCluster.prototype._start = function () {
  var self = this;
  
  if (self.options.secretKey == null) {
    self.options.secretKey = crypto.randomBytes(32).toString('hex');
  }
  if (self.options.authKey == null) {
    self.options.authKey = crypto.randomBytes(32).toString('hex');
  }
  if (self.options.instanceId == null) {
    self.options.instanceId = uuid.v4();
  }

  self._workers = [];
  self._active = false;

  self._firstTime = true;
  self._workersActive = false;

  // Load balancers are last to launch
  self._launchLoadBalancer(function () {
    if (self.options.logLevel > 0) {
      console.log('   ' + self.colorText('[Active]', 'green') + ' SocketCluster started');
      console.log('            Port: ' + self.options.port);
      console.log('            Master PID: ' + process.pid);
      console.log('            Balancer count: ' + self.options.balancers);
      console.log('            Worker count: ' + self.options.workers);
      console.log('            Store count: ' + self.options.stores);
      console.log();
    }
    self.emit(self.EVENT_READY);
  });
  
  self._workerIdCounter = 1;

  var ioClusterReady = function () {
    self._ioCluster.removeListener('ready', ioClusterReady);

    var len = self.options.workers;
    for (var j = 0; j < len; j++) {
      self._launchWorker(j);
    }
  };

  var launchIOCluster = function () {
    self._ioCluster = new self._clusterEngine.IOCluster({
      stores: self._getStoreSocketPaths(),
      instanceId: self.options.instanceId,
      secretKey: self.options.secretKey,
      expiryAccuracy: self._dataExpiryAccuracy,
      downgradeToUser: self.options.downgradeToUser,
      processTermTimeout: self.options.processTermTimeout,
      storeOptions: self.options.storeOptions,
      appStoreControllerPath: self._paths.appStoreControllerPath
    });

    self._ioCluster.on('error', function (err) {
      self.errorHandler(err, {type: 'store'});
    });
    
    self._ioCluster.on('ready', ioClusterReady);
  };

  launchIOCluster();
};

SocketCluster.prototype.killWorkers = function () {
  for (var i in this._workers) {
    this._workers[i].kill('SIGTERM');
  }
};

SocketCluster.prototype.killBalancers = function () {
  if (this._balancer) {
    this._balancer.kill('SIGTERM');
  }
};

SocketCluster.prototype.killStores = function () {
  if (this._ioCluster) {
    this._ioCluster.destroy();
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
