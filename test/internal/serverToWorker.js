var SocketCluster = require('../../index').SocketCluster;

var socketCluster = new SocketCluster({
  workers: 3,
  brokers: 3,
  port: 8000,
  appName: 'myapp',
  workerController: __dirname + '/worker.js',
  //brokerController: __dirname + '/broker.js',
  socketChannelLimit: 100,
  crashWorkerOnError: true,
  rebootWorkerOnCrash: true
});

socketCluster.on('workerClusterReady',function () {

  var packet = {
    id:0,
    name:'SocketCluster'
  }

  console.log('MASTER::Sending packet to worker 0')
  socketCluster.sendToWorker(0,packet,function(workerId,data) {
    console.log(`MASTER::Worker ${ workerId } data packet`)
    console.log(data)
    console.log('MASTER::End data packet')
  });

  console.log('MASTER::Sending packet to worker 1')
  socketCluster.sendToWorker(1,packet,function(workerId,data) {
    console.log(`MASTER::Worker ${ workerId } data packet`)
    console.log(data)
    console.log('MASTER::End data packet')
  });

  console.log('MASTER::Sending packet to worker 2')
  socketCluster.sendToWorker(2,packet,function(workerId,data) {
    console.log(`MASTER::Worker ${ workerId } data packet`)
    console.log(data)
    console.log('MASTER::End data packet')
  });
});