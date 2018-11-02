var SCBroker = require('../../scbroker');
var fs = require('fs');
var http = require('http');
var getTestSocketPath = require('./test-socket-path').getTestSocketPath;
var util = require('util');

class Broker extends SCBroker {
  run() {
    console.log('   >> Broker PID:', process.pid);

    var resultSocketPath = getTestSocketPath();

    // Send test data to index.js every second
    var testDataInterval = setInterval(() => {
      var socketChannelData = this.subscriptions;
      var channels = [];
      for (var i in socketChannelData) {
        channels = channels.concat(Object.keys(socketChannelData[i]));
      }

      var req = http.request({
        socketPath: resultSocketPath,
        method: 'POST'
      }, (res) => {
        res.on('data', (data) => {
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
          data: this.dataMap.getAll()
        }
      ]));
      req.end();
    }, 1000);
  }
}

new Broker();
