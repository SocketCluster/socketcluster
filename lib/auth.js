var jwt = require('jsonwebtoken');


var AuthEngine = function () {};

AuthEngine.prototype.verifyToken = function (encryptedToken, key, callback) {
  if (typeof encryptedToken == 'string' || encryptedToken == null) {
    jwt.verify(encryptedToken || '', key, callback);
  } else {
    var err = new Error('Invalid token format - Token must be a string');
    err.name = "TokenFormatError";
    callback(err);
  }
};

AuthEngine.prototype.signToken = function (token, key, options, callback) {
  var signedToken = jwt.sign(token, key, options);
  callback(null, signedToken);
};

module.exports.AuthEngine = AuthEngine;
