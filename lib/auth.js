var jwt = require('jsonwebtoken');

var AuthEngine = function () {};

AuthEngine.prototype.verifyToken = function (encryptedToken, key, callback) {
  jwt.verify(encryptedToken || '', key, callback);
};

AuthEngine.prototype.signToken = function (token, key, options, callback) {
  var signedToken = jwt.sign(token, key, options);
  callback(null, signedToken);
};

module.exports.AuthEngine = AuthEngine;
