var fs = require('fs');

module.exports.run = function (worker) {
  console.log('   >> Worker PID:', process.pid);
  
  // Get a reference to our raw Node HTTP server
  var httpServer = worker.getHTTPServer();
  // Get a reference to our WebSocket server
  var wsServer = worker.getSCServer();

  wsServer.on('notice', function (notice) {
		console.log('NOTICE:', notice);
	});
  
  var pongData = {message: 'This is pong data'};
  
  /*
      In here we handle our incoming WebSocket connections and listen for events.
      From here onwards is just like Socket.io but with some additional features.
  */
  wsServer.on('connection', function (socket) {
    socket.emit('first', 'This is the first event');

    socket.on('ping', function () {
      wsServer.global.publish('pong', pongData);
    });
    
    socket.on('killWorker', function () {
      process.exit();
    });
    
    socket.on('new', function () {
      console.log('Received new event');
    });
  });
};