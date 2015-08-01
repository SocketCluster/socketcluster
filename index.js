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
var pkg = require('./package.json');
var argv = require('minimist')(process.argv.slice(2));

var SocketCluster = function (options) {
  var self = this;
  
  self.EVENT_FAIL = 'fail';
  self.EVENT_NOTICE = 'notice';
  self.EVENT_READY = 'ready';
  self.EVENT_WORKER_START = 'workerStart';
  self.EVENT_WORKER_EXIT = 'workerExit';
  
  // These events don't get triggered on SocketCluster (yet)
  self.EVENT_INFO = 'info';
  
  self._errorAnnotations = {
    'listen EADDRINUSE': 'Failed to bind to a port because it was already used by another process.'
  };

  self._errorDomain = domain.create();
  self._errorDomain.on('error', function (err) {
    self.errorHandler(err, {
      type: 'master'
    });
  });
  self._errorDomain.add(self);

  self._errorDomain.run(function () {
    self._init(options);
  });
  
  process.on('SIGTERM', function () {
    self.killWorkers();
    self.killBrokers();
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
    workers: null,
    brokers: null,
    appName: null,
    instanceId: null,
    secretKey: null,
    authKey: null,
    rebootWorkerOnCrash: null,
    killWorkerMemoryThreshold: null,
    protocol: 'http',
    protocolOptions: null,
    logLevel: 2,
    ackTimeout: 10000,
    pingInterval: 8000,
    pingTimeout: 20000,
    origins: '*:*',
    socketChannelLimit: 1000,
    workerStatusInterval: 10000,
    processTermTimeout: 10000,
    defaultAuthTokenExpiryInMinutes: 1440,
    propagateErrors: true,
    propagateNotices: true,
    middlewareEmitNotices: true,
    host: null,
    tcpSynBacklog: null,
    workerController: null,
    brokerController: null,
    rebootOnSignal: true,
    downgradeToUser: false,
    path: null,
    socketRoot: null,
    schedulingPolicy: null,
    allowClientPublish: true,
    defaultWorkerDebugPort: 5858,
    defaultBrokerDebugPort: 6858,
    httpServerModule: null,
    clusterEngine: 'iocluster'
  };

  self._active = false;
  self._workerCluster = null;
  
  self._colorCodes = {
    red: 31,
    green: 32,
    yellow: 33
  };

  for (var i in options) {
    self.options[i] = options[i];
  }
  
  var maxTimeout = Math.pow(2, 31) - 1;
  
  var verifyDuration = function (propertyName) {
    if (self.options[propertyName] > maxTimeout) {
      throw new Error('The ' + propertyName +
        ' value provided exceeded the maximum amount allowed');
    }
  };
  
  verifyDuration('ackTimeout');
  verifyDuration('pingInterval');
  verifyDuration('pingTimeout');
  verifyDuration('workerStatusInterval');
  verifyDuration('processTermTimeout');

  if (self.options.appName == null) {
    self.options.appName = uuid.v4();
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
  
  if (self.options.brokerController) {
    self._paths.appBrokerControllerPath = path.resolve(self.options.brokerController);
  } else {
    self._paths.appBrokerControllerPath = null;
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

  if (!self.options.brokers || self.options.brokers < 1) {
    self.options.brokers = 1;
  }
  if (typeof self.options.brokers != 'number') {
    throw new Error('The brokers option must be a number');
  }

  if (!self.options.workers || self.options.workers < 1) {
    self.options.workers = 1;
  }
  if (typeof self.options.workers != 'number') {
    throw new Error('The workers option must be a number');
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

SocketCluster.prototype._getBrokerSocketName = function (brokerId) {
  return 'b' + brokerId;
};

SocketCluster.prototype._getBrokerSocketPaths = function () {
  var socketPaths = [];
  for (var i = 0; i < this.options.brokers; i++) {
    socketPaths.push(this._socketDirPath + this._getBrokerSocketName(i));
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
    logMessage = 'Origin: ' + this._capitaliseFirstLetter(obj.origin.type) + '\n' +
      '    [' + objType + '] ' + output;
  } else {
    logMessage = 'Origin: ' + this._capitaliseFirstLetter(obj.origin.type) + ' (PID ' + obj.origin.pid + ')\n' +
      '    [' + objType + '] ' + output;
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
  
  var annotation = this._errorAnnotations[err.message];
  if (annotation) {
    err.stack += '\n    ' + this.colorText('!!', 'red') + ' ' + annotation;
  }
  
  err.origin = origin;
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
  notice.origin = origin;
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

SocketCluster.prototype._workerClusterErrorHandler = function (pid, errorData) {
  this.errorHandler(errorData, {
    type: 'WorkerCluster',
    pid: pid
  });
};

SocketCluster.prototype._workerErrorHandler = function (workerPid, errorData) {
  this.errorHandler(errorData, {
    type: 'Worker',
    pid: workerPid
  });
};

SocketCluster.prototype._ioClusterErrorHandler = function (pid, errorData) {
  this.errorHandler(errorData, {
    type: 'IOCluster',
    pid: pid
  });
};

SocketCluster.prototype._brokerErrorHandler = function (brokerPid, errorData) {
  this.errorHandler(errorData, {
    type: 'Broker',
    pid: brokerPid
  });
};

SocketCluster.prototype._workerNoticeHandler = function (workerPid, noticeData) {
  var origin = {
    type: 'Worker',
    pid: workerPid
  };
  this.noticeHandler(noticeData, origin);
};

SocketCluster.prototype._workerClusterReadyHandler = function () {
  var self = this;
  
  if (!this._active) {
    if (this.options.rebootOnSignal) {
      process.on('SIGUSR2', function () {
        self.killWorkers();
      });
    }
    
    this._active = true;
    this._logDeploymentDetails();
  }
};

SocketCluster.prototype._workerExitHandler = function (workerInfo) {
  if (this.options.logLevel > 0) {
    var message = 'Worker ' + workerInfo.id + ' exited - Exit code: ' + workerInfo.code;
    if (workerInfo.signal) {
      message += ', signal: ' + workerInfo.signal;
    }
    this.log(message);
  }
  this.emit(this.EVENT_WORKER_EXIT, workerInfo);
};

SocketCluster.prototype._workerStartHandler = function (workerInfo) {
  if (this._active && this.options.logLevel > 0 && workerInfo.respawn) {
    this.log('Worker ' + workerInfo.id + ' was respawned');
  }
  this.emit(this.EVENT_WORKER_START, workerInfo);
};

SocketCluster.prototype._handleWorkerClusterExit = function (errorCode) {
  var errorData = {
    message: 'workerCluster exited with code: ' + errorCode
  };
  this.errorHandler(errorData, {
    type: 'workerCluster'
  });
  
  this._launchWorkerCluster();
};

SocketCluster.prototype._launchWorkerCluster = function () {
  var self = this;
  
  var debugPort;
  var execOptions = {
    execArgv: []
  };
  
  if (argv['debug-workers']) {
    if (argv['debug-workers'] == true) {
      debugPort = this.options.defaultWorkerDebugPort;
    } else {
      debugPort = argv['debug-workers'];
    }
    execOptions.execArgv.push('--debug=' + (debugPort - 1));
  }
  
  this._workerCluster = fork(__dirname + '/lib/workercluster.js', process.argv.slice(2), execOptions);
  
  var workerOpts = this._cloneObject(this.options);
  workerOpts.paths = this._paths;
  workerOpts.sourcePort = this.options.port;
  workerOpts.workerCount = this.options.workers;
  workerOpts.brokers = this._getBrokerSocketPaths();
  workerOpts.secretKey = this.options.secretKey;
  workerOpts.authKey = this.options.authKey;
  
  this._workerCluster.send({
    type: 'init',
    data: workerOpts
  });

  this._workerCluster.on('message', function workerHandler(m) {
    if (m.type == 'error') {
      if (m.data.workerPid) {
        self._workerErrorHandler(m.data.workerPid, m.data.error);
      } else {
        self._workerClusterErrorHandler(m.data.pid, m.data.error);
      }
    } else if (m.type == 'notice') {
      self._workerNoticeHandler(m.data.workerPid, m.data.error);
    } else if (m.type == 'ready') {
      self._workerClusterReadyHandler();
    } else if (m.type == 'workerStart') {
      self._workerStartHandler(m.data);
    } else if (m.type == 'workerExit') {
      self._workerExitHandler(m.data);
    } else if (m.type == 'workerMessage') {
      self.emit('workerMessage', m.workerId, m.data);
    }
  });
  
  this._workerCluster.on('exit', this._handleWorkerClusterExit.bind(this));
};

SocketCluster.prototype._logDeploymentDetails = function () {
  if (this.options.logLevel > 0) {
    console.log('   ' + this.colorText('[Active]', 'green') + ' SocketCluster started');
    console.log('            Version: ' + pkg.version);
    console.log('            Port: ' + this.options.port);
    console.log('            Master PID: ' + process.pid);
    console.log('            Worker count: ' + this.options.workers);
    console.log('            Broker count: ' + this.options.brokers);
    console.log();
  }
  this.emit(this.EVENT_READY);
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
  
  self._active = false;

  var ioClusterReady = function () {
    self._ioCluster.removeListener('ready', ioClusterReady);
    self._launchWorkerCluster();
  };
  
  var launchIOCluster = function () {
    var brokerDebugPort = argv['debug-brokers'];
    if (brokerDebugPort == true) {
      brokerDebugPort = self.options.defaultBrokerDebugPort;
    }
    
    self._ioCluster = new self._clusterEngine.IOCluster({
      brokers: self._getBrokerSocketPaths(),
      debug: brokerDebugPort,
      instanceId: self.options.instanceId,
      secretKey: self.options.secretKey,
      expiryAccuracy: self._dataExpiryAccuracy,
      downgradeToUser: self.options.downgradeToUser,
      processTermTimeout: self.options.processTermTimeout,
      brokerOptions: self.options,
      appBrokerControllerPath: self._paths.appBrokerControllerPath
    });
    
    self._ioCluster.on('error', function (err) {
      if (err.brokerPid) {
        self._brokerErrorHandler(err.brokerPid, err);
      } else {
        self._ioClusterErrorHandler(err.pid, err);
      }
    });
    
    self._ioCluster.on('ready', ioClusterReady);
    
    self._ioCluster.on('brokerMessage', function (brokerId, data) {
      self.emit('brokerMessage', brokerId, data);
    });
  };

  launchIOCluster();
};

SocketCluster.prototype.sendToWorker = function (workerId, data) {
  this._workerCluster.send({
    type: 'masterMessage',
    workerId: workerId,
    data: data
  });
};

SocketCluster.prototype.sendToBroker = function (brokerId, data) {
  this._ioCluster.sendToBroker(brokerId, data);
};

SocketCluster.prototype.killWorkers = function () {
  if (this._workerCluster) {
    this._workerCluster.kill('SIGTERM');
  }
};

SocketCluster.prototype.killBrokers = function () {
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
