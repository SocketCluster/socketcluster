var SocketCluster = require('socketcluster').SocketCluster;

var socketCluster = new SocketCluster({
  balancers: 2,
  workers: 3,
  stores: 3,
  port: 8000,
  appName: 'myapp',
  workerController: __dirname + '/worker.js',
  balancerController: __dirname + '/balancer.js',
  storeController: __dirname + '/store.js',
  addressSocketLimit: 0,
  socketEventLimit: 100,
  rebootWorkerOnCrash: true,
  useSmartBalancing: false,
  sessionTimeout: 20
});

socketCluster.on('ready', function () {
  process.send({event: 'ready'});
});