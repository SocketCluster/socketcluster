var async = require('async');
var childProcess = require('child_process');
var scClient = require('sc2-client');
var assert = require('assert');
var http = require('http');
var util = require('util');
var fs = require('fs');
var getTestSocketPath = require('./testsocketpath').getTestSocketPath;

var scServer = childProcess.fork(__dirname + '/server.js');
var resultSocketPath = getTestSocketPath();

if (process.platform != 'win32') {
  if (fs.existsSync(resultSocketPath)) {
    fs.unlinkSync(resultSocketPath);
  }
}

var storeData = {};
var testIsOver = false;

var resultsServer = http.createServer(function (req, res) {
  var buf = [];
  req.on('data', function (data) {
    buf.push(data);
  });
  req.on('end', function () {
    var results = JSON.parse(Buffer.concat(buf).toString());
    var result;
    for (var i in results) {
      result = results[i];
      if (result.origin == 'store') {
        if (storeData[result.pid] == null) {
          storeData[result.pid] = {}
        }
        storeData[result.pid][result.type] = result.data;
      }
    }
    res.writeHead(200);
    if (testIsOver) {
      res.end('finish');
    } else {
      res.end();
    }
  });
}).listen(resultSocketPath);

var endTest = function (callback) {
  testIsOver = true;
  setTimeout(callback, 4000);
};

var options = {
  protocol: 'http',
  hostname: 'localhost',
  port: 8000,
  autoReconnect: true
};

scServer.on('message', function (m) {
  var numSockets = 100;
  var messageInterval = 2000;
  var socketCount = 0;

  if (m.event == 'ready') {
    var sockets = [];
    var tasks = [];
    
    for (var i = 0; i < numSockets; i++) {
      tasks.push(function (cb) {
        var socket = scClient.connect(options);
        socket.once('ready', function () {
          if (socket.getState() == socket.OPEN) {
            // Subscribe to some events
            socket.on('event1', function () {});
            socket.on('event2', function () {});
            socket.on('event3', function () {});
            socket.on('event4', function () {});

            console.log('#' + ++socketCount + ' - Socket ' + socket.id + ' connected');
 
            var interval = setInterval(function () {
              if (socket.getState() == socket.OPEN) {
                socket.emit('test', {id: socket.id});
              } else {
                clearInterval(interval);
              }
            }, messageInterval);
            messageInterval += 100;
            
            cb();
          } else {
            cb(new Error('The client socket\'s getState() should return socket.OPEN after it emits a connect event'));
          }
        });
        sockets.push(socket);
      });
    }
    
    tasks.push(function (cb) {
      console.log('Done connecting');
      console.log();
      console.log('Checking that a channel gets cleaned up after all clients unsubscribe from it');
      
      var numTest = 5;
      var c = 0;
      
      for (var i in sockets) {
        sockets[i].subscribe('foo');
        if (c++ >= numTest) {
          break;
        }
      }
      
      var checkResults = function () {
        var channels = {};
        for (var i in storeData) {
          channels[i] = storeData[i].channels;
        }
        
        var channelMapAsString = util.inspect(channels, {depth: 5});
        console.log('Store channels after unsubscribe:', channelMapAsString);
        
        var channelMapHasFoo = /foo/.test(channelMapAsString);
        assert(!channelMapHasFoo, 'Channel was not cleaned up after all clients unsubscribed from it');

        console.log('[Success] Store channel was cleaned up after all clients unsubscribed from it');
        
        cb();
      };
      
      c = 0;

      setTimeout(function () {
        for (var i in sockets) {
          sockets[i].unsubscribe('foo');
          if (c++ >= numTest) {
            break;
          }
        }
        setTimeout(checkResults, 2000);
      }, 3000);
    });
    
    var assertTimeout = null;
    
    tasks.push(function (cb) {
      console.log();
      clearTimeout(assertTimeout);
      assertTimeout = setTimeout(timeoutError, 10000);
      
      console.log('Checking that store data is empty after disconnecting all sockets');
      
      for (var i in sockets) {
        sockets[i].disconnect();
      }
      
      setTimeout(function () {
        var allData = {};
        for (var i in storeData) {
          allData[i] = storeData[i].all;
        }
        console.log('Store data after disconnecting all sockets:', util.inspect(allData, {depth: 5}));
        
        for (var j in allData) {
          var isStoreDataEmpty = JSON.stringify(allData[j]).length < 70;
          assert(isStoreDataEmpty, 'Store data was not cleaned up after all sockets were disconnected');
        }
        console.log('[Success] Store data was cleaned up after all sockets were disconnected');
        
        cb();
      }, 2000);
    });
    
    tasks.push(function (cb) {
      console.log();
      console.log('Checking that channels get cleaned up after all sockets were disconnected');
      
      var channels = {};
      for (var i in storeData) {
        channels[i] = storeData[i].channels;
      }
      console.log('Store channels after disconnecting all sockets:', util.inspect(channels, {depth: 5}));
      
      for (var j in channels) {
        var isChannelMapEmpty = JSON.stringify(channels[j]).length < 50;
        assert(isChannelMapEmpty, 'Channels were not cleaned up after disconnecting all sockets');
      }
      console.log('[Success] Store channels were cleaned up after disconnecting all sockets');
      
      cb();
    });
    
    var timedTasks = [];
    var timeoutMs = 20000;
    
    var timeoutError = function () {
      throw new Error('Test timed out');
    };
    
    var timeoutTask = function (cb) {
      clearTimeout(assertTimeout);
      assertTimeout = setTimeout(timeoutError, timeoutMs);
      cb();
    };
    
    for (var i in tasks) {
      timedTasks.push(timeoutTask);
      timedTasks.push(tasks[i]);
    }
    timedTasks.push(function (cb) {
      clearTimeout(assertTimeout);
      cb();
    });
    
    async.waterfall(timedTasks, function (err) {
      if (err) {
        throw err;
      } else {
        console.log();
        console.log('All tests passed!');
        endTest(function () {
          process.exit();
        });
      }
    });
  }
});