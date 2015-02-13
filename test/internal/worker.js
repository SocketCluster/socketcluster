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
};