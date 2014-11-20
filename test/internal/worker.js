var fs = require('fs');

module.exports.run = function (worker) {
  console.log('   >> Worker PID:', process.pid);
  
  // Get a reference to our raw Node HTTP server
  var httpServer = worker.getHTTPServer();
  // Get a reference to our WebSocket server
  var wsServer = worker.getSCServer();

  var activeSessions = {};

  wsServer.on('notice', function (notice) {
		console.log('NOTICE:', notice);
	});
  
  var pongData = {message: 'This is pong data'};
  
  /*
      In here we handle our incoming WebSocket connections and listen for events.
      From here onwards is just like Socket.io but with some additional features.
  */
  wsServer.on('connection', function (socket) {
    /*
        Store that socket's session for later use.
        We will emit events on it later - Those events will 
        affect all sockets which belong to that session.
    */
    activeSessions[socket.session.id] = socket.session;
  });
  
  wsServer.on('sessionEnd', function (ssid) {
    delete activeSessions[ssid];
  });
};