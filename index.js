const path = require('path');
const crypto = require('crypto');
const AsyncStreamEmitter = require('async-stream-emitter');
const uuid = require('uuid');
const fork = require('child_process').fork;
const os = require('os');
const fs = require('fs-extra');
const uidNumber = require('uid-number');
const pkg = require('./package.json');
const argv = require('minimist')(process.argv.slice(2));
const cluster = require('cluster');

const scErrors = require('sc-errors');
const InvalidOptionsError = scErrors.InvalidOptionsError;
const InvalidActionError = scErrors.InvalidActionError;
const ProcessExitError = scErrors.ProcessExitError;
const UnknownError = scErrors.UnknownError;
const TimeoutError = scErrors.TimeoutError;
const decycle = scErrors.decycle;

let socketClusterSingleton = null;

function SocketCluster(options) {
  AsyncStreamEmitter.call(this);

  if (socketClusterSingleton) {
    let errorMessage = 'The SocketCluster master object is a singleton; ' +
      'it can only be instantiated once per process';
    throw new InvalidActionError(errorMessage);
  }
  socketClusterSingleton = this;

  this._pendingResponseHandlers = {};
  this.workerClusterMessageBuffer = [];

  this.isShuttingDown = false;

  this._errorAnnotations = {
    'EADDRINUSE': 'Failed to bind to a port because it was already used by another process.'
  };

  // Capture any errors that are thrown during initialization.
  (async () => {
    try {
      await this._init(options);
    } catch (error) {
      this.emitError(error, {
        type: 'Master',
        pid: process.pid
      });
    }
  })();
}

SocketCluster.prototype = Object.create(AsyncStreamEmitter.prototype);

SocketCluster.EVENT_ERROR = SocketCluster.prototype.EVENT_ERROR = 'error';
SocketCluster.EVENT_WARNING = SocketCluster.prototype.EVENT_WARNING = 'warning';
SocketCluster.EVENT_INFO = SocketCluster.prototype.EVENT_INFO = 'info';
SocketCluster.EVENT_READY = SocketCluster.prototype.EVENT_READY = 'ready';
SocketCluster.EVENT_WORKER_START = SocketCluster.prototype.EVENT_WORKER_START = 'workerStart';
SocketCluster.EVENT_WORKER_EXIT = SocketCluster.prototype.EVENT_WORKER_EXIT = 'workerExit';
SocketCluster.EVENT_WORKER_MESSAGE = SocketCluster.prototype.EVENT_WORKER_MESSAGE = 'workerMessage';
SocketCluster.EVENT_WORKER_REQUEST = SocketCluster.prototype.EVENT_WORKER_REQUEST = 'workerRequest';
SocketCluster.EVENT_BROKER_START = SocketCluster.prototype.EVENT_BROKER_START = 'brokerStart';
SocketCluster.EVENT_BROKER_EXIT = SocketCluster.prototype.EVENT_BROKER_EXIT = 'brokerExit';
SocketCluster.EVENT_BROKER_MESSAGE = SocketCluster.prototype.EVENT_BROKER_MESSAGE = 'brokerMessage';
SocketCluster.EVENT_BROKER_REQUEST = SocketCluster.prototype.EVENT_BROKER_REQUEST = 'brokerRequest';
SocketCluster.EVENT_WORKER_CLUSTER_START = SocketCluster.prototype.EVENT_WORKER_CLUSTER_START = 'workerClusterStart';
SocketCluster.EVENT_WORKER_CLUSTER_READY = SocketCluster.prototype.EVENT_WORKER_CLUSTER_READY = 'workerClusterReady';
SocketCluster.EVENT_WORKER_CLUSTER_EXIT = SocketCluster.prototype.EVENT_WORKER_CLUSTER_EXIT = 'workerClusterExit';

SocketCluster.create = function (options) {
  return new SocketCluster(options);
};

