var path = require('path');
var crypto = require('crypto');
var EventEmitter = require('events').EventEmitter;
var domain = require('sc-domain');
var fork = require('child_process').fork;
var os = require('os');
var fs = require('fs-extra');
var uidNumber = require('uid-number');
var uuid = require('node-uuid');
var pkg = require('./package.json');
var argv = require('minimist')(process.argv.slice(2));
var cluster = require('cluster');

var scErrors = require('sc-errors');
var InvalidOptionsError = scErrors.InvalidOptionsError;
var InvalidActionError = scErrors.InvalidActionError;
var BrokerError = scErrors.BrokerError;
var ProcessExitError = scErrors.ProcessExitError;
var UnknownError = scErrors.UnknownError;

var socketClusterSingleton = null;

var SocketCluster = function (options) {
  var self = this;
  if (socketClusterSingleton) {
    var doubleInstantiationError = new Error('The SocketCluster master object is a singleton - It can only be instantiated once per process.');
    doubleInstantiationError.name = 'DoubleInstantiationError';
    throw doubleInstantiationError;
  }
  socketClusterSingleton = self;

  self.EVENT_FAIL = 'fail';
  self.EVENT_WARNING = 'warning';
  self.EVENT_INFO = 'info';
  self.EVENT_READY = 'ready';
  self.EVENT_WORKER_START = 'workerStart';
  self.EVENT_WORKER_EXIT = 'workerExit';

  self._errorAnnotations = {
    'EADDRINUSE': 'Failed to bind to a port because it was already used by another process.'
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
    authPrivateKey: null,
    authPublicKey: null,
    authDefaultExpiry: 86400,
    authAlgorithm: null,
    crashWorkerOnError: true,
    rebootWorkerOnCrash: true,
    killWorkerMemoryThreshold: null,
    protocol: 'http',
    protocolOptions: null,
    logLevel: 2,
    handshakeTimeout: 10000,
    ackTimeout: 10000,
    pingInterval: 8000,
    pingTimeout: 20000,
    origins: '*:*',
    socketChannelLimit: 1000,
    workerStatusInterval: 10000,
    processTermTimeout: 10000,
    propagateErrors: true,
    propagateWarnings: true,
    middlewareEmitWarnings: true,
    host: null,
    tcpSynBacklog: null,
    workerController: null,
    brokerController: null,
    initController: null,
    rebootOnSignal: true,
    downgradeToUser: false,
    path: '/socketcluster/',
    socketRoot: null,
    schedulingPolicy: null,
    allowClientPublish: true,
    defaultWorkerDebugPort: 5858,
    defaultBrokerDebugPort: 6858,
    httpServerModule: null,
    wsEngine: 'uws',
    brokerEngine: 'sc-broker-cluster'
  };

  self._active = false;
  self._workerCluster = null;

  self._colorCodes = {
    red: 31,
    green: 32,
    yellow: 33
  };

  for (var i in options) {
    if (options.hasOwnProperty(i)) {
      self.options[i] = options[i];
    }
  }

  // Make sure there is always a trailing slash in WS path
  self.options.path = self.options.path.replace(/\/?$/, '/');

  var maxTimeout = Math.pow(2, 31) - 1;

  var verifyDuration = function (propertyName) {
    if (self.options[propertyName] > maxTimeout) {
      throw new InvalidOptionsError('The ' + propertyName +
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
    throw new InvalidOptionsError("Compulsory option 'workerController' was not specified " +
      "- It needs to be a path to a JavaScript file which will act as the " +
      "boot controller for each worker in the cluster");
  }

  self._paths = {
    appDirPath: appDirPath,
    statusURL: '/~status',
    appWorkerControllerPath: path.resolve(self.options.workerController)
  };

  if (self.options.initController) {
      self._paths.appInitControllerPath = path.resolve(self.options.initController);
  } else {
      self._paths.appInitControllerPath = null;
  }

  if (/\.js$/.test(self.options.wsEngine)) {
    self._paths.wsEnginePath = path.resolve(self.options.wsEngine);
  } else {
    self._paths.wsEnginePath = self.options.wsEngine;
  }

  var pathHasher = crypto.createHash('md5');
  pathHasher.update(self._paths.appDirPath, 'utf8');
  var pathHash = pathHasher.digest('hex').substr(0, 10);
  // Trimp it because some OSes (e.g. OSX) do not like long path names for domain sockets.
  var shortAppName = self.options.appName.substr(0, 13);

  if (process.platform == 'win32') {
    if (self.options.socketRoot) {
      self._socketDirPath = self.options.socketRoot + '_';
    } else {
      self._socketDirPath = '\\\\.\\pipe\\socketcluster_' + shortAppName + '_' + pathHash + '_';
    }
  } else {
    var socketDir, socketParentDir;
    if (self.options.socketRoot) {
      socketDir = self.options.socketRoot.replace(/\/$/, '') + '/';
    } else {
      socketParentDir = os.tmpdir() + '/socketcluster/';
      socketDir = socketParentDir + shortAppName + '_' + pathHash + '/';
    }
    if (fs.existsSync(socketDir)) {
      try {
        fs.removeSync(socketDir);
      } catch (err) {
        throw new InvalidActionError('Failed to remove old socket directory ' + socketDir + ' - Try removing it manually');
      }
    }
    fs.mkdirsSync(socketDir);
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
    if (protoOpts.ca) {
      if (protoOpts.ca instanceof Array) {
        protoOpts.ca = protoOpts.ca.map(function (item) {
          if (item instanceof Buffer) {
            return item.toString();
          } else {
            return item;
          }
        });
      } else if (protoOpts.ca instanceof Buffer) {
        protoOpts.ca = protoOpts.ca.toString();
      }
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
          throw new InvalidOptionsError(message);
        }
      } else if (protoOpts.pfx) {
        var message = 'The supplied pfx certificate cannot be used without a passphrase - ' +
          'Please provide a valid passphrase as a property to protocolOptions';
        throw new InvalidOptionsError(message);
      } else {
        var message = 'The supplied protocolOptions were invalid - ' +
          'Please provide either a key and cert pair or a pfx certificate';
        throw new InvalidOptionsError(message);
      }
    }
  }

  if (self.options.authPrivateKey instanceof Buffer) {
    self.options.authPrivateKey = self.options.authPrivateKey.toString();
  }
  if (self.options.authPublicKey instanceof Buffer) {
    self.options.authPublicKey = self.options.authPublicKey.toString();
  }

  if (!self.options.brokers || self.options.brokers < 1) {
    self.options.brokers = 1;
  }
  if (typeof self.options.brokers != 'number') {
    throw new InvalidOptionsError('The brokers option must be a number');
  }

  if (!self.options.workers || self.options.workers < 1) {
    self.options.workers = 1;
  }
  if (typeof self.options.workers != 'number') {
    throw new InvalidOptionsError('The workers option must be a number');
  }

  self._extRegex = /[.][^\/\\]*$/;
  self._slashSequenceRegex = /\/+/g;
  self._startSlashRegex = /^\//;

  self._dataExpiryAccuracy = 5000;

  self._brokerEngine = require(self.options.brokerEngine);

  if (self.options.logLevel > 0) {
    console.log('   ' + self.colorText('[Busy]', 'yellow') + ' Launching SocketCluster');
  }

  process.stdin.on('error', function (err) {
    self.warningHandler(err, {type: 'master'});
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
          throw new InvalidActionError('Failed to downgrade to user "' + self.options.downgradeToUser + '" - ' + err);
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
      '   [' + objType + '] ' + output;
  } else {
    logMessage = 'Origin: ' + this._capitaliseFirstLetter(obj.origin.type) + ' (PID ' + obj.origin.pid + ')\n' +
      '   [' + objType + '] ' + output;
  }
  this.log(logMessage, time);
};

SocketCluster.prototype.errorHandler = function (err, origin) {
  if (!(err instanceof Object)) {
    // If a string (or null...)
    err = new UnknownError(err);
  } else if (err.stack == null) {
    err.stack = err.message;
  }
  var annotation = this._errorAnnotations[err.code];
  if (annotation) {
    err.stack += '\n    ' + this.colorText('!!', 'red') + ' ' + annotation;
  }

  err.origin = origin;
  err.time = Date.now();
  this.emit(this.EVENT_FAIL, err);

  this._logObject(err, 'Error');
};

SocketCluster.prototype.warningHandler = function (warning, origin) {
  if (!(warning instanceof Object)) {
    // If a string (or null...)
    warning = new UnknownError(warning);
  } else if (warning.stack == null) {
    warning.stack = warning.message;
  }
  warning.origin = origin;
  warning.time = Date.now();

  this.emit(this.EVENT_WARNING, warning);

  if (this.options.logLevel > 1) {
    this._logObject(warning, 'Warning');
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
    this.emit(this.EVENT_WARNING, infoData);

    if (this.options.logLevel > 0) {
      this._logObject(infoData, 'Info', infoData.time)
    }
  }
};

SocketCluster.prototype._workerClusterErrorHandler = function (pid, error) {
  this.errorHandler(error, {
    type: 'WorkerCluster',
    pid: pid
  });
};

SocketCluster.prototype._workerErrorHandler = function (workerPid, error) {
  this.errorHandler(error, {
    type: 'Worker',
    pid: workerPid
  });
};

SocketCluster.prototype._brokerEngineErrorHandler = function (pid, error) {
  if (typeof error == 'string') {
    error = new BrokerError(error);
  }
  this.errorHandler(error, {
    type: 'BrokerEngine',
    pid: pid
  });
};

SocketCluster.prototype._brokerErrorHandler = function (brokerPid, error) {
  if (typeof error == 'string') {
    error = new BrokerError(error);
  }
  this.errorHandler(error, {
    type: 'Broker',
    pid: brokerPid
  });
};

SocketCluster.prototype._workerWarningHandler = function (workerPid, warning) {
  var origin = {
    type: 'Worker',
    pid: workerPid
  };
  this.warningHandler(warning, origin);
};

SocketCluster.prototype._workerClusterReadyHandler = function () {
  var self = this;

  if (!this._active) {
    if (this.options.rebootOnSignal) {
      process.on('SIGUSR2', function () {
        var warning = 'Master received SIGUSR2 signal - Shutting down all workers in accordance with processTermTimeout';
        self.warningHandler(warning, {type: 'master'});
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
  var message = 'workerCluster exited with code: ' + errorCode;
  if (errorCode == 0) {
    this.log(message);
  } else {
    var error = new ProcessExitError(message, errorCode);
    this.errorHandler(error, {
      type: 'workerCluster'
    });
  }
  this._launchWorkerCluster();
};

SocketCluster.prototype._launchWorkerCluster = function () {
  var self = this;

  var debugPort, inspectPort;

  // Workers should not inherit the master --debug argument
  // because they have their own --debug-workers option.
  var execOptions = {
    execArgv: process.execArgv.filter(function (arg) {
      return arg != '--debug' && arg != '--debug-brk' && arg != '--inspect';
    })
  };

  if (argv['debug-workers']) {
    if (argv['debug-workers'] == true) {
      debugPort = this.options.defaultWorkerDebugPort;
    } else {
      debugPort = argv['debug-workers'];
    }
    execOptions.execArgv.push('--debug=' + debugPort);
  }

  if (argv['inspect-workers']) {
    if (argv['inspect-workers'] == true) {
      inspectPort = this.options.defaultWorkerDebugPort;
    } else {
      inspectPort = argv['inspect-workers'];
    }
    execOptions.execArgv.push('--debug-port=' + inspectPort);
    execOptions.execArgv.push('--inspect=' + inspectPort);
  }

  this._workerCluster = fork(__dirname + '/lib/workercluster.js', process.argv.slice(2), execOptions);

  var workerOpts = this._cloneObject(this.options);
  workerOpts.paths = this._paths;
  workerOpts.sourcePort = this.options.port;
  workerOpts.workerCount = this.options.workers;
  workerOpts.brokers = this._getBrokerSocketPaths();
  workerOpts.secretKey = this.options.secretKey;
  workerOpts.authKey = this.options.authKey;
  workerOpts.authPrivateKey = this.options.authPrivateKey;
  workerOpts.authPublicKey = this.options.authPublicKey;
  workerOpts.authDefaultExpiry = this.options.authDefaultExpiry;
  workerOpts.authAlgorithm = this.options.authAlgorithm;
  if (typeof workerOpts.schedulingPolicy == 'string') {
    if (workerOpts.schedulingPolicy == 'rr') {
      workerOpts.schedulingPolicy = cluster.SCHED_RR;
    } else if (workerOpts.schedulingPolicy == 'none') {
      workerOpts.schedulingPolicy = cluster.SCHED_NONE;
    }
  }

  this._workerCluster.send({
    type: 'init',
    data: workerOpts
  });

  this._workerCluster.on('message', function workerHandler(m) {
    if (m.type == 'error') {
      var error = scErrors.hydrateError(m.data.error);
      if (m.data.workerPid) {
        self._workerErrorHandler(m.data.workerPid, error);
      } else {
        self._workerClusterErrorHandler(m.data.pid, error);
      }
    } else if (m.type == 'warning') {
      var warning = scErrors.hydrateError(m.data.error);
      self._workerWarningHandler(m.data.workerPid, warning);
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
    console.log('            WebSocket engine: ' + this.options.wsEngine);
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
  if (this.options.authKey == null && this.options.authPrivateKey == null && this.options.authPublicKey == null) {
    this.options.authKey = crypto.randomBytes(32).toString('hex');
  }
  if (self.options.instanceId == null) {
    self.options.instanceId = uuid.v4();
  }

  self._active = false;

  var brokerEngineReady = function () {
    self._brokerEngine.removeListener('ready', brokerEngineReady);
    self._launchWorkerCluster();
  };

  var launchBrokerEngine = function () {
    var brokerDebugPort = argv['debug-brokers'];
    if (brokerDebugPort == true) {
      brokerDebugPort = self.options.defaultBrokerDebugPort;
    }

    var brokerInspectPort = argv['inspect-brokers'];
    if (brokerInspectPort == true) {
      brokerInspectPort = self.options.defaultBrokerDebugPort;
    }

    self._brokerEngine = new self._brokerEngine.Server({
      brokers: self._getBrokerSocketPaths(),
      debug: brokerDebugPort,
      inspect: brokerInspectPort,
      instanceId: self.options.instanceId,
      secretKey: self.options.secretKey,
      expiryAccuracy: self._dataExpiryAccuracy,
      downgradeToUser: self.options.downgradeToUser,
      processTermTimeout: self.options.processTermTimeout,
      brokerOptions: self.options,
      appBrokerControllerPath: self._paths.appBrokerControllerPath,
      appInitControllerPath: self._paths.appInitControllerPath
    });

    self._brokerEngine.on('error', function (err) {
      if (err.brokerPid) {
        self._brokerErrorHandler(err.brokerPid, err);
      } else {
        self._brokerEngineErrorHandler(err.pid, err);
      }
    });

    self._brokerEngine.on('ready', brokerEngineReady);

    self._brokerEngine.on('brokerMessage', function (brokerId, data) {
      self.emit('brokerMessage', brokerId, data);
    });
  };

  launchBrokerEngine();
};

SocketCluster.prototype.sendToWorker = function (workerId, data) {
  this._workerCluster.send({
    type: 'masterMessage',
    workerId: workerId,
    data: data
  });
};

SocketCluster.prototype.sendToBroker = function (brokerId, data) {
  this._brokerEngine.sendToBroker(brokerId, data);
};

// The options object is optional and can have two boolean fields:
// immediate: Shut down the workers immediately without waiting for termination timeout.
// killClusterMaster: Shut down the cluster master (load balancer) as well as all the workers.
SocketCluster.prototype.killWorkers = function (options) {
  if (this._workerCluster) {
    this._workerCluster.send({
      type: 'terminate',
      data: options || {}
    });
  }
};

SocketCluster.prototype.killBrokers = function () {
  if (this._brokerEngine) {
    this._brokerEngine.destroy();
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
    if (object.hasOwnProperty(i)) {
      clone[i] = object[i];
    }
  }
  return clone;
};

SocketCluster.prototype.colorText = function (message, color) {
  if (this._colorCodes[color]) {
    return '\x1b[0;' + this._colorCodes[color] + 'm' + message + '\x1b[0m';
  } else if (color) {
    return '\x1b[' + color + 'm' + message + '\x1b[0m';
  }
  return message;
};

module.exports.SocketCluster = SocketCluster;
