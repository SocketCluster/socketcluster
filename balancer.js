var cluster = require('cluster');
var SCBalancer = require('./scbalancer');

var balancer;
var processTermTimeout = 10000;

if (cluster.isMaster) {
  var balancers;
  var alive = true;
  var terminatedCount = 0;
  
  process.on('message', function (m) {
    if (m.type == 'init') {
      cluster.schedulingPolicy = m.data.schedulingPolicy || cluster.SCHED_NONE;
      
      if (m.data.processTermTimeout) {
        processTermTimeout = m.data.processTermTimeout;
      }
      
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
          if (alive) {
            launchBalancer(i);
          } else if (++terminatedCount >= balancers.length) {
            process.exit();
          }
        })
        balancer.send(m);
      };

      for (var i = 0; i < balancerCount; i++) {
        launchBalancer(i);
      }
    } else {
      for (var i in balancers) {
        balancers[i].send(m);
      }
    }
  });
  
  process.on('SIGTERM', function () {
    alive = false;
    for (var i in balancers) {
      balancers[i].kill('SIGTERM');
    }
    setTimeout(function () {
      process.exit();
    }, processTermTimeout);
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
    if (err.code != 'ECONNRESET' && !notice) {
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
      if (m.data.processTermTimeout) {
        processTermTimeout = m.data.processTermTimeout;
      }
      
      if (m.data && m.data.protocolOptions && m.data.protocolOptions.pfx) {
        m.data.protocolOptions.pfx = new Buffer(m.data.protocolOptions.pfx, 'base64');
      }
      balancer = new SCBalancer(m.data);
      balancer.on('error', handleError);
      balancer.on('notice', handleNotice);
      balancer.start();
      handleReady();
    } else if (m.type == 'setWorkers') {
      balancer.setWorkers(m.data);
    }
  });
  
  process.on('SIGTERM', function () {
    if (balancer) {
      balancer.close(function () {
        process.exit();
      });
      setTimeout(function () {
        process.exit();
      }, processTermTimeout);
    } else {
      process.exit();
    }
  });
}
