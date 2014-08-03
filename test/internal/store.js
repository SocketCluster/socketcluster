var fs = require('fs');
var http = require('http');
var getTestSocketPath = require('./testsocketpath').getTestSocketPath;

module.exports.run = function (store) {
  console.log('   >> Store PID:', process.pid);
  
  var resultSocketPath = getTestSocketPath();
  
  // Send test data to index.js every second
  var testDataInterval = setInterval(function () {
    var sessions = Object.keys(store.get(['__iocl', 'sed']) || {});
    var req = http.request({
      socketPath: resultSocketPath,
      method: 'POST'
    }, function (res) {
      res.on('data', function (data) {
        if (data.toString() == 'finish') {
          clearInterval(testDataInterval);
        }
      });
    });
    req.write(JSON.stringify([
      {
        origin: 'store',
        pid: process.pid,
        type: 'sessions',
        data: sessions
      },
      {
        origin: 'store',
        pid: process.pid,
        type: 'all',
        data: store.getAll()
      }
    ]));
    req.end();
  }, 1000);
};
