var SCWorker = require('./scworker');
var worker;
var processTermTimeout = 10000;

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
  process.send({type: 'error', data: error});
};

var handleNotice = function (notice) {
  if (notice instanceof Error) {
    notice = notice.message;
  }
  process.send({type: 'notice', data: notice});
};

var handleReady = function () {
  process.send({type: 'ready'});
};

var handleExit = function () {
  process.exit();
};

process.on('message', function (m) {
  if (m.type == 'init') {
    worker = new SCWorker(m.data);
    
    if (m.data.processTermTimeout) {
      processTermTimeout = m.data.processTermTimeout;
    }
    
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
