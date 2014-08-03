var os = require('os');

module.exports.getTestSocketPath = function () {
  if (process.platform == 'win32') {
    return '\\\\.\\pipe\\socketclustertest';
  }
  return os.tmpdir() + '/socketclustertest';
};