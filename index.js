var path = require('path');
var crypto = require('crypto');
var EventEmitter = require('events').EventEmitter;
var uuid = require('uuid');
var fork = require('child_process').fork;
var os = require('os');
var fs = require('fs-extra');
var uidNumber = require('uid-number');
var pkg = require('./package.json');
var argv = require('minimist')(process.argv.slice(2));
var cluster = require('cluster');

var scErrors = require('sc-errors');
var InvalidOptionsError = scErrors.InvalidOptionsError;
var InvalidActionError = scErrors.InvalidActionError;
var ProcessExitError = scErrors.ProcessExitError;
var UnknownError = scErrors.UnknownError;
var TimeoutError = scErrors.TimeoutError;
var decycle = scErrors.decycle;

var socketClusterSingleton = null;

function SocketCluster(options) {
  var self = this;
  if (socketClusterSingleton) {
    var errorMessage = 'The SocketCluster master object is a singleton; ' +
      'it can only be instantiated once per process';
    throw new InvalidActionError(errorMessage);
  }
  socketClusterSingleton = self;

  self.EVENT_FAIL = 'fail';
  self.EVENT_WARNING = 'warning';
  self.EVENT_INFO = 'info';
  self.EVENT_READY = 'ready';
  self.EVENT_WORKER_START = 'workerStart';
  self.EVENT_WORKER_EXIT = 'workerExit';
  self.EVENT_BROKER_START = 'brokerStart';
  self.EVENT_BROKER_EXIT = 'brokerExit';
  self.EVENT_WORKER_CLUSTER_START = 'workerClusterStart';
  self.EVENT_WORKER_CLUSTER_READY = 'workerClusterReady';
  self.EVENT_WORKER_CLUSTER_EXIT = 'workerClusterExit';

  self._pendingResponseHandlers = {};
  self._destroyCallbacks = [];
  self.workerClusterMessageBuffer = [];

  self._shuttingDown = false;

  self._errorAnnotations = {
    'EADDRINUSE': 'Failed to bind to a port because it was already used by another process.'
  };

  self.on('error', function (error) {
    self.emitFail(error, {
      type: 'Master',
      pid: process.pid
    });
  });

  // Capture any errors that are thrown during initialization.
  new Promise(function () {
    self._init(options);
  }).catch(function (error) {
    self.emit('error', error);
  });
}

