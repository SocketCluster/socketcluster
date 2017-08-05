var fs = require('fs');
var http = require('http');
var getTestSocketPath = require('./test-socket-path').getTestSocketPath;
var util = require('util');

module.exports.run = function (broker) {
  console.log('   >> Broker PID:', process.pid);

  var resultSocketPath = getTestSocketPath();

  // Send test data to index.js every second
  var testDataInterval = setInterval(function () {
    var socketChannelData = broker.subscriptions;
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
        origin: 'broker',
        pid: process.pid,
        type: 'channels',
        data: channels
      },
      {
        origin: 'broker',
        pid: process.pid,
        type: 'all',
        data: broker.dataMap.getAll()
      }
    ]));
    req.end();
  }, 1000);
};
