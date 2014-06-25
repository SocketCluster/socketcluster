var SocketCluster = require('socketcluster').SocketCluster;

var socketCluster = new SocketCluster({
  workers: [9100],//, 9101, 9102],
  stores: [9001],//, 9002, 9003],
  balancerCount: 3,
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