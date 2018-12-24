const fs = require('fs');
const scErrors = require('sc-errors');
const TimeoutError = scErrors.TimeoutError;

let fileExists = function (filePath, callback) {
  fs.access(filePath, fs.constants.F_OK, (err) => {
    callback(!err);
  });
};

let waitForFile = function (filePath, checkInterval, startTime, maxWaitDuration, timeoutErrorMessage) {
  return new Promise((resolve, reject) => {
    if (!filePath) {
      resolve();
      return;
    }
    let checkIsReady = () => {
      let now = Date.now();

      fileExists(filePath, (exists) => {
        if (exists) {
          resolve();
        } else {
          if (now - startTime >= maxWaitDuration) {
            let errorMessage;

            if (timeoutErrorMessage != null) {
              errorMessage = timeoutErrorMessage;
            } else {
              errorMessage = `Could not find a file at path ${filePath} ` +
              `before the timeout was reached`;
            }
            let volumeBootTimeoutError = new TimeoutError(errorMessage);
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
  fileExists,
  waitForFile
};
