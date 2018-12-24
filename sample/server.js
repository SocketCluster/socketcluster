/*
  This is the SocketCluster master controller file.
  It is responsible for bootstrapping the SocketCluster master process.
  Be careful when modifying the options object below.
  If you plan to run SCC on Kubernetes or another orchestrator at some point
  in the future, avoid changing the environment variable names below as
  each one has a specific meaning within the SC ecosystem.
*/

const path = require('path');
const scHotReboot = require('sc-hot-reboot');
const fsUtil = require('socketcluster/fsutil');
const waitForFile = fsUtil.waitForFile;

const SocketCluster = require('socketcluster');

let argv = require('minimist')(process.argv.slice(2));

let workerControllerPath = argv.wc || process.env.SOCKETCLUSTER_WORKER_CONTROLLER;
let brokerControllerPath = argv.bc || process.env.SOCKETCLUSTER_BROKER_CONTROLLER;
let workerClusterControllerPath = argv.wcc || process.env.SOCKETCLUSTER_WORKERCLUSTER_CONTROLLER;
let environment = process.env.ENV || 'dev';

let options = {
  workers: Number(argv.w) || Number(process.env.SOCKETCLUSTER_WORKERS) || 1,
  brokers: Number(argv.b) || Number(process.env.SOCKETCLUSTER_BROKERS) || 1,
  port: Number(argv.p) || Number(process.env.SOCKETCLUSTER_PORT) || 8000,
  // You can switch to 'sc-uws' for improved performance.
  wsEngine: process.env.SOCKETCLUSTER_WS_ENGINE || 'ws',
  appName: argv.n || process.env.SOCKETCLUSTER_APP_NAME || null,
  workerController: workerControllerPath || path.join(__dirname, 'worker.js'),
  brokerController: brokerControllerPath || path.join(__dirname, 'broker.js'),
  workerClusterController: workerClusterControllerPath || null,
  socketChannelLimit: Number(process.env.SOCKETCLUSTER_SOCKET_CHANNEL_LIMIT) || 1000,
  clusterStateServerHost: argv.cssh || process.env.SCC_STATE_SERVER_HOST || null,
  clusterStateServerPort: process.env.SCC_STATE_SERVER_PORT || null,
  clusterMappingEngine: process.env.SCC_MAPPING_ENGINE || null,
  clusterClientPoolSize: process.env.SCC_CLIENT_POOL_SIZE || null,
  clusterAuthKey: process.env.SCC_AUTH_KEY || null,
  clusterInstanceIp: process.env.SCC_INSTANCE_IP || null,
  clusterInstanceIpFamily: process.env.SCC_INSTANCE_IP_FAMILY || null,
  clusterStateServerConnectTimeout: Number(process.env.SCC_STATE_SERVER_CONNECT_TIMEOUT) || null,
  clusterStateServerAckTimeout: Number(process.env.SCC_STATE_SERVER_ACK_TIMEOUT) || null,
  clusterStateServerReconnectRandomness: Number(process.env.SCC_STATE_SERVER_RECONNECT_RANDOMNESS) || null,
  crashWorkerOnError: argv['auto-reboot'] !== false,
  // If using nodemon, set this to true, and make sure that environment is 'dev'.
  killMasterOnSignal: false,
  environment
};

let bootTimeout = Number(process.env.SOCKETCLUSTER_CONTROLLER_BOOT_TIMEOUT) || 10000;
let SOCKETCLUSTER_OPTIONS;

if (process.env.SOCKETCLUSTER_OPTIONS) {
  SOCKETCLUSTER_OPTIONS = JSON.parse(process.env.SOCKETCLUSTER_OPTIONS);
}

for (let i in SOCKETCLUSTER_OPTIONS) {
  if (SOCKETCLUSTER_OPTIONS.hasOwnProperty(i)) {
    options[i] = SOCKETCLUSTER_OPTIONS[i];
  }
}

let start = function () {
  let socketCluster = new SocketCluster(options);

  (async () => {
    for await (let event of socketCluster.listener(socketCluster.EVENT_WORKER_CLUSTER_START)) {
      console.log(`   >> WorkerCluster PID: ${event.pid}`);
    }
  })();

  if (socketCluster.options.environment === 'dev') {
    // This will cause SC workers to reboot when code changes anywhere in the app directory.
    // The second options argument here is passed directly to chokidar.
    // See https://github.com/paulmillr/chokidar#api for details.
    console.log(`   !! The sc-hot-reboot plugin is watching for code changes in the ${__dirname} directory`);
    scHotReboot.attach(socketCluster, {
      cwd: __dirname,
      ignored: ['public', 'node_modules', 'README.md', 'Dockerfile', 'server.js', 'broker.js', /[\/\\]\./, '*.log']
    });
  }
};

let bootCheckInterval = Number(process.env.SOCKETCLUSTER_BOOT_CHECK_INTERVAL) || 200;
let bootStartTime = Date.now();

// Detect when Docker volumes are ready.
let startWhenFileIsReady = (filePath) => {
  let errorMessage = `Failed to locate a controller file at path ${filePath} ` +
  `before SOCKETCLUSTER_CONTROLLER_BOOT_TIMEOUT`;

  return waitForFile(filePath, bootCheckInterval, bootStartTime, bootTimeout, errorMessage);
};

let filesReadyPromises = [
  startWhenFileIsReady(workerControllerPath),
  startWhenFileIsReady(brokerControllerPath),
  startWhenFileIsReady(workerClusterControllerPath)
];

(async () => {
  try {
    await Promise.all(filesReadyPromises);
  } catch (err) {
    console.error(err);
    process.exit(1);
    return;
  }
  start();
})();
