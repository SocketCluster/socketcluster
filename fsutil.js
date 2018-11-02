var fs = require('fs');
var scErrors = require('sc-errors');
var TimeoutError = scErrors.TimeoutError;

var fileExists = function (filePath, callback) {
  fs.access(filePath, fs.constants.F_OK, (err) => {
    callback(!err);
  });
};

var waitForFile = function (filePath, checkInterval, startTime, maxWaitDuration, timeoutErrorMessage) {
  return new Promise((resolve, reject) => {
    if (!filePath) {
      resolve();
      return;
    }
    var checkIsReady = () => {
      var now = Date.now();

      fileExists(filePath, (exists) => {
        if (exists) {
          resolve();
        } else {
          if (now - startTime >= maxWaitDuration) {
            var errorMessage;

            if (timeoutErrorMessage != null) {
              errorMessage = timeoutErrorMessage;
            } else {
              errorMessage = `Could not find a file at path ${filePath} ` +
              `before the timeout was reached`;
            }
            var volumeBootTimeoutError = new TimeoutError(errorMessage);
            reject(volumeBootTimeoutError);
          } else {
            setTimeout(checkIsReady, checkInterval);
          }
        }
      });
    };
    checkIsReady();
  });
};

module.exports = {
  fileExists: fileExists,
  waitForFile: waitForFile
};
