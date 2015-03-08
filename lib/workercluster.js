var cluster = require('cluster');
var SCWorker = require('./scworker');
var worker;
var processTermTimeout = 10000;

if (cluster.isMaster) {
  var workers;
  var alive = true;
  var terminatedCount = 0;
  
  process.on('message', function (m) {
    if (m.type == 'init') {
      cluster.schedulingPolicy = m.data.schedulingPolicy || cluster.SCHED_NONE;
      
      if (m.data.processTermTimeout) {
        processTermTimeout = m.data.processTermTimeout;
      }
      
      var workerCount = m.data.workerCount;
      var readyCount = 0;
      var isReady = false;
      workers = [];
      
      var launchWorker = function (i, respawn) {
        worker = cluster.fork();
        workers[i] = worker;
        worker.on('error', function (err) {
          process.send({
            type: 'error',
            data: {
              pid: worker.process.pid,
              message: err.message,
              stack: err.stack
            }
          });
        });

        worker.on('message', function (m) {
          if (m.type == 'ready') {
            process.send({
              type: 'workerStart',
              data: {
                id: i,
                pid: worker.process.pid,
                respawn: respawn || false
              }
            });
            
            if (!isReady && ++readyCount >= workerCount) {
              isReady = true;
              process.send(m);
            }
          } else {
            process.send(m);
          }
        });
        
        worker.on('exit', function (code, signal) {
          if (alive) {
            process.send({
              type: 'workerExit',
              data: {
                id: i,
                pid: worker.process.pid,
                code: code,
                signal: signal
              }
            });
            
            if (m.data.rebootWorkerOnCrash) {
              launchWorker(i, true);
            }
          } else if (++terminatedCount >= workers.length) {
            process.exit();
          }
        });
        
        var workerInitOptions = {};
        for (var j in m) {
          workerInitOptions[j] = m[j];
        }
        workerInitOptions.data.id = i;
        
        worker.send(workerInitOptions);
      };

      for (var i = 0; i < workerCount; i++) {
        launchWorker(i);
      }
    } else {
      for (var i in workers) {
        workers[i].send(m);
      }
    }
  });
  
  process.on('SIGTERM', function () {
    alive = false;
    for (var i in workers) {
      workers[i].kill('SIGTERM');
    }
    setTimeout(function () {
      process.exit();
    }, processTermTimeout);
  });
} else {

  var handleError = function (err) {
    var error;
    if (err.stack) {
      error = {
        message: err.message,
        stack: err.stack
      }
    } else {
      error = err;
    }
    process.send({
      type: 'error',
      data: {
        error: error,
        workerPid: process.pid
      }
    });
  };

  var handleNotice = function (notice) {
    if (notice instanceof Error) {
      notice = notice.message;
    }
    process.send({
      type: 'notice',
      data: {
        error: notice,
        workerPid: process.pid
      }
    });
  };

  var handleReady = function () {
    process.send({type: 'ready'});
  };

  var handleExit = function () {
    process.exit();
  };

  process.on('message', function (m) {
    if (m.type == 'init') {
      if (m.data.processTermTimeout) {
        processTermTimeout = m.data.processTermTimeout;
      }
      
      if (m.data && m.data.protocolOptions && m.data.protocolOptions.pfx) {
        m.data.protocolOptions.pfx = new Buffer(m.data.protocolOptions.pfx, 'base64');
      }
      
      worker = new SCWorker(m.data);

      if (m.data.propagateErrors) {
        worker.on('error', handleError);
        if (m.data.propagateNotices) {
          worker.on('notice', handleNotice);
        }
        worker.on('exit', handleExit);
      }

      worker.on('ready', function () {
        worker.start();
        handleReady();
      });
    } else if (m.type == 'emit') {
      if (m.data) {
        worker.handleMasterEvent(m.event, m.data);
      } else {
        worker.handleMasterEvent(m.event);
      }
    }
  });
  
  process.on('SIGTERM', function () {
    if (worker) {
      worker.close(function () {
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
