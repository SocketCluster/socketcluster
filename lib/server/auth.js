var jwt = require('jsonwebtoken');

var AuthEngine = function () {};

AuthEngine.prototype.verifyToken = function (encryptedToken, key, callback) {
  if (encryptedToken) {
    jwt.verify(encryptedToken, key, callback);
  } else {
    callback();
  }
};

AuthEngine.prototype.signToken = function (token, key, options, callback) {
  var signedToken = jwt.sign(token, key, options);
  callback(null, signedToken);
};

module.exports.AuthEngine = AuthEngine;
