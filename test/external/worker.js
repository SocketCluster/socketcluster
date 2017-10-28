var SCWorker = require('../../scworker');
var fs = require('fs');

class Worker extends SCWorker {
  run() {
    console.log('   >> Worker PID:', process.pid);

    // Get a reference to our raw Node HTTP server
    var httpServer = this.getHTTPServer();
    // Get a reference to our WebSocket server
    var wsServer = this.getSCServer();

    var pongData = {message: 'This is pong data'};

    /*
        In here we handle our incoming WebSocket connections and listen for events.
        From here onwards is just like Socket.io but with some additional features.
    */
    wsServer.on('connection', (socket) => {
      socket.emit('first', 'This is the first event');

      socket.on('ping', () => {
        wsServer.exchange.publish('pong', pongData);
      });

      socket.on('login', (username) => {
        socket.setAuthToken({username: username});
      });

      socket.on('killWorker', () => {
        process.exit();
      });

      socket.on('new', () => {
        console.log('Received new event');
      });
    });
  }
}

new Worker();
