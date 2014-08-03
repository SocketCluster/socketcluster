module.exports.getTestSocketPath = function () {
  if (process.platform == 'win32') {
    return '\\\\.\\pipe\\socketclustertest\\';
  } else {
    return '/socketclustertest/';
  }
};