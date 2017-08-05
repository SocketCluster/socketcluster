var SocketCluster = require('../../index').SocketCluster;

var socketCluster = new SocketCluster({
  workers: 2,
  brokers: 2,
  port: 8000,
  appName: 'myapp',
  workerController: __dirname + '/worker2.js',
  brokerController: __dirname + '/broker2.js',
  socketChannelLimit: 100,
  crashWorkerOnError: true,
  rebootWorkerOnCrash: true,
  ipcAckTimeout: 1000
});

socketCluster.on('brokerMessage', function (brokerId, data, respond) {
  console.log(`MASTER::Received data from broker ${brokerId}:`, data);
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

console.log('MASTER::Sending packet to broker 0');
socketCluster.sendToBroker(0, packet, function (err, data) {
  console.log('MASTER::Response error from broker 0:', err);
  console.log('MASTER::Response data from broker 0:', data);
});

console.log('MASTER::Sending packet to broker 1');
socketCluster.sendToBroker(1, packet, function (err, data) {
  console.log('MASTER::Response error from broker 1:', err);
  console.log('MASTER::Response data from broker 1:', data);
});

console.log('MASTER::Sending packet to non-existent broker 2');
socketCluster.sendToBroker(2, packet, function (err, data) {
  console.log('MASTER::Response error from non-existent broker 2:', err);
  console.log('MASTER::Response data from non-existent broker 2:', data);
});

var errorPacket = {
  fail: true
};

console.log('MASTER::Sending error-causing packet to broker 0');
socketCluster.sendToBroker(0, errorPacket, function (err, data) {
  console.log('MASTER::Error response error from broker 0:', err);
  console.log('MASTER::Error response data from broker 0:', data);
});

console.log('MASTER::Sending error-causing packet to broker without callback 0');
socketCluster.sendToBroker(0, errorPacket);

var timeoutPacket = {
  doNothing: true
};

console.log('MASTER::Sending timeout-causing packet to broker 0');
socketCluster.sendToBroker(0, timeoutPacket, function (err, data) {
  console.log('MASTER::Timeout response error from broker 0:', err);
  console.log('MASTER::Timeout response data from broker 0:', data);
});

console.log('MASTER::Sending timeout-causing packet to broker 0 without callback');
socketCluster.sendToBroker(0, timeoutPacket);
