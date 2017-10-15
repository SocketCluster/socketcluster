var cluster = require('cluster');
var scErrors = require('sc-errors');
var InvalidActionError = scErrors.InvalidActionError;

var processTermTimeout = 10000;

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

process.on('message', function (masterMessage) {
  if (masterMessage.type == 'init') {
    if (masterMessage.data.schedulingPolicy != null) {
      cluster.schedulingPolicy = masterMessage.data.schedulingPolicy;
    }
    if (masterMessage.data.processTermTimeout) {
      processTermTimeout = masterMessage.data.processTermTimeout;
    }

    // Run an initController to initialize anything for the master process of all SCWorkers
    if (masterMessage.data.paths.appWorkerClusterControllerPath != null) {
      var initWorkerClusterController = require(masterMessage.data.paths.appWorkerClusterControllerPath);
      initWorkerClusterController.run(process); // TODO 2
    }

    cluster.setupMaster({
      exec: masterMessage.data.paths.appWorkerControllerPath,
    });

    var workerCount = masterMessage.data.workerCount;
    var readyCount = 0;
    var isReady = false;
    workers = [];

    var launchWorker = function (i, respawn) {
      var worker = cluster.fork();
      workers[i] = worker;

      worker.on('error', sendErrorToMaster);

      worker.on('message', function (workerMessage) {
        if (workerMessage.type == 'ready') {
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
        } else if (workerMessage.type == 'readyToInit') {
          var workerInitOptions = {};
          for (var j in masterMessage) {
            if (masterMessage.hasOwnProperty(j)) {
              workerInitOptions[j] = masterMessage[j];
            }
          }
          workerInitOptions.data.id = i;
          worker.send(workerInitOptions);
        } else {
          process.send(workerMessage);
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

          if (masterMessage.data.rebootWorkerOnCrash) {
            launchWorker(i, true);
          }
        } else if (++terminatedCount >= workers.length) {
          if (!hasExited) {
            hasExited = true;
            process.exit();
          }
        }
      });
    };

    for (var i = 0; i < workerCount; i++) {
      launchWorker(i);
    }
  } else if (masterMessage.type == 'masterMessage') {
    var targetWorker = workers[masterMessage.workerId];
    if (targetWorker) {
      targetWorker.send(masterMessage);
    } else {
      var errorMessage = 'Cannot send message to worker with id ' + masterMessage.workerId +
        ' because the worker does not exist';
      var notFoundError = new InvalidActionError(errorMessage);
      sendErrorToMaster(notFoundError);

      if (masterMessage.cid) {
        process.send({
          type: 'workerClusterResponse',
          error: scErrors.dehydrateError(notFoundError, true),
          data: null,
          workerId: masterMessage.workerId,
          rid: masterMessage.cid
        });
      }
    }
  } else {
    if (masterMessage.type == 'terminate' && masterMessage.data.killClusterMaster) {
      terminate();
    }
    for (var i in workers) {
      if (workers.hasOwnProperty(i)) {
        workers[i].send(masterMessage);
      }
    }
  }
});
