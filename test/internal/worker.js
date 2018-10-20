var SCWorker = require('../../scworker');
var fs = require('fs');

class Worker extends SCWorker {
  run() {
    console.log('   >> Worker PID:', process.pid);

    // Get a reference to our raw Node HTTP server
    var httpServer = this.getHTTPServer();
    // Get a reference to our WebSocket server
    var wsServer = this.getSCServer();

    this.on('masterRequest', (data, res) => {
    	console.log(`WORKER ${this.id}::Received request data from master:`, data);
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

    this.on('masterMessage', (data) => {
    	console.log(`WORKER ${this.id}::Received message data from master:`, data);
    });

    var packet = {
      prop: 1234
    };

    console.log(`WORKER ${this.id}::Sending packet to master`);
    this.sendRequestToMaster(packet)
    .then((data) => {
      console.log(`WORKER ${this.id}::Response data packet from master:`, data);
    })
    .catch((err) => {
      console.log(`WORKER ${this.id}::Response error from master:`, err);
    });

    var timeoutPacket = {
      doNothing: true
    };

    console.log(`WORKER ${this.id}::Sending timeout-causing packet to master`);
    this.sendRequestToMaster(timeoutPacket)
    .then((data) => {
      console.log(`WORKER ${this.id}::Timeout response data packet from master:`, data);
    })
    .catch((err) => {
      console.log(`WORKER ${this.id}::Timeout response error from master:`, err);
    });

    console.log(`WORKER ${this.id}::Sending timeout-causing packet to master without Promise`);
    this.sendMessageToMaster(timeoutPacket);

    var errorPacket = {
      fail: true
    };

    console.log(`WORKER ${this.id}::Sending error-causing packet to master`);
    this.sendRequestToMaster(errorPacket)
    .then((data) => {
      console.log(`WORKER ${this.id}::Error response data packet from master:`, data);
    })
    .catch((err) => {
      console.log(`WORKER ${this.id}::Error response error from master:`, err);
    });

    console.log(`WORKER ${this.id}::Sending error-causing packet to master without Promise`);
    this.sendMessageToMaster(errorPacket);
  }
}

new Worker();
