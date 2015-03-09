var fs = require('fs');
var http = require('http');
var getTestSocketPath = require('./testsocketpath').getTestSocketPath;
var util = require('util');

module.exports.run = function (store) {
  console.log('   >> Store PID:', process.pid);
  
  var resultSocketPath = getTestSocketPath();
  
  // Send test data to index.js every second
  var testDataInterval = setInterval(function () {
    var socketChannelData = store.channelMap.get(['sockets']);
    var channels = [];
    for (var i in socketChannelData) {
      channels = channels.concat(Object.keys(socketChannelData[i]));
    }
    
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
        type: 'channels',
        data: channels
      },
      {
        origin: 'store',
        pid: process.pid,
        type: 'all',
        data: store.dataMap.getAll()
      }
    ]));
    req.end();
  }, 1000);
};
