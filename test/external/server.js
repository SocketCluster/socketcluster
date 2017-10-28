var SocketCluster = require('../../index');

var socketCluster = new SocketCluster({
  workers: 1,
  brokers: 1,
  port: 8000,
  appName: 'myapp',
  workerController: __dirname + '/worker.js',
  brokerController: __dirname + '/broker.js',
  socketChannelLimit: 100,
  crashWorkerOnError: true,
  rebootWorkerOnCrash: true,
  pingTimeout: 3000,
  pingInterval: 1000
});

socketCluster.on('ready', function () {
  process.send({event: 'ready'});
});
