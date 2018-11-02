var SocketCluster = require('../../index');

var socketCluster = new SocketCluster({
  workers: 3,
  brokers: 3,
  port: 8000,
  appName: 'myapp',
  workerController: __dirname + '/worker.js',
  brokerController: __dirname + '/broker.js',
  socketChannelLimit: 100,
  crashWorkerOnError: true,
  rebootWorkerOnCrash: true
});

socketCluster.on('ready', function () {
  process.send({event: 'ready'});
});
