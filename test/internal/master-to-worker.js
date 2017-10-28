var SocketCluster = require('../../index');

var socketCluster = new SocketCluster({
  workers: 2,
  brokers: 2,
  port: 8000,
  appName: 'myapp',
  workerController: __dirname + '/worker.js',
  socketChannelLimit: 100,
  crashWorkerOnError: true,
  rebootWorkerOnCrash: true,
  ipcAckTimeout: 1000
});

socketCluster.on('workerMessage', function (workerId, data, respond) {
  console.log(`MASTER::Received data from worker ${workerId}:`, data);
  if (data.fail) {
    var err = new Error('Failure from master');
    err.name = 'MasterFailureError';
    respond(err);
  } else if (!data.doNothing) {

    respond(null, {
      qwerty: 123456
    });
  }
});

var packet = {
  id: 0,
  name: 'SocketCluster'
};

console.log('MASTER::Sending packet to worker 0');
socketCluster.sendToWorker(0, packet, function (err, data) {
  console.log('MASTER::Response error from worker 0:', err);
  console.log('MASTER::Response data from worker 0:', data);
});

console.log('MASTER::Sending packet to worker 1');
socketCluster.sendToWorker(1, packet, function (err, data) {
  console.log('MASTER::Response error from worker 1:', err);
  console.log('MASTER::Response data from worker 1:', data);
});

console.log('MASTER::Sending packet to non-existent worker 2');
socketCluster.sendToWorker(2, packet, function (err, data) {
  console.log('MASTER::Response error from non-existent worker 2:', err);
  console.log('MASTER::Response data from non-existent worker 2:', data);
});

var errorPacket = {
  fail: true
};

console.log('MASTER::Sending error-causing packet to worker 0');
socketCluster.sendToWorker(0, errorPacket, function (err, data) {
  console.log('MASTER::Error response error from worker 0:', err);
  console.log('MASTER::Error response data from worker 0:', data);
});

console.log('MASTER::Sending error-causing packet to worker 0 without callback');
socketCluster.sendToWorker(0, errorPacket);

var timeoutPacket = {
  doNothing: true
};

console.log('MASTER::Sending timeout-causing packet to worker 0');
socketCluster.sendToWorker(0, timeoutPacket, function (err, data) {
  console.log('MASTER::Timeout response error from worker 0:', err);
  console.log('MASTER::Timeout response data from worker 0:', data);
});

console.log('MASTER::Sending timeout-causing packet to worker 0 without callback');
socketCluster.sendToWorker(0, timeoutPacket);
