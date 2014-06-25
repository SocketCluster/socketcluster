var SocketCluster = require('socketcluster').SocketCluster;

var socketCluster = new SocketCluster({
  workers: [9100],
  stores: [9001],
  balancerCount: 1,
  port: 8000,
  appName: 'myapp',
  workerController: 'worker.js',
  balancerController: 'balancer.js',
  storeController: 'store.js',
  addressSocketLimit: 0,
  socketEventLimit: 100,
  sessionTimeout: 5,
  rebootWorkerOnError: true,
  useSmartBalancing: false
});