var jwt = require('jsonwebtoken');
var crypto = require('crypto');

var AuthEngine = function (options) {
  this._cookieName = options.cookieName;
  this._defaultExpiryInMinutes = options.defaultExpiryInMinutes || 1440;
  
  // Generate a 512 bit _hashKey based on the provided secret key
  // This should make it computationally infeasible to find the key via brute force.
  var hasher = crypto.createHash('sha512');
  hasher.update(options.secretKey);
  this._hashKey = hasher.digest('base64');
};

AuthEngine.prototype._parseCookie = function (cookieString) {
  var cookies = {};
  if (typeof cookieString == 'string') {
    var cookieStrings = cookieString.split(';');
    for (var i = 0; i < cookieStrings.length; i++) {
      var cookie = cookieStrings[i];
      var parts = cookie.split('=');
      if (parts[0]) {
        var key = parts[0].trim();
        cookies[key] = decodeURIComponent((parts[1] || '').trim());
      }
    }
  }
  return cookies;
};

AuthEngine.prototype.parseToken = function (request, callback) {
  var headers = request.headers;
  if (headers) {
    var cookieData = this._parseCookie(headers.cookie);
    var encToken = cookieData[this._cookieName];

    if (encToken) {
      jwt.verify(encToken, this._hashKey, callback);
    } else {
      callback(null);
    }
  } else {
    callback(null);
  }
};

AuthEngine.prototype.signToken = function (token, options) {
  if (options.expiresInMinutes == null) {
    options.expiresInMinutes = this._defaultExpiryInMinutes;
  }
  var tokenData = {
    token: jwt.sign(token, this._hashKey, options),
    cookieName: this._cookieName
  };
  if (options.persistent) {
    tokenData.persistent = true;
    tokenData.expiresInMinutes = options.expiresInMinutes;
  }
  return tokenData;
};

module.exports.AuthEngine = AuthEngine;
