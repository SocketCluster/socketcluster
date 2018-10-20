var SCBroker = require('../../scbroker');

class Broker extends SCBroker {
  run() {
    console.log('   >> Broker PID:', process.pid);

    this.on('masterRequest', (data, res) => {
    	console.log(`BROKER ${this.id}::Received request data from master:`, data);
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

    this.on('masterMessage', (data) => {
    	console.log(`BROKER ${this.id}::Received message data from master:`, data);
    });

    var packet = {
      prop: 1234
    };

    console.log(`BROKER ${this.id}::Sending packet to master`);
    this.sendRequestToMaster(packet)
    .then((data) => {
      console.log(`BROKER ${this.id}::Response data packet from master:`, data);
    })
    .catch((err, data) => {
      console.log(`BROKER ${this.id}::Response error from master:`, err);
    });

    var timeoutPacket = {
      doNothing: true
    };

    console.log(`BROKER ${this.id}::Sending timeout-causing packet to master`);
    this.sendRequestToMaster(timeoutPacket)
    .then((data) => {
      console.log(`BROKER ${this.id}::Timeout response data packet from master:`, data);
    })
    .catch((err, data) => {
      console.log(`BROKER ${this.id}::Timeout response error from master:`, err);
    });

    var errorPacket = {
      fail: true
    };

    console.log(`BROKER ${this.id}::Sending error-causing packet to master`);
    this.sendRequestToMaster(errorPacket)
    .then((data) => {
      console.log(`BROKER ${this.id}::Error response data packet from master:`, data);
    })
    .catch((err) => {
      console.log(`BROKER ${this.id}::Error response error from master:`, err);
    });

    console.log(`BROKER ${this.id}::Sending error-causing packet to master without Promise`);
    this.sendMessageToMaster(errorPacket);
  }
}

new Broker();
