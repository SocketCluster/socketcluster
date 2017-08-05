
module.exports.run = function (broker) {
  console.log('   >> Broker PID:', process.pid);

  broker.on('masterMessage', function (data, res) {
  	console.log(`BROKER ${broker.id}::Received data from master:`, data);
    if (data.fail) {
      var err = new Error('This is an error from broker');
      err.name = 'MyCustomBrokerError';
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

  console.log(`BROKER ${broker.id}::Sending packet to master`);
  broker.sendToMaster(packet, function (err, data) {
    console.log(`BROKER ${broker.id}::Response error from master:`, err);
    console.log(`BROKER ${broker.id}::Response data packet from master:`, data);
  });

  var timeoutPacket = {
    doNothing: true
  };

  console.log(`BROKER ${broker.id}::Sending timeout-causing packet to master`);
  broker.sendToMaster(timeoutPacket, function (err, data) {
    console.log(`BROKER ${broker.id}::Timeout response error from master:`, err);
    console.log(`BROKER ${broker.id}::Timeout response data packet from master:`, data);
  });

  var errorPacket = {
    fail: true
  };

  console.log(`BROKER ${broker.id}::Sending error-causing packet to master`);
  broker.sendToMaster(errorPacket, function (err, data) {
    console.log(`BROKER ${broker.id}::Error response error from master:`, err);
    console.log(`BROKER ${broker.id}::Error response data packet from master:`, data);
  });

  console.log(`BROKER ${broker.id}::Sending error-causing packet to master without callback`);
  broker.sendToMaster(errorPacket);
};
