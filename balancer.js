var cluster = require('cluster');
var SCBalancer = require('./scbalancer');

var balancer;

if (cluster.isMaster) {
  process.on('message', function (m) {
    var balancers;
    if (m.type == 'init') {
      var balancerCount = m.data.balancerCount;
      var readyCount = 0;
      var isReady = false;
      balancers = [];

      var launchBalancer = function (i) {
        balancer = cluster.fork();
        balancers[i] = balancer;
        balancer.on('error', function (err) {
          process.send({
            message: err.message,
            stack: err.stack
          });
        });

        balancer.on('message', function (m) {
          if (m.type == 'ready') {
            if (!isReady && ++readyCount >= balancerCount) {
              isReady = true;
              process.send(m);
            }
          } else {
            process.send(m);
          }
        });
        
        balancer.on('exit', function () {
          launchBalancer(i);
        })
        balancer.send(m);
      };

      for (var i=0; i<balancerCount; i++) {
        launchBalancer(i);
      }
    } else {
      for (var i in balancers) {
        balancers[i].send(m);
      }
    }
  });
} else {
  var handleError = function (err, notice) {
    var error;
    if (err.stack) {
      error = {
        message: err.message,
        stack: err.stack
      };
    } else {
      error = err;
    }
    process.send({type: notice ? 'notice' : 'error', data: error});
    if (err.code != 'ECONNRESET') {
      process.exit();
    }
  };

  var handleNotice = function (err) {
    handleError(err, true);
  };

  var handleReady = function () {
    process.send({type: 'ready'});
  };

  process.on('message', function (m) {
    if (m.type == 'init') {
      balancer = new SCBalancer(m.data);
      balancer.on('error', handleError);
      balancer.on('notice', handleNotice);
      balancer.start();
      handleReady();
    } else if (m.type == 'setWorkers') {
      balancer.setWorkers(m.data);
    }
  });
}
