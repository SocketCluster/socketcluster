var jwt = require('jsonwebtoken');

var AuthEngine = function (options) {};

AuthEngine.prototype.verifyToken = function (encryptedToken, key, callback) {
  var self = this;
  if (encryptedToken) {
    jwt.verify(encryptedToken, key, callback);
  } else {
    callback(null);
  }
};

AuthEngine.prototype.signToken = function (token, key, options, callback) {
  var signedToken = jwt.sign(token, key, options);
  callback(null, signedToken);
};

module.exports.AuthEngine = AuthEngine;
