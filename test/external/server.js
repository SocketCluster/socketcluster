var SocketCluster = require('../../index').SocketCluster;

var socketCluster = new SocketCluster({
  workers: 1,
  stores: 1,
  port: 8000,
  appName: 'myapp',
  workerController: __dirname + '/worker.js',
  balancerController: __dirname + '/balancer.js',
  storeController: __dirname + '/store.js',
  socketChannelLimit: 100,
  rebootWorkerOnCrash: true,
  pingTimeout: 3000,
  pingInterval: 1000
});

socketCluster.on('ready', function () {
  process.send({event: 'ready'});
});