SocketCluster.create = function (options) {
  return new SocketCluster(options);
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
    authSignAsync: false,
    authVerifyAsync: true,
    crashWorkerOnError: true,
    rebootWorkerOnCrash: true,
    killWorkerMemoryThreshold: null,
    protocol: 'http',
    protocolOptions: null,
    logLevel: 2,
    handshakeTimeout: 10000,
    ackTimeout: 10000,
    ipcAckTimeout: 10000,
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
    brokerConnectRetryErrorThreshold: null,
    workerClusterController: null,
    rebootOnSignal: true,
    downgradeToUser: false,
    path: '/socketcluster/',
    socketRoot: null,
    schedulingPolicy: null,
    allowClientPublish: true,
    defaultWorkerDebugPort: 5858,
    defaultBrokerDebugPort: 6858,
    pubSubBatchDuration: null,
    environment: 'dev',
    killMasterOnSignal: false,
    wsEngine: 'uws',
    brokerEngine: 'sc-broker-cluster'
  };

  self._active = false;
  self.workerCluster = null;
  self.isWorkerClusterReady = false;

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
  verifyDuration('ipcAckTimeout');
  verifyDuration('pingInterval');
  verifyDuration('pingTimeout');
  verifyDuration('workerStatusInterval');
  verifyDuration('processTermTimeout');

  if (self.options.appName == null) {
    self.options.appName = uuid.v4();
  }

  if (self.options.run != null) {
    self.run = self.options.run;
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

  if (self.options.workerClusterController) {
    self._paths.appWorkerClusterControllerPath = path.resolve(self.options.workerClusterController);
  } else {
    self._paths.appWorkerClusterControllerPath = __dirname + '/default-workercluster-controller.js';
  }

  if (/\.js$/.test(self.options.wsEngine)) {
    self._paths.wsEnginePath = path.resolve(self.options.wsEngine);
  } else {
    self._paths.wsEnginePath = self.options.wsEngine;
  }

  var pathHasher = crypto.createHash('md5');
  pathHasher.update(self._paths.appDirPath, 'utf8');
  var pathHash = pathHasher.digest('hex').substr(0, 10);
  // Trim it because some OSes (e.g. OSX) do not like long path names for domain sockets.
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
    if (self._fileExistsSync(socketDir)) {
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

  self._stdinErrorHandler = function (err) {
    self.emitWarning(err, {
      type: 'Master',
      pid: process.pid
    });
  };

  process.stdin.on('error', self._stdinErrorHandler);

  /*
    To allow inserting blank lines in console on Windows to aid with debugging.
  */
  if (process.platform == 'win32') {
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
  }

  if (self.options.secretKey == null) {
    self.options.secretKey = crypto.randomBytes(32).toString('hex');
  }
  if (self.options.authKey == null && self.options.authPrivateKey == null && self.options.authPublicKey == null) {
    self.options.authKey = crypto.randomBytes(32).toString('hex');
  }
  if (self.options.instanceId == null) {
    self.options.instanceId = uuid.v4();
  }

  if (self.options.downgradeToUser && process.platform != 'win32') {
    if (typeof self.options.downgradeToUser == 'number') {
      fs.chownSync(self._socketDirPath, self.options.downgradeToUser, 0);
      self._start();
    } else {
      uidNumber(self.options.downgradeToUser, function (err, uid, gid) {
        if (self._shuttingDown) {
          return;
        }
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

SocketCluster.prototype._fileExistsSync = function (filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
  } catch (err) {
    return false;
  }
  return true;
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

SocketCluster.prototype._convertValueToUnknownError = function (err, origin) {
  if (!(err instanceof Error)) {
    if (err && typeof err == 'object') {
      if (err.message || err.stack) {
        err = scErrors.hydrateError(err, true);
      } else {
        // If err has neither a stack nor a message property
        // then the error message will be the JSON stringified object.
        var errorMessage;
        try {
          errorMessage = JSON.stringify(err);
        } catch (e1) {
          try {
            errorMessage = JSON.stringify(decycle(err));
          } catch (e2) {
            errorMessage = '[object NotJSON]';
          }
        }
        err = new UnknownError(errorMessage);
      }
    } else if (typeof err == 'function') {
      var errorMessage = '[function ' + (err.name || 'anonymous') + ']';
      err = new UnknownError(errorMessage);
    } else if (typeof err == 'undefined') {
      err = new UnknownError('undefined');
    } else if (err === null) {
      err = new UnknownError('null');
    } else {
      // For number, string and boolean types.
      err = new UnknownError(err);
    }
  }

  err.origin = origin;
  err.time = Date.now();

  return err;
};

SocketCluster.prototype.emitFail = function (err, origin) {
  err = this._convertValueToUnknownError(err, origin);

  var annotation = this._errorAnnotations[err.code];
  if (annotation && err.stack) {
    err.stack += '\n    ' + this.colorText('!!', 'red') + ' ' + annotation;
  }

  this.emit(this.EVENT_FAIL, err);

  if (this.options.logLevel > 0 && !this._shuttingDown) {
    this._logObject(err, 'Error');
  }
};

SocketCluster.prototype.emitWarning = function (warning, origin) {
  warning = this._convertValueToUnknownError(warning, origin);

  this.emit(this.EVENT_WARNING, warning);

  if (this.options.logLevel > 1 && !this._shuttingDown) {
    this._logObject(warning, 'Warning');
  }
};

SocketCluster.prototype._workerClusterErrorHandler = function (pid, error) {
  this.emitFail(error, {
    type: 'WorkerCluster',
    pid: pid
  });
};

SocketCluster.prototype._workerErrorHandler = function (workerPid, error) {
  this.emitFail(error, {
    type: 'Worker',
    pid: workerPid
  });
};

SocketCluster.prototype._brokerEngineErrorHandler = function (pid, error) {
  this.emitFail(error, {
    type: 'BrokerEngine',
    pid: pid
  });
};

SocketCluster.prototype._brokerErrorHandler = function (brokerPid, error) {
  this.emitFail(error, {
    type: 'Broker',
    pid: brokerPid
  });
};

SocketCluster.prototype._workerWarningHandler = function (workerPid, warning) {
  var origin = {
    type: 'Worker',
    pid: workerPid
  };
  this.emitWarning(warning, origin);
};

SocketCluster.prototype._workerClusterReadyHandler = function () {
  var self = this;

  if (!this._active) {
    if (this.options.rebootOnSignal) {
      this._sigusr2SignalHandler = function () {
        var warningMessage;
        var killOptions = {};
        if (self.options.environment == 'dev') {
          warningMessage = 'Master received SIGUSR2 signal - Shutting down all workers immediately';
          killOptions.immediate = true;
        } else {
          warningMessage = 'Master received SIGUSR2 signal - Shutting down all workers in accordance with processTermTimeout';
        }

        var warning = new ProcessExitError(warningMessage);

        self.emitWarning(warning, {
          type: 'Master',
          pid: process.pid
        });
        self.killWorkers(killOptions);
        if (self.options.killMasterOnSignal) {
          process.exit();
        }
      };

      process.on('SIGUSR2', this._sigusr2SignalHandler);
    }

    this._active = true;
    this._logDeploymentDetails();

    this.emit(this.EVENT_READY);
    this.run();
  }

  this.isWorkerClusterReady = true;
  this._flushWorkerClusterMessageBuffer();

  var workerClusterInfo = {
    pid: this.workerCluster.pid,
    childProcess: this.workerCluster
  };
  this.emit(this.EVENT_WORKER_CLUSTER_READY, workerClusterInfo);
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

SocketCluster.prototype._workerStartHandler = function (workerInfo, signal) {
  if (this._active && this.options.logLevel > 0 && workerInfo.respawn) {
    this.log('Worker ' + workerInfo.id + ' was respawned');
  }
  this.emit(this.EVENT_WORKER_START, workerInfo);
};

SocketCluster.prototype._handleWorkerClusterExit = function (errorCode, signal) {
  this.isWorkerClusterReady = false;
  this.workerClusterMessageBuffer = [];

  var wcPid = this.workerCluster.pid;

  var workerClusterInfo = {
    pid: wcPid,
    code: errorCode,
    signal: signal,
    childProcess: this.workerCluster
  };
  this.emit(this.EVENT_WORKER_CLUSTER_EXIT, workerClusterInfo);

  var message = 'WorkerCluster exited with code: ' + errorCode;
  if (errorCode == 0) {
    this.log(message);
  } else {
    var error = new ProcessExitError(message, errorCode);
    this.emitFail(error, {
      type: 'WorkerCluster',
      pid: wcPid
    });
  }

  if (this._shuttingDown) {
    return;
  }

  this._launchWorkerCluster();
};

SocketCluster.prototype._launchWorkerCluster = function () {
  var self = this;

  var debugPort, inspectPort;

  var debugRegex = /^--debug(=[0-9]*)?$/;
  var debugBrkRegex = /^--debug-brk(=[0-9]*)?$/;
  var inspectRegex = /^--inspect(=[0-9]*)?$/;
  var inspectBrkRegex = /^--inspect-brk(=[0-9]*)?$/;

  // Workers should not inherit the master --debug argument
  // because they have their own --debug-workers option.
  var execOptions = {
    execArgv: process.execArgv.filter(function (arg) {
      return !debugRegex.test(arg) && !debugBrkRegex.test(arg) && !inspectRegex.test(arg) && !inspectBrkRegex.test(arg);
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
  workerOpts.authSignAsync = this.options.authSignAsync;
  workerOpts.authVerifyAsync = this.options.authVerifyAsync;

  if (typeof workerOpts.schedulingPolicy == 'string') {
    if (workerOpts.schedulingPolicy == 'rr') {
      workerOpts.schedulingPolicy = cluster.SCHED_RR;
    } else if (workerOpts.schedulingPolicy == 'none') {
      workerOpts.schedulingPolicy = cluster.SCHED_NONE;
    }
  }

  execOptions.env = {};
  Object.keys(process.env).forEach(function (key) {
    execOptions.env[key] = process.env[key];
  });
  execOptions.env.workerInitOptions = JSON.stringify(workerOpts);

  this.workerCluster = fork(this._paths.appWorkerClusterControllerPath, process.argv.slice(2), execOptions);
  this.isWorkerClusterReady = false;

  this.workerCluster.on('error', function (err) {
    self._workerClusterErrorHandler(self.workerCluster.pid, err);
  });

  this.workerCluster.on('message', function workerHandler(m) {
    if (m.type == 'error') {
      if (m.data.workerPid) {
        self._workerErrorHandler(m.data.workerPid, m.data.error);
      } else {
        self._workerClusterErrorHandler(m.data.pid, m.data.error);
      }
    } else if (m.type == 'warning') {
      var warning = scErrors.hydrateError(m.data.error, true);
      self._workerWarningHandler(m.data.workerPid, warning);
    } else if (m.type == 'ready') {
      self._workerClusterReadyHandler();
    } else if (m.type == 'workerStart') {
      self._workerStartHandler(m.data);
    } else if (m.type == 'workerExit') {
      self._workerExitHandler(m.data);
    } else if (m.type == 'workerMessage') {
      self.emit('workerMessage', m.workerId, m.data, function (err, data) {
        if (m.cid) {
          self.respondToWorker(err, data, m.workerId, m.cid);
        }
      });
    } else if (m.type == 'workerResponse' || m.type == 'workerClusterResponse') {
      var responseHandler = self._pendingResponseHandlers[m.rid];
      if (responseHandler) {
        clearTimeout(responseHandler.timeout);
        delete self._pendingResponseHandlers[m.rid];
        var properError = scErrors.hydrateError(m.error, true);
        responseHandler.callback(properError, m.data, m.workerId);
      }
    }
  });

  var workerClusterInfo = {
    pid: this.workerCluster.pid,
    childProcess: this.workerCluster
  };
  this.emit(this.EVENT_WORKER_CLUSTER_START, workerClusterInfo);

  this.workerCluster.on('exit', this._handleWorkerClusterExit.bind(this));
  this.workerCluster.on('disconnect', function () {
    self.isWorkerClusterReady = false;
    self.workerClusterMessageBuffer = [];
  });
};

SocketCluster.prototype.respondToWorker = function (err, data, workerId, rid) {
  this.workerCluster.send({
    type: 'masterResponse',
    workerId: workerId,
    error: scErrors.dehydrateError(err, true),
    data: data,
    rid: rid
  });
};

SocketCluster.prototype._logDeploymentDetails = function () {
  if (this.options.logLevel > 0) {
    console.log('   ' + this.colorText('[Active]', 'green') + ' SocketCluster started');
    console.log('            Version: ' + pkg.version);
    console.log('            Environment: ' + this.options.environment);
    console.log('            WebSocket engine: ' + this.options.wsEngine);
    console.log('            Port: ' + this.options.port);
    console.log('            Master PID: ' + process.pid);
    console.log('            Worker count: ' + this.options.workers);
    console.log('            Broker count: ' + this.options.brokers);
    console.log();
  }
};

// Can be overriden.
SocketCluster.prototype.run = function () {};

SocketCluster.prototype._start = function () {
  var self = this;

  var brokerEngineServerReady = function () {
    self._brokerEngineServer.removeListener('ready', brokerEngineServerReady);
    self._launchWorkerCluster();
  };

  var brokerDebugPort = argv['debug-brokers'];
  if (brokerDebugPort == true) {
    brokerDebugPort = self.options.defaultBrokerDebugPort;
  }

  var brokerInspectPort = argv['inspect-brokers'];
  if (brokerInspectPort == true) {
    brokerInspectPort = self.options.defaultBrokerDebugPort;
  }

  self._brokerEngineServer = new self._brokerEngine.Server({
    brokers: self._getBrokerSocketPaths(),
    debug: brokerDebugPort,
    inspect: brokerInspectPort,
    instanceId: self.options.instanceId,
    secretKey: self.options.secretKey,
    expiryAccuracy: self._dataExpiryAccuracy,
    downgradeToUser: self.options.downgradeToUser,
    processTermTimeout: self.options.processTermTimeout,
    ipcAckTimeout: self.options.ipcAckTimeout,
    brokerOptions: self.options,
    appBrokerControllerPath: self._paths.appBrokerControllerPath
  });

  self._brokerEngineServer.on('error', function (err) {
    if (err.brokerPid) {
      self._brokerErrorHandler(err.brokerPid, err);
    } else {
      self._brokerEngineErrorHandler(err.pid, err);
    }
  });

  self._brokerEngineServer.on('ready', brokerEngineServerReady);

  self._brokerEngineServer.on('brokerStart', function (brokerInfo) {
    self.emit(self.EVENT_BROKER_START, brokerInfo);
  });

  self._brokerEngineServer.on('brokerExit', function (brokerInfo) {
    self.emit(self.EVENT_BROKER_EXIT, brokerInfo);
  });

  self._brokerEngineServer.on('brokerMessage', function (brokerId, data, callback) {
    self.emit('brokerMessage', brokerId, data, callback);
  });
};

SocketCluster.prototype._createIPCResponseHandler = function (callback) {
  var self = this;
  var cid = uuid.v4();

  var responseTimeout = setTimeout(function () {
    var responseHandler = self._pendingResponseHandlers[cid];
    if (responseHandler) {
      delete self._pendingResponseHandlers[cid];
      var timeoutError = new TimeoutError('IPC response timed out');
      responseHandler.callback(timeoutError);
    }
  }, this.options.ipcAckTimeout);

  this._pendingResponseHandlers[cid] = {
    callback: callback,
    timeout: responseTimeout
  };

  return cid;
};

SocketCluster.prototype._flushWorkerClusterMessageBuffer = function () {
  var self = this;

  this.workerClusterMessageBuffer.forEach(function (messagePacket) {
    self.workerCluster.send(messagePacket);
  });
  this.workerClusterMessageBuffer = [];
};

SocketCluster.prototype.sendToWorker = function (workerId, data, callback) {
  var self = this;

  var messagePacket = {
    type: 'masterMessage',
    workerId: workerId,
    data: data
  };

  if (callback) {
    messagePacket.cid = this._createIPCResponseHandler(callback);
  }
  this.workerClusterMessageBuffer.push(messagePacket);

  if (this.isWorkerClusterReady) {
    this._flushWorkerClusterMessageBuffer();
  }
};

SocketCluster.prototype.sendToBroker = function (brokerId, data, callback) {
  if (!this._brokerEngineServer) {
    throw new InvalidActionError('Cannot send a message to a broker until the master instance is ready');
  }
  this._brokerEngineServer.sendToBroker(brokerId, data, callback);
};

// The options object is optional and can have two boolean fields:
// immediate: Shut down the workers immediately without waiting for termination timeout.
// killClusterMaster: Shut down the cluster master (load balancer) as well as all the workers.
SocketCluster.prototype.killWorkers = function (options) {
  if (this.workerCluster) {
    this.workerCluster.send({
      type: 'terminate',
      data: options || {}
    });
  }
};

SocketCluster.prototype.killBrokers = function () {
  if (this._brokerEngineServer) {
    this._brokerEngineServer.killBrokers();
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

SocketCluster.prototype.destroy = function (callback) {
  var self = this;

  if (callback) {
    this._destroyCallbacks.push(callback);
  }

  if (this._shuttingDown) {
    return;
  }
  this._shuttingDown = true;

  Promise.all([
    new Promise(function (resolve, reject) {
      if (!this.workerCluster) {
        resolve();
        return;
      }
      self.once(self.EVENT_WORKER_CLUSTER_EXIT, function () {
        resolve();
      });
    }),
    new Promise(function (resolve, reject) {
      if (!this._brokerEngineServer) {
        resolve();
        return;
      }
      var killedBrokerLookup = {};
      var killedBrokerCount = 0;
      var handleBrokerExit = function (brokerDetails) {
        if (!killedBrokerLookup[brokerDetails.id]) {
          killedBrokerLookup[brokerDetails.id] = true;
          killedBrokerCount++;
        }
        if (killedBrokerCount >= self.options.brokers) {
          self.removeListener(self.EVENT_BROKER_EXIT, handleBrokerExit);
          resolve();
        }
      };
      self.on(self.EVENT_BROKER_EXIT, handleBrokerExit);
    })
  ])
  .then(function () {
    socketClusterSingleton = null;
    self.removeAllListeners();
    if (self._stdinErrorHandler) {
      process.stdin.removeListener('error', self._stdinErrorHandler);
    }
    if (self._sigusr2SignalHandler) {
      process.removeListener('SIGUSR2', self._sigusr2SignalHandler);
    }

    self._destroyCallbacks.forEach(function (callback) {
      callback();
    });
    self._destroyCallbacks = [];
  })
  .catch(function (error) {
    self.emit('error', error);
  });

  if (this.workerCluster) {
    this.killWorkers({killClusterMaster: true});
  }
  if (this._brokerEngineServer) {
    this._brokerEngineServer.destroy();
  }
};

module.exports = SocketCluster;
