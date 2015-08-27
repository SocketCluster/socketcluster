var async = require('async');
var childProcess = require('child_process');
var scClient = require('socketcluster-client');
var assert = require('assert');
var domain = require('domain');

var scServer = childProcess.fork(__dirname + '/server.js');

var options = {
  protocol: 'http',
  hostname: '127.0.0.1',
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
          socket.removeAllListeners('first');
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
          pongChannel.unwatch();
          cb(err);
        });
        socket.emit('ping');
      },
      function (cb) {
        pongChannel.watch(function (data) {
          var err;
          try {
            assert(JSON.stringify(data) == JSON.stringify({message: 'published pong'}),
              'Received incorrect data from published "pong" event');
          } catch (e) {
            err = e;
          }
          cb(err);
          pongChannel.unwatch();
        });
        socket.publish('pong', {message: 'published pong'});
      },
      function (cb) {
        socket.unsubscribe('pong');
        var fooChannel = socket.subscribe('foo');
        fooChannel.on('subscribe', function () {
          var err;
          try {
            var subscriptions = socket.subscriptions();
            assert(JSON.stringify(subscriptions) == JSON.stringify(['foo']), 
              'Expected subscriptions() array to contain one "foo" channel');
          } catch (e) {
            err = e;
          }
          fooChannel.removeAllListeners('subscribe');
          cb(err);
        });
      },
      function (cb) {
        socket.subscribe('foo2');
        
        setTimeout(function () {
          socket.unsubscribe('foo2');
          
          setTimeout(function () {
            cb();
          }, 1000);
        }, 1000);
      },
      function (cb) {
        socket.emit('killWorker');
        socket.once('error', function (err) {
          console.log('Caught:', err);
        });
        
        var notUnsubscribedTimeout = setTimeout(function () {
          cb('Did not unsubscribe from channels on disconnect');
        }, 3000);
        
        socket.once('unsubscribe', function () {
          clearTimeout(notUnsubscribedTimeout);
          var err;
          
          try {
            var subscriptions = socket.subscriptions();
            assert(JSON.stringify(subscriptions) == JSON.stringify([]),
              'Did not unsubscribe from channels on disconnect');
          } catch (e) {
            err = e;
          }
          cb(err);
        });
      },
      function (cb) {
        setTimeout(function () {
          socket.emit('new');
          var err;
          
          setTimeout(function () {
            try {
              var subscriptions = socket.subscriptions();

              assert(JSON.stringify(subscriptions) == JSON.stringify(['foo']),
                'Did not automatically resubscribe to the correct channels which were unsubscribed due to disconnection');
            } catch (e) {
              err = e;
            }
            cb(err);
          }, 2000);
        }, 1000);
      },
      function (cb) {
        socket.subscribe('test');
        setTimeout(function () {
          var unsubscribeEmitted = false;
          
          socket.on('unsubscribe', function (channel) {
            if (channel == 'test') {
              unsubscribeEmitted = true;
            }
          });
        
          socket.unsubscribe('test');
          var err;
          
          setTimeout(function () {
            try {
              var subscriptions = socket.subscriptions();

              assert(unsubscribeEmitted,
                'Socket did not emit unsubscribe event after calling socket.unsubscribe(channelName) method');
            } catch (e) {
              err = e;
            }
            cb(err);
          }, 2000);
        }, 1000);
      },
      function (cb) {
        var actionSequence = [];
      
        socket.on('subscribe', function (channel) {
          if (channel == 'channel1') {
            actionSequence.push('subscribe');
          }
        });
        
        socket.on('unsubscribe', function (channel) {
          if (channel == 'channel1') {
            actionSequence.push('unsubscribe');
          }
        });
      
        socket.subscribe('channel1');
        socket.unsubscribe('channel1');
        socket.subscribe('channel1');
        socket.unsubscribe('channel1');
        
        var expectedActionSequence = [];
        
        var err;
        
        setTimeout(function () {
          socket.off('subscribe');
          socket.off('unsubscribe');
          
          try {
            assert(JSON.stringify(actionSequence) == JSON.stringify(expectedActionSequence),
              'Subscribing and unsubscribing to channel1 multiple times in a sequence was not handled in an optimal way');
          } catch (e) {
            err = e;
          }
          cb(err);
        }, 1000);
      },
      function (cb) {
        var actionSequence = [];
      
        socket.subscribe('channel2');
      
        setTimeout(function () {
          socket.on('subscribe', function (channel) {
            if (channel == 'channel2') {
              actionSequence.push('subscribe');
            }
          });
          
          socket.on('unsubscribe', function (channel) {
            if (channel == 'channel2') {
              actionSequence.push('unsubscribe');
            }
          });
        
          socket.unsubscribe('channel2');
          socket.subscribe('channel2');
          socket.unsubscribe('channel2');
          socket.subscribe('channel2');
          socket.unsubscribe('channel2');
          socket.subscribe('channel2');
          
          var expectedActionSequence = [
            'unsubscribe',
            'subscribe'
          ];
          
          var err;
          
          setTimeout(function () {
            socket.off('subscribe');
            socket.off('unsubscribe');
            try {
              assert(JSON.stringify(actionSequence) == JSON.stringify(expectedActionSequence),
                'Subscribing and unsubscribing to channel2 multiple times in a sequence was not handled in an optimal way');
            } catch (e) {
              err = e;
            }
            cb(err);
          }, 1000);
        }, 1000);
      },
      function (cb) {
        var caughtError;
        var socketDomain = domain.createDomain();
        socketDomain.on('error', function (error) {
          caughtError = error;
        });
        socketDomain.add(socket);
        socket.emit('error', 'FAIL');
        
        var err;
        
        setTimeout(function () {
          try {
            assert(caughtError == 'FAIL',
              'Socket does not work with error domains');
          } catch (e) {
            err = e;
          }
          cb(err);
        }, 1000);
      },
      function (cb) {
        var err;
        
        socket.once('disconnect', function () {
          socket.once('connect', function (status) {
            try {
              assert(!status.isAuthenticated,
                'Socket should not be authenticated');
            } catch (e) {
              err = e;
            }
            cb(err);
          });
          socket.connect();
        });
        socket.disconnect();
      },
      function (cb) {
        var err;
        
        socket.once('connect', function (status) {
        
          var authTokenIsSet = false;
          socket.on('authenticate', function () {
            authTokenIsSet = true;
          });
        
          socket.emit('login', {username: 'john123'});
          
          setTimeout(function () {
          
            socket.once('connect', function (status) {
              try {
                assert(!!status.isAuthenticated,
                  'Socket should be authenticated');
                assert(authTokenIsSet,
                  'authenticate event was never emitted');
              } catch (e) {
                err = e;
              }
              cb(err);
            });
          
            socket.disconnect();
            socket.connect();
            
          }, 1000);
        });
          
        socket.disconnect();
        socket.connect();
      }
    ];
    
    var timedTasks = [];
    var timeoutMs = 20000;
    
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
      process.exit();
    });
  }
});