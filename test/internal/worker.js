var SCWorker = require('../../scworker');
var fs = require('fs');

class Worker extends SCWorker {
  run() {
    console.log('   >> Worker PID:', process.pid);

    // Get a reference to our raw Node HTTP server
    var httpServer = this.getHTTPServer();
    // Get a reference to our WebSocket server
    var wsServer = this.getSCServer();

    this.on('masterMessage', (data, res) => {
    	console.log(`WORKER ${this.id}::Received data from master:`, data);
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

    console.log(`WORKER ${this.id}::Sending packet to master`);
    this.sendToMaster(packet, (err, data) => {
      console.log(`WORKER ${this.id}::Response error from master:`, err);
      console.log(`WORKER ${this.id}::Response data packet from master:`, data);
    });

    var timeoutPacket = {
      doNothing: true
    };

    console.log(`WORKER ${this.id}::Sending timeout-causing packet to master`);
    this.sendToMaster(timeoutPacket, (err, data) => {
      console.log(`WORKER ${this.id}::Timeout response error from master:`, err);
      console.log(`WORKER ${this.id}::Timeout response data packet from master:`, data);
    });

    console.log(`WORKER ${this.id}::Sending timeout-causing packet to master without callback`);
    this.sendToMaster(timeoutPacket);

    var errorPacket = {
      fail: true
    };

    console.log(`WORKER ${this.id}::Sending error-causing packet to master`);
    this.sendToMaster(errorPacket, (err, data) => {
      console.log(`WORKER ${this.id}::Error response error from master:`, err);
      console.log(`WORKER ${this.id}::Error response data packet from master:`, data);
    });

    console.log(`WORKER ${this.id}::Sending error-causing packet to master without callback`);
    this.sendToMaster(errorPacket);
  }
}

new Worker();
