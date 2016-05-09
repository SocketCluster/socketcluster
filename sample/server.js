var argv = require('minimist')(process.argv.slice(2));
var SocketCluster = require('socketcluster').SocketCluster;

var options = {
  workers: Number(argv.w) || Number(process.env.SOCKETCLUSTER_WORKERS) || 1,
  brokers: Number(argv.b) || Number(process.env.SOCKETCLUSTER_BROKERS) || 1,
  port: Number(argv.p) || 8000,
  // Switch wsEngine to 'uws' for a MAJOR performance boost (beta)
  wsEngine: process.env.SOCKETCLUSTER_WS_ENGINE || 'ws',
  appName: argv.n || process.env.SOCKETCLUSTER_APP_NAME || null,
  workerController: process.env.SOCKETCLUSTER_WORKER_CONTROLLER || __dirname + '/worker.js',
  brokerController: process.env.SOCKETCLUSTER_BROKER_CONTROLLER || __dirname + '/broker.js',
  socketChannelLimit: Number(process.env.SOCKETCLUSTER_SOCKET_CHANNEL_LIMIT) || 1000,
  crashWorkerOnError: argv['auto-reboot'] != false
};

var SOCKETCLUSTER_OPTIONS;

if (process.env.SOCKETCLUSTER_OPTIONS) {
  SOCKETCLUSTER_OPTIONS = JSON.parse(process.env.SOCKETCLUSTER_OPTIONS);
}

for (var i in SOCKETCLUSTER_OPTIONS) {
  if (SOCKETCLUSTER_OPTIONS.hasOwnProperty(i)) {
    options[i] = SOCKETCLUSTER_OPTIONS[i];
  }
}

var socketCluster = new SocketCluster(options);