SocketCluster.prototype._init = async function (options) {
  this.options = {
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
    authVerifyAlgorithms: null,
    authSignAsync: false,
    authVerifyAsync: true,
    crashWorkerOnError: true,
    respawnWorkerOnCrash: true,
    killWorkerMemoryThreshold: null,
    protocol: 'http',
    protocolOptions: null,
    logLevel: 2,
    handshakeTimeout: 10000,
    ackTimeout: 10000,
    ipcAckTimeout: 10000,
    pingInterval: 8000,
    pingTimeout: 20000,
    pingTimeoutDisabled: false,
    origins: '*:*',
    socketChannelLimit: 1000,
    workerStatusInterval: 10000,
    processTermTimeout: 10000,
    forceKillTimeout: 15000,
    forceKillSignal: 'SIGHUP',
    propagateErrors: true,
    propagateWarnings: true,
    middlewareEmitWarnings: true,
    host: null,
    tcpSynBacklog: null,
    workerController: null,
    brokerController: null,
    brokerConnectRetryErrorThreshold: null,
    brokerAckTimeout: null,
    brokerAutoReconnectOptions: null,
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
    wsEngine: 'ws',
    brokerEngine: 'sc-broker-cluster'
  };

  this.isActive = false;
  this.workerCluster = null;
  this.isWorkerClusterReady = false;

  this._colorCodes = {
    red: 31,
    green: 32,
    yellow: 33
  };

  Object.assign(this.options, options);

  let maxTimeout = Math.pow(2, 31) - 1;

  let verifyDuration = (propertyName) => {
    if (this.options[propertyName] > maxTimeout) {
      throw new InvalidOptionsError(
        `The ${propertyName} value provided exceeded the maximum amount allowed`
      );
    }
  };

  verifyDuration('ackTimeout');
  verifyDuration('ipcAckTimeout');
  verifyDuration('pingInterval');
  verifyDuration('pingTimeout');
  verifyDuration('workerStatusInterval');
  verifyDuration('processTermTimeout');
  verifyDuration('forceKillTimeout');

  this.appDirPath = path.dirname(require.main.filename).replace(/\\/g, '/');

  if (this.options.appName == null) {
    this.options.appName = uuid.v4();
  }

  if (this.options.run != null) {
    this.run = this.options.run;
  }

  if (this.options.workerController == null) {
    throw new InvalidOptionsError(
      'Compulsory option "workerController" was not specified ' +
      '- It needs to be a path to a JavaScript file which will act as the ' +
      'boot controller for each worker in the cluster'
    );
  }

  let pathHasher = crypto.createHash('md5');
  pathHasher.update(this.appDirPath, 'utf8');
  let pathHash = pathHasher.digest('hex').substr(0, 10);
  // Trim it because some OSes (e.g. OSX) do not like long path names for domain sockets.
  let shortAppName = this.options.appName.substr(0, 13);

  if (process.platform === 'win32') {
    if (this.options.socketRoot) {
      this._socketDirPath = `${this.options.socketRoot}_`;
    } else {
      this._socketDirPath = `\\\\.\\pipe\\socketcluster_${shortAppName}_${pathHash}_`;
    }
  } else {
    let socketDir, socketParentDir;
    if (this.options.socketRoot) {
      socketDir = this.options.socketRoot.replace(/\/$/, '') + '/';
    } else {
      socketParentDir = path.join(os.tmpdir(), '/socketcluster/');
      socketDir = path.join(socketParentDir, `${shortAppName}_${pathHash}/`);
    }
    if (this._fileExistsSync(socketDir)) {
      try {
        fs.removeSync(socketDir);
      } catch (err) {
        throw new InvalidActionError(
          `Failed to remove old socket directory ${socketDir} - Try removing it manually`
        );
      }
    }
    fs.mkdirsSync(socketDir);
    if (socketParentDir) {
      try {
        fs.chmodSync(socketParentDir, '1777');
      } catch (err) {}
    }
    this._socketDirPath = socketDir;
  }

  if (this.options.protocolOptions) {
    let protoOpts = this.options.protocolOptions;
    if (protoOpts.key instanceof Buffer) {
      protoOpts.key = protoOpts.key.toString();
    }
    if (protoOpts.cert instanceof Buffer) {
      protoOpts.cert = protoOpts.cert.toString();
    }
    if (protoOpts.ca) {
      if (protoOpts.ca instanceof Array) {
        protoOpts.ca = protoOpts.ca.map((item) => {
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
        let privKeyEncLine = protoOpts.key.split('\n')[1];
        if (privKeyEncLine && privKeyEncLine.toUpperCase().indexOf('ENCRYPTED') > -1) {
          let message = 'The supplied private key is encrypted and cannot be used without a passphrase - ' +
            'Please provide a valid passphrase as a property to protocolOptions';
          throw new InvalidOptionsError(message);
        }
      } else if (protoOpts.pfx) {
        let message = 'The supplied pfx certificate cannot be used without a passphrase - ' +
          'Please provide a valid passphrase as a property to protocolOptions';
        throw new InvalidOptionsError(message);
      } else {
        let message = 'The supplied protocolOptions were invalid - ' +
          'Please provide either a key and cert pair or a pfx certificate';
        throw new InvalidOptionsError(message);
      }
    }
  }

  if (this.options.authPrivateKey instanceof Buffer) {
    this.options.authPrivateKey = this.options.authPrivateKey.toString();
  }
  if (this.options.authPublicKey instanceof Buffer) {
    this.options.authPublicKey = this.options.authPublicKey.toString();
  }

  if (!this.options.brokers || this.options.brokers < 1) {
    this.options.brokers = 1;
  }
  if (typeof this.options.brokers !== 'number') {
    throw new InvalidOptionsError('The brokers option must be a number');
  }

  if (!this.options.workers || this.options.workers < 1) {
    this.options.workers = 1;
  }
  if (typeof this.options.workers !== 'number') {
    throw new InvalidOptionsError('The workers option must be a number');
  }

  this._extRegex = /[.][^\/\\]*$/;
  this._slashSequenceRegex = /\/+/g;
  this._startSlashRegex = /^\//;

  this._dataExpiryAccuracy = 5000;

  this._brokerEngine = require(this.options.brokerEngine);

  if (this.options.logLevel > 0) {
    console.log('   ' + this.colorText('[Busy]', 'yellow') + ' Launching SocketCluster');
  }

  this._stdinErrorHandler = (err) => {
    this.emitWarning(err, {
      type: 'Master',
      pid: process.pid
    });
  };

  process.stdin.on('error', this._stdinErrorHandler);

  /*
    To allow inserting blank lines in console on Windows to aid with debugging.
  */
  if (process.platform === 'win32') {
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
  }

  if (this.options.secretKey == null) {
    this.options.secretKey = crypto.randomBytes(32).toString('hex');
  }
  if (this.options.authKey == null && this.options.authPrivateKey == null && this.options.authPublicKey == null) {
    this.options.authKey = crypto.randomBytes(32).toString('hex');
  }
  if (this.options.instanceId == null) {
    this.options.instanceId = uuid.v4();
  }

  if (this.options.downgradeToUser && process.platform !== 'win32') {
    if (typeof this.options.downgradeToUser === 'number') {
      fs.chownSync(this._socketDirPath, this.options.downgradeToUser, 0);
      this._start();
    } else {
      let uidInfo;
      try {
        uidInfo = await new Promise((resolve, reject) => {
          uidNumber(this.options.downgradeToUser, (err, uid, gid) => {
            if (err) {
              reject(err);
              return;
            }
            resolve({uid, gid});
          });
        });
      } catch (err) {
        throw new InvalidActionError(
          `Failed to downgrade to user "${this.options.downgradeToUser}" - ${err}`
        );
      }
      if (this.isShuttingDown) {
        return;
      }
      fs.chownSync(this._socketDirPath, uidInfo.uid, uidInfo.gid);
      this._start();
    }
  } else {
    this._start();
  }
};

SocketCluster.prototype._getPaths = function () {
  let paths = {
    appDirPath: this.appDirPath,
    statusURL: '/~status',
    appWorkerControllerPath: path.resolve(this.options.workerController)
  };

  if (this.options.workerClusterController) {
    paths.appWorkerClusterControllerPath = path.resolve(this.options.workerClusterController);
  } else {
    paths.appWorkerClusterControllerPath = path.join(__dirname, 'default-workercluster-controller.js');
  }

  if (/\.js$/.test(this.options.wsEngine)) {
    paths.wsEnginePath = path.resolve(this.options.wsEngine);
  } else {
    paths.wsEnginePath = this.options.wsEngine;
  }

  if (this.options.brokerController) {
    paths.appBrokerControllerPath = path.resolve(this.options.brokerController);
  } else {
    paths.appBrokerControllerPath = null;
  }

  return paths;
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
  let socketPaths = [];
  for (let i = 0; i < this.options.brokers; i++) {
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
  let output = obj.stack || obj.message || obj;

  let logMessage;
  if (obj.origin.pid == null) {
    logMessage = `Origin: ${this._capitaliseFirstLetter(obj.origin.type)}\n` +
      `   [${objType}] ${output}`;
  } else {
    logMessage = `Origin: ${this._capitaliseFirstLetter(obj.origin.type)} (PID ${obj.origin.pid})\n` +
      `   [${objType}] ${output}`;
  }
  this.log(logMessage, time);
};

SocketCluster.prototype._convertValueToUnknownError = function (err, origin) {
  if (!(err instanceof Error)) {
    if (err && typeof err === 'object') {
      if (err.message || err.stack) {
        err = scErrors.hydrateError(err, true);
      } else {
        // If err has neither a stack nor a message property
        // then the error message will be the JSON stringified object.
        let errorMessage;
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
    } else if (typeof err === 'function') {
      let errorMessage = `[function ${err.name || 'anonymous'}]`;
      err = new UnknownError(errorMessage);
    } else if (typeof err === 'undefined') {
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

SocketCluster.prototype.emitError = function (error, origin) {
  error = this._convertValueToUnknownError(error, origin);

  let annotation = this._errorAnnotations[error.code];
  if (annotation && error.stack) {
    error.stack += `\n    ${this.colorText('!!', 'red')} ${annotation}`;
  }

  this.emit(this.EVENT_ERROR, {error});

  if (this.options.logLevel > 0 && !this.isShuttingDown) {
    this._logObject(error, 'Error');
  }
};

SocketCluster.prototype.emitWarning = function (warning, origin) {
  warning = this._convertValueToUnknownError(warning, origin);

  this.emit(this.EVENT_WARNING, {warning});

  if (this.options.logLevel > 1 && !this.isShuttingDown) {
    this._logObject(warning, 'Warning');
  }
};

SocketCluster.prototype.emitInfo = function (message, origin) {
  let info = {
    message,
    origin
  };
  this.emit(this.EVENT_INFO, info);

  if (this.options.logLevel > 2 && !this.isShuttingDown) {
    this._logObject(info, 'Info');
  }
};

SocketCluster.prototype._workerClusterErrorHandler = function (pid, error) {
  this.emitError(error, {
    type: 'WorkerCluster',
    pid: pid
  });
};

SocketCluster.prototype._workerErrorHandler = function (workerPid, error) {
  this.emitError(error, {
    type: 'Worker',
    pid: workerPid
  });
};

SocketCluster.prototype._brokerEngineErrorHandler = function (pid, error) {
  this.emitError(error, {
    type: 'BrokerEngine',
    pid: pid
  });
};

SocketCluster.prototype._brokerErrorHandler = function (brokerPid, error) {
  this.emitError(error, {
    type: 'Broker',
    pid: brokerPid
  });
};

SocketCluster.prototype._workerWarningHandler = function (workerPid, warning) {
  let origin = {
    type: 'Worker',
    pid: workerPid
  };
  this.emitWarning(warning, origin);
};

SocketCluster.prototype._workerClusterReadyHandler = function () {
  if (!this.isActive) {
    if (this.options.rebootOnSignal) {
      this._sigusr2SignalHandler = () => {
        let warningMessage;
        let killOptions = {};
        if (this.options.environment === 'dev') {
          warningMessage = 'Master received SIGUSR2 signal - Shutting down all workers immediately';
          killOptions.immediate = true;
        } else {
          warningMessage = 'Master received SIGUSR2 signal - Shutting down all workers gracefully within processTermTimeout limit';
        }

        let warning = new ProcessExitError(warningMessage, null);
        warning.signal = 'SIGUSR2';

        this.emitWarning(warning, {
          type: 'Master',
          pid: process.pid
        });
        this.killWorkers(killOptions);
        if (this.options.killMasterOnSignal) {
          process.exit();
        }
      };

      process.on('SIGUSR2', this._sigusr2SignalHandler);
    }

    this.isActive = true;
    this._logDeploymentDetails();

    this.emit(this.EVENT_READY, {});
    this.run();
  }

  this.isWorkerClusterReady = true;
  this._flushWorkerClusterMessageBuffer();

  let workerClusterInfo = {
    pid: this.workerCluster.pid,
    childProcess: this.workerCluster
  };
  this.emit(this.EVENT_WORKER_CLUSTER_READY, workerClusterInfo);
};

SocketCluster.prototype._workerExitHandler = function (workerInfo) {
  if (this.options.logLevel > 0) {
    let message = `Worker ${workerInfo.id} exited - Exit code: ${workerInfo.code}`;
    if (workerInfo.signal) {
      message += `, signal: ${workerInfo.signal}`;
    }
    this.log(message);
  }
  this.emit(this.EVENT_WORKER_EXIT, workerInfo);
};

SocketCluster.prototype._workerStartHandler = function (workerInfo, signal) {
  if (this.isActive && this.options.logLevel > 0 && workerInfo.respawn) {
    this.log(`Worker ${workerInfo.id} was respawned`);
  }
  this.emit(this.EVENT_WORKER_START, workerInfo);
};

SocketCluster.prototype._handleWorkerClusterExit = function (errorCode, signal) {
  this.isWorkerClusterReady = false;
  this.workerClusterMessageBuffer = [];

  let wcPid = this.workerCluster.pid;

  let workerClusterInfo = {
    pid: wcPid,
    code: errorCode,
    signal: signal,
    childProcess: this.workerCluster
  };

  this.emit(this.EVENT_WORKER_CLUSTER_EXIT, workerClusterInfo);

  let message = `WorkerCluster exited with code ${errorCode}`;
  if (signal != null) {
    message += ` and signal ${signal}`;
  }
  if (errorCode === 0) {
    this.emitInfo(message, {
      type: 'WorkerCluster',
      pid: wcPid
    });
  } else {
    let error = new ProcessExitError(message, errorCode);
    if (signal != null) {
      error.signal = signal;
    }
    this.emitError(error, {
      type: 'WorkerCluster',
      pid: wcPid
    });
  }

  if (!this.isShuttingDown) {
    this._launchWorkerCluster();
  }
};

SocketCluster.prototype._launchWorkerCluster = function () {
  let debugPort, inspectPort;

  let debugRegex = /^--debug(=[0-9]*)?$/;
  let debugBrkRegex = /^--debug-brk(=[0-9]*)?$/;
  let inspectRegex = /^--inspect(=[0-9]*)?$/;
  let inspectBrkRegex = /^--inspect-brk(=[0-9]*)?$/;

  // Workers should not inherit the master --debug argument
  // because they have their own --debug-workers option.
  let execOptions = {
    execArgv: process.execArgv.filter((arg) => {
      return !debugRegex.test(arg) && !debugBrkRegex.test(arg) && !inspectRegex.test(arg) && !inspectBrkRegex.test(arg);
    })
  };

  if (argv['debug-workers']) {
    if (argv['debug-workers'] === true) {
      debugPort = this.options.defaultWorkerDebugPort;
    } else {
      debugPort = argv['debug-workers'];
    }
    execOptions.execArgv.push('--debug=' + debugPort);
  }

  if (argv['inspect-workers']) {
    if (argv['inspect-workers'] === true) {
      inspectPort = this.options.defaultWorkerDebugPort;
    } else {
      inspectPort = argv['inspect-workers'];
    }
    execOptions.execArgv.push('--debug-port=' + inspectPort);
    execOptions.execArgv.push('--inspect=' + inspectPort);
  }

  let paths = this._getPaths();

  let workerOpts = this._cloneObject(this.options);
  workerOpts.paths = paths;
  workerOpts.sourcePort = this.options.port;
  workerOpts.workerCount = this.options.workers;
  workerOpts.brokers = this._getBrokerSocketPaths();
  workerOpts.secretKey = this.options.secretKey;
  workerOpts.authKey = this.options.authKey;
  workerOpts.authPrivateKey = this.options.authPrivateKey;
  workerOpts.authPublicKey = this.options.authPublicKey;
  workerOpts.authDefaultExpiry = this.options.authDefaultExpiry;
  workerOpts.authAlgorithm = this.options.authAlgorithm;
  workerOpts.authVerifyAlgorithms = this.options.authVerifyAlgorithms;
  workerOpts.authSignAsync = this.options.authSignAsync;
  workerOpts.authVerifyAsync = this.options.authVerifyAsync;

  if (typeof workerOpts.schedulingPolicy === 'string') {
    if (workerOpts.schedulingPolicy === 'rr') {
      workerOpts.schedulingPolicy = cluster.SCHED_RR;
    } else if (workerOpts.schedulingPolicy === 'none') {
      workerOpts.schedulingPolicy = cluster.SCHED_NONE;
    }
  }

  execOptions.env = {};
  Object.keys(process.env).forEach((key) => {
    execOptions.env[key] = process.env[key];
  });
  execOptions.env.workerInitOptions = JSON.stringify(workerOpts);

  this.workerCluster = fork(paths.appWorkerClusterControllerPath, process.argv.slice(2), execOptions);
  this.isWorkerClusterReady = false;

  this.workerCluster.on('error', (err) => {
    this._workerClusterErrorHandler(this.workerCluster.pid, err);
  });

  this.workerCluster.on('message', (message) => {
    if (message.type === 'error') {
      if (message.data.workerPid) {
        this._workerErrorHandler(message.data.workerPid, message.data.error);
      } else {
        this._workerClusterErrorHandler(message.data.pid, message.data.error);
      }
    } else if (message.type === 'warning') {
      let warning = scErrors.hydrateError(message.data.error, true);
      this._workerWarningHandler(message.data.workerPid, warning);
    } else if (message.type === 'ready') {
      this._workerClusterReadyHandler();
    } else if (message.type === 'workerStart') {
      this._workerStartHandler(message.data);
    } else if (message.type === 'workerExit') {
      this._workerExitHandler(message.data);
    } else if (message.type === 'workerMessage') {
      this.emit(this.EVENT_WORKER_MESSAGE, {
        workerId: message.workerId,
        data: message.data
      });
    } else if (message.type === 'workerRequest') {
      this.emit(this.EVENT_WORKER_REQUEST, {
        workerId: message.workerId,
        data: message.data,
        end: (data) => {
          this.respondToWorker(null, data, message.workerId, message.cid);
        },
        error: (err) => {
          this.respondToWorker(err, null, message.workerId, message.cid);
        }
      });
    } else if (message.type === 'workerResponse' || message.type === 'workerClusterResponse') {
      let responseHandler = this._pendingResponseHandlers[message.rid];
      if (responseHandler) {
        clearTimeout(responseHandler.timeout);
        delete this._pendingResponseHandlers[message.rid];
        let properError = scErrors.hydrateError(message.error, true);
        responseHandler.callback(properError, message.data, message.workerId);
      }
    }
  });

  let workerClusterInfo = {
    pid: this.workerCluster.pid,
    childProcess: this.workerCluster
  };

  this.emit(this.EVENT_WORKER_CLUSTER_START, workerClusterInfo);

  this.workerCluster.on('exit', this._handleWorkerClusterExit.bind(this));
  this.workerCluster.on('disconnect', () => {
    this.isWorkerClusterReady = false;
    this.workerClusterMessageBuffer = [];
  });
};

SocketCluster.prototype.respondToWorker = function (err, data, workerId, rid) {
  this.workerCluster.send({
    type: 'masterResponse',
    workerId,
    error: scErrors.dehydrateError(err, true),
    data,
    rid
  });
};

SocketCluster.prototype._logDeploymentDetails = function () {
  if (this.options.logLevel > 0) {
    console.log(`   ${this.colorText('[Active]', 'green')} SocketCluster started`);
    console.log(`            Version: ${pkg.version}`);
    console.log(`            Environment: ${this.options.environment}`);
    console.log(`            WebSocket engine: ${this.options.wsEngine}`);
    console.log(`            Port: ${this.options.port}`);
    console.log(`            Master PID: ${process.pid}`);
    console.log(`            Worker count: ${this.options.workers}`);
    console.log(`            Broker count: ${this.options.brokers}`);
    console.log();
  }
};

// Can be overriden.
SocketCluster.prototype.run = function () {};

SocketCluster.prototype._start = function () {
  let paths = this._getPaths();

  let brokerDebugPort = argv['debug-brokers'];
  if (brokerDebugPort === true) {
    brokerDebugPort = this.options.defaultBrokerDebugPort;
  }

  let brokerInspectPort = argv['inspect-brokers'];
  if (brokerInspectPort === true) {
    brokerInspectPort = this.options.defaultBrokerDebugPort;
  }

  this._brokerEngineServer = new this._brokerEngine.Server({
    brokers: this._getBrokerSocketPaths(),
    debug: brokerDebugPort,
    inspect: brokerInspectPort,
    instanceId: this.options.instanceId,
    secretKey: this.options.secretKey,
    expiryAccuracy: this._dataExpiryAccuracy,
    downgradeToUser: this.options.downgradeToUser,
    processTermTimeout: this.options.processTermTimeout,
    forceKillTimeout: this.options.forceKillTimeout,
    forceKillSignal: this.options.forceKillSignal,
    ipcAckTimeout: this.options.ipcAckTimeout,
    brokerOptions: this.options,
    appBrokerControllerPath: paths.appBrokerControllerPath
  });

  (async () => {
    for await (let {error} of this._brokerEngineServer.listener('error')) {
      if (error.brokerPid) {
        this._brokerErrorHandler(error.brokerPid, error);
      } else {
        this._brokerEngineErrorHandler(error.pid, error);
      }
    }
  })();

  (async () => {
    await this._brokerEngineServer.listener('ready').once();
    this._launchWorkerCluster();
  })();

  (async () => {
    for await (let brokerInfo of this._brokerEngineServer.listener('brokerStart')) {
      this.emit(this.EVENT_BROKER_START, brokerInfo);
    }
  })();

  (async () => {
    for await (let brokerInfo of this._brokerEngineServer.listener('brokerExit')) {
      this.emit(this.EVENT_BROKER_EXIT, brokerInfo);
    }
  })();

  (async () => {
    for await (let event of this._brokerEngineServer.listener('brokerMessage')) {
      this.emit(this.EVENT_BROKER_MESSAGE, event);
    }
  })();

  (async () => {
    for await (let req of this._brokerEngineServer.listener('brokerRequest')) {
      this.emit(this.EVENT_BROKER_REQUEST, req);
    }
  })();
};

SocketCluster.prototype._createIPCResponseHandler = function (callback) {
  let cid = uuid.v4();

  let responseTimeout = setTimeout(() => {
    let responseHandler = this._pendingResponseHandlers[cid];
    if (responseHandler) {
      delete this._pendingResponseHandlers[cid];
      let timeoutError = new TimeoutError('IPC response timed out');
      responseHandler.callback(timeoutError);
    }
  }, this.options.ipcAckTimeout);

  this._pendingResponseHandlers[cid] = {
    callback,
    timeout: responseTimeout
  };

  return cid;
};

SocketCluster.prototype._flushWorkerClusterMessageBuffer = function () {
  this.workerClusterMessageBuffer.forEach((messagePacket) => {
    this.workerCluster.send(messagePacket);
  });
  this.workerClusterMessageBuffer = [];
};

SocketCluster.prototype.sendRequestToWorker = function (workerId, data) {
  let messagePacket = {
    type: 'masterRequest',
    workerId: workerId,
    data: data
  };
  return new Promise((resolve, reject) => {
    messagePacket.cid = this._createIPCResponseHandler((err, data) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(data);
    });
    this.workerClusterMessageBuffer.push(messagePacket);

    if (this.isWorkerClusterReady) {
      this._flushWorkerClusterMessageBuffer();
    }
  });
};

SocketCluster.prototype.sendMessageToWorker = function (workerId, data) {
  let messagePacket = {
    type: 'masterMessage',
    workerId: workerId,
    data: data
  };
  return new Promise((resolve, reject) => {
    messagePacket.cid = this._createIPCResponseHandler((err, data) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(data);
    });
    this.workerClusterMessageBuffer.push(messagePacket);

    if (this.isWorkerClusterReady) {
      this._flushWorkerClusterMessageBuffer();
    }
  });
};

SocketCluster.prototype.sendRequestToBroker = function (brokerId, data) {
  if (!this._brokerEngineServer) {
    return Promise.reject(
      new InvalidActionError('Cannot send a request to a broker until the master instance is ready')
    );
  }
  return this._brokerEngineServer.sendRequestToBroker(brokerId, data);
};

SocketCluster.prototype.sendMessageToBroker = function (brokerId, data) {
  if (!this._brokerEngineServer) {
    return Promise.reject(
      new InvalidActionError('Cannot send a message to a broker until the master instance is ready')
    );
  }
  return this._brokerEngineServer.sendMessageToBroker(brokerId, data);
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
  return Object.assign({}, object);
};

SocketCluster.prototype.colorText = function (message, color) {
  if (this._colorCodes[color]) {
    return `\x1b[0;${this._colorCodes[color]}m${message}\x1b[0m`;
  } else if (color) {
    return `\x1b[${color}m${message}\x1b[0m`;
  }
  return message;
};

SocketCluster.prototype.destroy = async function () {
  if (this.isShuttingDown) {
    await this.listener('destroy').once();
    return;
  }
  this.isShuttingDown = true;

  (async () => {
    await Promise.all([
      (async () => {
        if (this.workerCluster) {
          await this.listener(this.EVENT_WORKER_CLUSTER_EXIT).once();
        }
      })(),
      (async () => {
        if (this._brokerEngineServer) {
          let killedBrokerLookup = {};
          let killedBrokerCount = 0;
          for await (let event of this.listener(this.EVENT_BROKER_EXIT)) {
            if (!killedBrokerLookup[event.brokerId]) {
              killedBrokerLookup[event.brokerId] = true;
              killedBrokerCount++;
            }
            if (killedBrokerCount >= this.options.brokers) {
              break;
            }
          }
        }
      })()
    ]);

    await new Promise((resolve) => {
      setTimeout(() => {
        resolve();
      }, 0);
    });

    socketClusterSingleton = null;
    this.isShuttingDown = false;
    if (this._stdinErrorHandler) {
      process.stdin.removeListener('error', this._stdinErrorHandler);
    }
    if (this._sigusr2SignalHandler) {
      process.removeListener('SIGUSR2', this._sigusr2SignalHandler);
    }
    this.emit('destroy', {});
    this.closeAllListeners();
  })();

  if (this.workerCluster) {
    this.killWorkers({killClusterMaster: true});
  }
  if (this._brokerEngineServer) {
    this._brokerEngineServer.destroy();
  }
  await this.listener('destroy').once();
};

module.exports = SocketCluster;
