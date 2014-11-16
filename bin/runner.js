var fork = require('child_process').fork;
var fs = require('fs');

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
  if (scMaster) {
    scMaster.kill('SIGTERM');
  }
  
  logMessage('>>>> SocketCluster runner launched - PID: ' + process.pid + '\n');
  
  var runMaster = function () {
    scMaster = fork(fileName, args, {silent: true});
    
    scMaster.stdout.on('data', logMessage);
    scMaster.stderr.on('data', logMessage);
    
    scMaster.on('exit', function (code, signal) {
      try {
        logMessage(Date.now() + ' - SocketCluster master exited with code: ' + code + ', signal: ' + signal + '\n');
      } catch (e) {
        console.log("Could not write to log file '" + logFileName + "' -", e.stack || e.message);
      }
      runMaster();
    });
  };
  
  runMaster();
};

process.on('SIGTERM', function () {
  logMessage('>>>> SocketCluster runner was terminated by SIGTERM\n');
  scMaster.kill('SIGTERM');
  process.exit();
});

// Capture SIGHUP and ignore
process.on('SIGHUP', function () {});
