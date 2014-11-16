var fork = require('child_process').fork;
var fs = require('fs');
var forever = require('forever-monitor');

var scMaster;
var logFileName = process.cwd() + '/socketcluster.out';

var logMessage = function (message) {
  if (typeof message != 'string') {
    message = message.toString();
  }
  process.stdout.write(message);
  fs.appendFileSync(logFileName, message);
};

module.exports.run = function (fileName, args) {
  var maxRestarts = 1000;
  
  logMessage('>>>> SocketCluster monitor launched - PID: ' + process.pid + '\n');
  
  var child = new (forever.Monitor)(fileName, {
    max: maxRestarts,
    silent: true,
    args: args
  });
  
  child.on('stdout', logMessage);
  child.on('stderr', logMessage);
  
  child.on('start', function (process, data) {
    logMessage(Date.now() + ' - Master script started - PID: ' + data.pid + '\n');
  });
  
  child.on('restart', function (process, data) {
    logMessage(Date.now() + ' - Master script restarted - PID: ' + data.pid + '\n');
  });
  
  child.on('exit:code', function (code) {
    logMessage('Master script exited with code ' + code + '\n');
  });
  
  child.on('exit', function () {
    logMessage('>>>> SocketCluster monitor exceeded maximum restart count of ' + maxRestarts + ' for file ' + fileName);
  });

  child.start();
};