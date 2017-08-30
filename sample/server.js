var fs = require('fs');
var argv = require('minimist')(process.argv.slice(2));
var scErrors = require('sc-errors');
var TimeoutError = scErrors.TimeoutError;

var SocketCluster = require('socketcluster').SocketCluster;

var workerControllerPath = argv.wc || process.env.SOCKETCLUSTER_WORKER_CONTROLLER;
var brokerControllerPath = argv.bc || process.env.SOCKETCLUSTER_BROKER_CONTROLLER;
var initControllerPath = argv.ic || process.env.SOCKETCLUSTER_INIT_CONTROLLER;
var initWorkerClusterControllerPath = argv.iwc || process.env.SOCKETCLUSTER_INIT_WORKERCLUSTER_CONTROLLER;
var environment = process.env.ENV || 'dev';

var options = {
  workers: Number(argv.w) || Number(process.env.SOCKETCLUSTER_WORKERS) || 1,
  brokers: Number(argv.b) || Number(process.env.SOCKETCLUSTER_BROKERS) || 1,
  port: Number(argv.p) || Number(process.env.SOCKETCLUSTER_PORT) || 8000,
  // If your system doesn't support 'uws', you can switch to 'ws' (which is slower but works on older systems).
  wsEngine: process.env.SOCKETCLUSTER_WS_ENGINE || 'uws',
  appName: argv.n || process.env.SOCKETCLUSTER_APP_NAME || null,
  workerController: workerControllerPath || __dirname + '/worker.js',
  brokerController: brokerControllerPath || __dirname + '/broker.js',
  initController: initControllerPath || null,
  initWorkerClusterController: initWorkerClusterControllerPath || null,
  socketChannelLimit: Number(process.env.SOCKETCLUSTER_SOCKET_CHANNEL_LIMIT) || 1000,
  clusterStateServerHost: argv.cssh || process.env.SCC_STATE_SERVER_HOST || null,
  clusterStateServerPort: process.env.SCC_STATE_SERVER_PORT || null,
  clusterAuthKey: process.env.SCC_AUTH_KEY || null,
  clusterInstanceIp: process.env.SCC_INSTANCE_IP || null,
  clusterInstanceIpFamily: process.env.SCC_INSTANCE_IP_FAMILY || null,
  clusterStateServerConnectTimeout: Number(process.env.SCC_STATE_SERVER_CONNECT_TIMEOUT) || null,
  clusterStateServerAckTimeout: Number(process.env.SCC_STATE_SERVER_ACK_TIMEOUT) || null,
  clusterStateServerReconnectRandomness: Number(process.env.SCC_STATE_SERVER_RECONNECT_RANDOMNESS) || null,
  crashWorkerOnError: argv['auto-reboot'] != false,
  // If using nodemon, set this to true, and make sure that environment is 'dev'.
  killMasterOnSignal: false,
  environment: environment
};

var SOCKETCLUSTER_CONTROLLER_BOOT_TIMEOUT = Number(process.env.SOCKETCLUSTER_CONTROLLER_BOOT_TIMEOUT) || 10000;
var SOCKETCLUSTER_OPTIONS;

if (process.env.SOCKETCLUSTER_OPTIONS) {
  SOCKETCLUSTER_OPTIONS = JSON.parse(process.env.SOCKETCLUSTER_OPTIONS);
}

for (var i in SOCKETCLUSTER_OPTIONS) {
  if (SOCKETCLUSTER_OPTIONS.hasOwnProperty(i)) {
    options[i] = SOCKETCLUSTER_OPTIONS[i];
  }
}

var optionsControllerPath = argv.oc || process.env.SOCKETCLUSTER_OPTIONS_CONTROLLER;
var masterControllerPath = argv.mc || process.env.SOCKETCLUSTER_MASTER_CONTROLLER;

var fileExists = function (filePath, callback) {
  fs.access(filePath, fs.constants.F_OK, (err) => {
    callback(!err);
  });
};

var runMasterController = function (socketCluster, filePath) {
  var masterController = require(filePath);
  masterController.run(socketCluster);
};

var launch = function (startOptions) {
  var socketCluster = new SocketCluster(startOptions);
  var masterController;

  if (masterControllerPath) {
    runMasterController(socketCluster, masterControllerPath);
  } else {
    var defaultMasterControllerPath = __dirname + '/master.js';
    fileExists(defaultMasterControllerPath, (exists) => {
      if (exists) {
        runMasterController(socketCluster, defaultMasterControllerPath);
      }
    });
  }
};

var start = function () {
  if (optionsControllerPath) {
    var optionsController = require(optionsControllerPath);
    optionsController.run(options, launch);
  } else {
    launch(options);
  }
};

var bootCheckInterval = Number(process.env.SOCKETCLUSTER_BOOT_CHECK_INTERVAL) || 200;
var bootStartTime = Date.now();

// Detect when Docker volumes are ready.
var startWhenFileIsReady = (filePath) => {
  return new Promise((resolve, reject) => {
    if (!filePath) {
      resolve();
      return;
    }
    var checkIsReady = () => {
      var now = Date.now();

      fileExists(filePath, (exists) => {
        if (exists) {
          resolve();
        } else {
          if (now - bootStartTime >= SOCKETCLUSTER_CONTROLLER_BOOT_TIMEOUT) {
            var errorMessage = `Could not locate a controller file at path ${filePath} ` +
              `before SOCKETCLUSTER_CONTROLLER_BOOT_TIMEOUT`;
            var volumeBootTimeoutError = new TimeoutError(errorMessage);
            reject(volumeBootTimeoutError);
          } else {
            setTimeout(checkIsReady, bootCheckInterval);
          }
        }
      });
    };
    checkIsReady();
  });
};

var filesReadyPromises = [
  startWhenFileIsReady(optionsControllerPath),
  startWhenFileIsReady(masterControllerPath),
  startWhenFileIsReady(workerControllerPath),
  startWhenFileIsReady(brokerControllerPath),
  startWhenFileIsReady(initControllerPath)
];
Promise.all(filesReadyPromises)
.then(() => {
  start();
})
.catch((err) => {
  console.error(err.stack);
  process.exit(1);
});
