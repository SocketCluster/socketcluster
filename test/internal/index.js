var async = require('async');
var childProcess = require('child_process');
var scClient = require('socketcluster-client');
var assert = require('assert');
var http = require('http');
var util = require('util');
var getTestSocketPath = require('./testsocketpath').getTestSocketPath;

var scServer = childProcess.fork(__dirname + '/server.js');

var resultSocketPath = getTestSocketPath();
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
        socket.once('connect', function () {
          if (socket.connected) {
            console.log('#' + ++socketCount + ' - Socket ' + socket.id + ' connected');
 
            var interval = setInterval(function () {
              if (socket.connected) {
                socket.emit('test', {id: socket.id});
              } else {
                clearInterval(interval);
              }
            }, messageInterval);
            messageInterval += 100;
            
            cb();
          } else {
            cb(new Error('The client socket\'s connected property should be true once it emits a connect event'));
          }
        });
        sockets.push(socket);
      });
    }
    
    var assertTimeout = null;
    
    tasks.push(function (cb) {
      console.log('Done connecting');
      setTimeout(function () {
        var sessionCounts = {};
        var sessions;
        var storeCount = 0;
        var totalSessions = 0;
        
        for (var i in storeData) {
          storeCount++;
          sessions = storeData[i].sessions;
          sessionCounts[i] = 0;
          for (var j in sessions) {
            sessionCounts[i]++;
            totalSessions++;
          }
        }
        
        console.log('Store session distribution: ', sessionCounts);
        
        var meanSessionCount = totalSessions / storeCount;
        var similarityThreshold = .3; // 30%
        var isCloseToMean;
        for (var k in sessionCounts) {
          isCloseToMean = Math.abs(sessionCounts[k] - meanSessionCount) < meanSessionCount * similarityThreshold;
          assert(isCloseToMean, 'Session data was not evenly distributed between stores');
        }
        console.log('[Success] Session data was evenly distributed between stores');
        cb();
      }, 2000);
    });
    
    tasks.push(function (cb) {
      clearTimeout(assertTimeout);
      assertTimeout = setTimeout(timeoutError, 40000);
      
      console.log('Checking that store data gets cleaned up after sessions time out - This will take 30 seconds');
      
      for (var i in sockets) {
        sockets[i].disconnect();
      }
      
      setTimeout(function () {
        var allData = {};
        for (var i in storeData) {
          allData[i] = storeData[i].all;
        }
        console.log('Store data after session timeouts:', util.inspect(allData, {depth: 5}));
        
        for (var j in allData) {
          var isStoreDataEmpty = JSON.stringify(allData[j]).length < 70;
          assert(isStoreDataEmpty, 'Store data was not cleaned up after sessions timed out');
        }
        console.log('[Success] Store data was cleaned up after sessions timed out');
        
        cb();
      }, 30000);
    });
    
    var timedTasks = [];
    var timeoutMs = 5000;
    
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
        console.log('All tests passed!');
        endTest(function () {
          process.exit();
        });
      }
    });
  }
});