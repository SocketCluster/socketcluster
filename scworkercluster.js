var cluster = require('cluster');
var scErrors = require('sc-errors');
var InvalidActionError = scErrors.InvalidActionError;

var workerInitOptions = JSON.parse(process.env.workerInitOptions);
var processTermTimeout = 10000;

process.on('disconnect', function () {
  process.exit();
});

var scWorkerCluster;
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
  if (masterMessage.type == 'masterMessage' || masterMessage.type == 'masterResponse') {
    var targetWorker = workers[masterMessage.workerId];
    if (targetWorker) {
      targetWorker.send(masterMessage);
    } else {
      if (masterMessage.type == 'masterMessage') {
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
      } else {
        var errorMessage = 'Cannot send response to worker with id ' + masterMessage.workerId +
        ' because the worker does not exist';

        var notFoundError = new InvalidActionError(errorMessage);
        sendErrorToMaster(notFoundError);
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

process.on('uncaughtException', function (err) {
  sendErrorToMaster(err);
  process.exit(1);
});

function SCWorkerCluster() {
  if (scWorkerCluster) {
    // SCWorkerCluster is a singleton; it can only be instantiated once per process.
    throw new InvalidActionError('Attempted to instantiate a worker cluster which has already been instantiated');
  }
  scWorkerCluster = this;

  this._init(workerInitOptions);
};

SCWorkerCluster.prototype._init = function (options) {
  if (options.schedulingPolicy != null) {
    cluster.schedulingPolicy = options.schedulingPolicy;
  }
  if (options.processTermTimeout) {
    processTermTimeout = options.processTermTimeout;
  }

  cluster.setupMaster({
    exec: options.paths.appWorkerControllerPath,
  });

  var workerCount = options.workerCount;
  var readyCount = 0;
  var isReady = false;
  workers = [];
  this.workers = workers;

  var launchWorker = function (i, respawn) {
    var workerInitOptions = options;
    workerInitOptions.id = i;

    var worker = cluster.fork({
      workerInitOptions: JSON.stringify(workerInitOptions)
    });
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

        if (options.rebootWorkerOnCrash) {
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

  this.run();
};

SCWorkerCluster.prototype.run = function () {};

module.exports = SCWorkerCluster;
