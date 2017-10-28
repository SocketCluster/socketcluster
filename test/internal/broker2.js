var SCBroker = require('../../scbroker');

class Broker extends SCBroker {
  run() {
    console.log('   >> Broker PID:', process.pid);

    this.on('masterMessage', (data, res) => {
    	console.log(`BROKER ${this.id}::Received data from master:`, data);
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

    console.log(`BROKER ${this.id}::Sending packet to master`);
    this.sendToMaster(packet, (err, data) => {
      console.log(`BROKER ${this.id}::Response error from master:`, err);
      console.log(`BROKER ${this.id}::Response data packet from master:`, data);
    });

    var timeoutPacket = {
      doNothing: true
    };

    console.log(`BROKER ${this.id}::Sending timeout-causing packet to master`);
    this.sendToMaster(timeoutPacket, (err, data) => {
      console.log(`BROKER ${this.id}::Timeout response error from master:`, err);
      console.log(`BROKER ${this.id}::Timeout response data packet from master:`, data);
    });

    var errorPacket = {
      fail: true
    };

    console.log(`BROKER ${this.id}::Sending error-causing packet to master`);
    this.sendToMaster(errorPacket, (err, data) => {
      console.log(`BROKER ${this.id}::Error response error from master:`, err);
      console.log(`BROKER ${this.id}::Error response data packet from master:`, data);
    });

    console.log(`BROKER ${this.id}::Sending error-causing packet to master without callback`);
    this.sendToMaster(errorPacket);
  }
}

new Broker();
