const cluster = require('cluster');
const scErrors = require('sc-errors');
const InvalidActionError = scErrors.InvalidActionError;
const ProcessExitError = scErrors.ProcessExitError;

const workerInitOptions = JSON.parse(process.env.workerInitOptions);
let processTermTimeout = 10000;
let forceKillTimeout = 15000;
let forceKillSignal = 'SIGHUP';

process.on('disconnect', () => {
  process.exit();
});

let scWorkerCluster;
let workers;
let hasExited = false;
let terminatedCount = 0;
let childExitLookup = {};
let isTerminating = false;
let isForceKillingWorkers = false;

let sendErrorToMaster = function (err) {
  let error = scErrors.dehydrateError(err, true);
  process.send({
    type: 'error',
    data: {
      pid: process.pid,
      error: error
    }
  });
};

let terminateNow = function () {
  if (!hasExited) {
    hasExited = true;
    process.exit();
  }
};

let terminate = function (immediate) {
  if (immediate) {
    terminateNow();
    return;
  }
  if (isTerminating) {
    return;
  }
  isTerminating = true;
  setTimeout(() => {
    terminateNow();
  }, processTermTimeout);
};

let killUnresponsiveWorkersNow = function () {
  (workers || []).forEach((worker, i) => {
    if (!childExitLookup[i]) {
      process.kill(worker.process.pid, forceKillSignal);
      let errorMessage = 'No exit signal was received by worker with id ' + i +
      ' (PID: ' + worker.process.pid + ') before forceKillTimeout of ' + forceKillTimeout +
      ' ms was reached - As a result, kill signal ' + forceKillSignal + ' was sent to worker';

      let processExitError = new ProcessExitError(errorMessage);
      sendErrorToMaster(processExitError);
    }
  });
  isForceKillingWorkers = false;
};

let killUnresponsiveWorkers = function () {
  childExitLookup = {};
  if (isForceKillingWorkers) {
    return;
  }
  isForceKillingWorkers = true;
  setTimeout(() => {
    killUnresponsiveWorkersNow();
  }, forceKillTimeout);
};

process.on('message', (masterPacket) => {
  if (
    masterPacket.type === 'masterMessage' ||
    masterPacket.type === 'masterRequest' ||
    masterPacket.type === 'masterResponse'
  ) {
    let targetWorker = workers[masterPacket.workerId];
    if (targetWorker) {
      targetWorker.send(masterPacket);
      if (masterPacket.type === 'masterMessage') {
        process.send({
          type: 'workerClusterResponse',
          error: null,
          workerId: masterPacket.workerId,
          rid: masterPacket.cid
        });
      }
    } else {
      if (masterPacket.type === 'masterMessage') {
        let errorMessage = 'Cannot send message to worker with id ' + masterPacket.workerId +
        ' because the worker does not exist';
        let notFoundError = new InvalidActionError(errorMessage);
        sendErrorToMaster(notFoundError);

        process.send({
          type: 'workerClusterResponse',
          error: scErrors.dehydrateError(notFoundError, true),
          workerId: masterPacket.workerId,
          rid: masterPacket.cid
        });
      } else if (masterPacket.type === 'masterRequest') {
        let errorMessage = 'Cannot send request to worker with id ' + masterPacket.workerId +
        ' because the worker does not exist';
        let notFoundError = new InvalidActionError(errorMessage);
        sendErrorToMaster(notFoundError);

        process.send({
          type: 'workerClusterResponse',
          error: scErrors.dehydrateError(notFoundError, true),
          workerId: masterPacket.workerId,
          rid: masterPacket.cid
        });
      } else {
        let errorMessage = 'Cannot send response to worker with id ' + masterPacket.workerId +
        ' because the worker does not exist';

        let notFoundError = new InvalidActionError(errorMessage);
        sendErrorToMaster(notFoundError);
      }
    }
  } else {
    if (masterPacket.type === 'terminate') {
      if (masterPacket.data.killClusterMaster) {
        terminate(masterPacket.data.immediate);
      } else {
        killUnresponsiveWorkers();
      }
    }
    (workers || []).forEach((worker) => {
      worker.send(masterPacket);
    });
  }
});

process.on('uncaughtException', (err) => {
  sendErrorToMaster(err);
  process.exit(1);
});


function SCWorkerCluster(options) {
  if (scWorkerCluster) {
    // SCWorkerCluster is a singleton; it can only be instantiated once per process.
    throw new InvalidActionError('Attempted to instantiate a worker cluster which has already been instantiated');
  }
  options = options || {};
  scWorkerCluster = this;

  if (options.run != null) {
    this.run = options.run;
  }

  this._init(workerInitOptions);
}

SCWorkerCluster.create = function (options) {
  return new SCWorkerCluster(options);
};

SCWorkerCluster.prototype._init = function (options) {
  if (options.schedulingPolicy != null) {
    cluster.schedulingPolicy = options.schedulingPolicy;
  }
  if (options.processTermTimeout != null) {
    processTermTimeout = options.processTermTimeout;
  }
  if (options.forceKillTimeout != null) {
    forceKillTimeout = options.forceKillTimeout;
  }
  if (options.forceKillSignal != null) {
    forceKillSignal = options.forceKillSignal;
  }

  cluster.setupMaster({
    exec: options.paths.appWorkerControllerPath
  });

  let workerCount = options.workerCount;
  let readyCount = 0;
  let isReady = false;
  workers = [];
  this.workers = workers;

  let launchWorker = (i, respawn) => {
    let initOptions = options;
    initOptions.id = i;

    let worker = cluster.fork({
      workerInitOptions: JSON.stringify(initOptions)
    });
    workers[i] = worker;

    worker.on('error', sendErrorToMaster);

    worker.on('message', (workerPacket) => {
      if (workerPacket.type === 'ready') {
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
        process.send(workerPacket);
      }
    });

    worker.on('exit', (code, signal) => {
      childExitLookup[i] = true;
      if (!isTerminating) {
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

  for (let i = 0; i < workerCount; i++) {
    launchWorker(i);
  }

  this.run();
};

SCWorkerCluster.prototype.run = function () {};

module.exports = SCWorkerCluster;
