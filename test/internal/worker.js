var fs = require('fs');

module.exports.run = function (worker) {
  console.log('   >> Worker PID:', process.pid);

  // Get a reference to our raw Node HTTP server
  var httpServer = worker.getHTTPServer();
  // Get a reference to our WebSocket server
  var wsServer = worker.getSCServer();

  worker.on('masterMessage', function (data, res) {
  	console.log(`WORKER ${worker.id}::Received data from master:`, data);
    if (data.fail) {
      var err = new Error('This is an error from worker');
      err.name = 'MyCustomWorkerError';
      res(err);
    } else if (!data.doNothing) {
      res(null, {
        id: 1,
        name: 'TestName'
      });
    }
  });

  var packet = {
    prop: 1234
  };

  console.log(`WORKER ${worker.id}::Sending packet to master`);
  worker.sendToMaster(packet, function (err, data) {
    console.log(`WORKER ${worker.id}::Response error from master:`, err);
    console.log(`WORKER ${worker.id}::Response data packet from master:`, data);
  });

  var timeoutPacket = {
    doNothing: true
  };

  console.log(`WORKER ${worker.id}::Sending timeout-causing packet to master`);
  worker.sendToMaster(timeoutPacket, function (err, data) {
    console.log(`WORKER ${worker.id}::Timeout response error from master:`, err);
    console.log(`WORKER ${worker.id}::Timeout response data packet from master:`, data);
  });

  console.log(`WORKER ${worker.id}::Sending timeout-causing packet to master without callback`);
  worker.sendToMaster(timeoutPacket);

  var errorPacket = {
    fail: true
  };

  console.log(`WORKER ${worker.id}::Sending error-causing packet to master`);
  worker.sendToMaster(errorPacket, function (err, data) {
    console.log(`WORKER ${worker.id}::Error response error from master:`, err);
    console.log(`WORKER ${worker.id}::Error response data packet from master:`, data);
  });

  console.log(`WORKER ${worker.id}::Sending error-causing packet to master without callback`);
  worker.sendToMaster(errorPacket);
};
