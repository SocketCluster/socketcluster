var cluster = require('cluster');
var SCWorker = require('./scworker');
var scErrors = require('sc-errors');
var InvalidActionError = scErrors.InvalidActionError;

var processTermTimeout = 10000;

if (cluster.isMaster) {
  process.on('disconnect', function () {
    process.exit();
  });

  var workers;
  var alive = true;
  var hasExited = false;
  var terminatedCount = 0;

  var sendErrorToMaster = function (err) {
    var error = scErrors.dehydrateError(err, true);
    process.send({
      type: 'error',
      data: {
        pid: process.pid,
        error: error
      }
    });
  };

  var terminate = function () {
    alive = false;
    setTimeout(function () {
      if (!hasExited) {
        hasExited = true;
        process.exit();
      }
    }, processTermTimeout);
  };

  process.on('message', function (m,r) {
    if (m.type == 'init') {
      if (m.data.schedulingPolicy != null) {
        cluster.schedulingPolicy = m.data.schedulingPolicy;
      }
      if (m.data.processTermTimeout) {
        processTermTimeout = m.data.processTermTimeout;
      }

      var workerCount = m.data.workerCount;
      var readyCount = 0;
      var isReady = false;
      workers = [];

      var launchWorker = function (i, respawn) {
        var worker = cluster.fork();
        workers[i] = worker;
        worker.on('error', sendErrorToMaster);

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
              process.send({
                type: 'ready'
              });
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
            if (!hasExited) {
              hasExited = true;
              process.exit();
            }
          }
        });

        var workerInitOptions = {};
        for (var j in m) {
          if (m.hasOwnProperty(j)) {
            workerInitOptions[j] = m[j];
          }
        }
        workerInitOptions.data.id = i;

        worker.send(workerInitOptions);
      };

      for (var i = 0; i < workerCount; i++) {
        launchWorker(i);
      }
    } else if (m.type == 'masterMessage') {
      var targetWorker = workers[m.workerId];
      if (targetWorker) {
        targetWorker.send(m,r);
      } else {
        var errorMessage = 'Cannot send message to worker with id ' + m.workerId +
          ' because the worker does not exist';
        var notFoundError = new InvalidActionError(errorMessage);
        sendErrorToMaster(notFoundError);
      }
    } else {
      if (m.type == 'terminate' && m.data.killClusterMaster) {
        terminate();
      }
      for (var i in workers) {
        if (workers.hasOwnProperty(i)) {
          workers[i].send(m,r);
        }
      }
    }
  });

} else {

  var handleError = function (isFatal, err) {
    var error = scErrors.dehydrateError(err, true);
    process.send({
      type: 'error',
      data: {
        error: error,
        workerPid: process.pid
      }
    }, null, function () {
      if (isFatal) {
        process.exit(1);
      }
    });
  };

  var handleWarning = function (warning) {
    var warning = scErrors.dehydrateError(warning, true);
    process.send({
      type: 'warning',
      data: {
        error: warning,
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

  var worker;

  process.on('message', function (m) {
    if (m.type == 'init') {
      if (m.data.processTermTimeout) {
        processTermTimeout = m.data.processTermTimeout;
      }

      if (m.data && m.data.protocolOptions && m.data.protocolOptions.pfx) {
        m.data.protocolOptions.pfx = new Buffer(m.data.protocolOptions.pfx, 'base64');
      }

      if (typeof m.data.authKey === 'object' && m.data.authKey !== null && m.data.authKey.type === 'Buffer') {
        m.data.authKey = new Buffer(m.data.authKey.data, 'base64');
      }

      global.worker = worker = new SCWorker(m.data);

      if (m.data.propagateErrors) {
        worker.on('error', handleError.bind(null, worker.options.crashWorkerOnError));
        if (m.data.propagateWarnings) {
          worker.on('warning', handleWarning);
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
    } else if (m.type == 'masterMessage') {
      worker.handleMasterMessage(m);
    } else if (m.type == 'terminate') {
      if (worker && !m.data.immediate) {
        worker.close(function () {
          process.exit();
        });
        setTimeout(function () {
          process.exit();
        }, processTermTimeout);
      } else {
        process.exit();
      }
    }
  });

  process.on('uncaughtException', function (err) {
    handleError(true, err);
  });
}
