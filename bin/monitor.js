var forever = require('forever-monitor');
var fs = require('fs');

var logFileName = process.cwd() + '/socketcluster.out';

var fileName = process.argv[2];
if (!/[.]js$/.test(fileName)) {
  fileName += '.js';
}

var args = process.argv.slice(3);

var logMessage = function (message) {
  if (typeof message != 'string') {
    message = message.toString();
  }
  process.stdout.write(message);
  fs.appendFileSync(logFileName, message);
};

var maxRestarts = 1000;

logMessage('>>>> SocketCluster monitor launched - PID: ' + process.pid + '\n');

var child = new (forever.Monitor)(fileName, {
  max: maxRestarts,
  silent: true,
  args: args
});

child.on('stdout', logMessage);
child.on('stderr', logMessage);
child.on('error', function (err) {
  logMessage(Date.now() + ' - SocketCluster monitor error - ' + err + '\n');
  child.restart();
});

child.on('start', function (process, data) {
  logMessage(Date.now() + ' - Master script started - PID: ' + data.pid + '\n');
  process.send('ready');
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