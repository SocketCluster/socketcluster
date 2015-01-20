var SocketCluster = require('../../index').SocketCluster;

var socketCluster = new SocketCluster({
  balancers: 2,
  workers: 3,
  stores: 3,
  port: 8000,
  appName: 'myapp',
  workerController: __dirname + '/worker.js',
  balancerController: __dirname + '/balancer.js',
  storeController: __dirname + '/store.js',
  socketChannelLimit: 100,
  rebootWorkerOnCrash: true,
  useSmartBalancing: true,
  workerStatusInterval: 2
});

socketCluster.on('ready', function () {
  process.send({event: 'ready'});
});