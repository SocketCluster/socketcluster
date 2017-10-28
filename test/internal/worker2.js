var SCWorker = require('../../scworker');
var fs = require('fs');

class Worker extends SCWorker {
  run() {
    console.log('   >> Worker PID:', process.pid);

    // Get a reference to our raw Node HTTP server
    var httpServer = this.getHTTPServer();
    // Get a reference to our WebSocket server
    var wsServer = this.getSCServer();
  }
}

new Worker()
