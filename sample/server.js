var argv = require('minimist')(process.argv.slice(2));
var SocketCluster = require('socketcluster').SocketCluster;

var options = {
  workers: Number(argv.w) || Number(process.env.SOCKET_CLUSTER_WORKERS) || 1,
  brokers: Number(argv.b) || Number(process.env.SOCKET_CLUSTER_BROKERS) || 1,
  port: Number(argv.p) || 8000,
  // Switch wsEngine to 'uws' for a MAJOR performance boost (beta)
  wsEngine: process.env.SOCKET_CLUSTER_WS_ENGINE || 'ws',
  appName: argv.n || process.env.SOCKET_CLUSTER_APP_NAME || null,
  workerController: __dirname + '/worker.js',
  brokerController: __dirname + '/broker.js',
  socketChannelLimit: Number(process.env.SOCKET_CLUSTER_SOCKET_CHANNEL_LIMIT) || 1000,
  crashWorkerOnError: argv['auto-reboot'] != false
};

var SOCKET_CLUSTER_OPTIONS;

if (process.env.SOCKET_CLUSTER_OPTIONS) {
  SOCKET_CLUSTER_OPTIONS = JSON.parse(process.env.SOCKET_CLUSTER_OPTIONS);
}

for (var i in SOCKET_CLUSTER_OPTIONS) {
  if (SOCKET_CLUSTER_OPTIONS.hasOwnProperty(i)) {
    options[i] = SOCKET_CLUSTER_OPTIONS[i];
  }
}

var socketCluster = new SocketCluster(options);
