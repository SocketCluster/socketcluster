var fs = require('fs');

module.exports.run = function (worker) {
  console.log('   >> Worker PID:', process.pid);
  
  // Get a reference to our raw Node HTTP server
  var httpServer = worker.getHTTPServer();
  // Get a reference to our WebSocket server
  var wsServer = worker.getSCServer();

  worker.on('masterMessage',function(data,res) {
  	console.log('WORKER::Received data packet from server')
  	console.log(arguments)
  	console.log('WORKER::Responding back to server.')
  	res && res({ id:1,name:'TestName' })
  });
};