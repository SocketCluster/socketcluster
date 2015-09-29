var cluster = require('cluster');
var SCWorker = require('./scworker');
var processTermTimeout = 10000;

if (cluster.isMaster) {
  var workers;
  var alive = true;
  var hasExited = false;
  var terminatedCount = 0;

  var sendErrorToMaster = function (err) {
    process.send({
      type: 'error',
      data: {
        pid: process.pid,
        error: {
          message: err.message,
          stack: err.stack
        }
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
        targetWorker.send(m);
      } else {
        var notFoundError = new Error('Worker with id ' + m.workerId + ' does not exist');
        sendErrorToMaster(notFoundError);
      }
    } else {
      if (m.type == 'terminate') {
        terminate();
      }
      for (var i in workers) {
        if (workers.hasOwnProperty(i)) {
          workers[i].send(m);
        }
      }
    }
  });

} else {

  var handleError = function (err) {
    var error;
    if (typeof err == 'string') {
        error = err;
    } else {
      error = {
        message: err.message,
        stack: err.stack
      }
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
    if (typeof notice != 'string') {
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

  var worker;

  process.on('message', function (m) {
    if (m.type == 'init') {
      if (m.data.processTermTimeout) {
        processTermTimeout = m.data.processTermTimeout;
      }

      if (m.data && m.data.protocolOptions && m.data.protocolOptions.pfx) {
        m.data.protocolOptions.pfx = new Buffer(m.data.protocolOptions.pfx, 'base64');
      }

      global.worker = worker = new SCWorker(m.data);

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
    } else if (m.type == 'masterMessage') {
      worker.handleMasterMessage(m);
    } else if (m.type == 'terminate') {
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
    }
  });
}
