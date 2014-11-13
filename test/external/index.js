var async = require('async');
var childProcess = require('child_process');
var scClient = require('socketcluster-client');
var assert = require('assert');

var scServer = childProcess.fork(__dirname + '/server.js');

var options = {
  protocol: 'http',
  hostname: 'localhost',
  port: 8000,
  autoReconnect: true
};

scServer.on('message', function (m) {
  if (m.event == 'ready') {
    var socket = scClient.connect(options);
    
    var pongChannel;
    
    var tasks = [
      function (cb) {
        socket.on('first', function (data) {
          var err;
          try {
            assert(data == 'This is the first event', 'Received incorrect data from "first" event');
          } catch (e) {
            err = e;
          }
          cb(err);
        });
      },
      function (cb) {
        pongChannel = socket.subscribe('pong');
        pongChannel.watch(function (data) {
          var err;
          try {
            assert(JSON.stringify(data) == JSON.stringify({message: 'This is pong data'}),
              'Received incorrect data from "pong" event');
          } catch (e) {
            err = e;
          }
          cb(err);
        });
        socket.emit('ping');
      },
      function (cb) {
        pongChannel.unwatch();
        pongChannel.watch(function (data) {
          var err;
          try {
            assert(JSON.stringify(data) == JSON.stringify({message: 'published pong'}),
              'Received incorrect data from published "pong" event');
          } catch (e) {
            err = e;
          }
          cb(err);
        });
        socket.publish('pong', {message: 'published pong'});
      }
    ];
    
    var timedTasks = [];
    var timeoutMs = 5000;
    
    var timeoutError = function () {
      throw new Error('Test timed out');
    };
    
    var assertTimeout = null;
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
      }
    });
  }
});