module.exports.parse = function (buffer) {
  if (buffer == null) {
    return null;
  }
  var message = buffer.toString();
  try {
    return JSON.parse(message);
  } catch (err) {}
  return message;
};

var isOwnDescendant = function (object, ancestors) {
  for (var i in ancestors) {
    if (ancestors[i] === object) {
      return true;
    }
  }
  return false;
};

var convertBuffersToBase64 = function (object, ancestors) {
  if (!ancestors) {
    ancestors = [];
  }
  if (isOwnDescendant(object, ancestors)) {
    throw new Error('Cannot traverse circular structure');
  }
  var newAncestors = ancestors.concat([object]);

  if (object instanceof Buffer) {
    return {
      base64: true,
      data: object.toString('base64')
    };
  }
  if (object instanceof Array) {
    var base64Array = [];
    for (var i in object) {
      base64Array[i] = convertBuffersToBase64(object[i], newAncestors);
    }
    return base64Array;
  }
  if (object instanceof Object) {
    var base64Object = {};
    for (var j in object) {
      base64Object[j] = convertBuffersToBase64(object[j], newAncestors);
    }
    return base64Object;
  }
  return object;
};

module.exports.stringify = function (object) {
  var base64Object = convertBuffersToBase64(object);
  return JSON.stringify(base64Object);
};
