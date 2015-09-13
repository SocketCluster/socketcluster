var Response = function (socket, id) {
  this.socket = socket;
  this.id = id;
  this.sent = false;
};

Response.prototype._respond = function (responseData) {
  if (this.sent) {
    throw new Error('Response ' + this.id + ' has already been sent');
  } else {
    this.sent = true;
    this.socket.sendObject(responseData);
  }
};

Response.prototype.end = function (data) {
  if (this.id) {
    var responseData = {
      rid: this.id
    };
    if (data !== undefined) {
      responseData.data = data;
    }

    this._respond(responseData);
  }
};

Response.prototype.error = function (error, data) {
  if (this.id) {
    var err;
    if (error instanceof Error) {
      err = {name: error.name, message: error.message, stack: error.stack};
    } else {
      err = error;
    }

    var responseData = {
      rid: this.id,
      error: err
    };
    if (data !== undefined) {
      responseData.data = data;
    }

    this._respond(responseData);
  }
};

Response.prototype.callback = function (error, data) {
  if (error) {
    this.error(error, data);
  } else {
    this.end(data);
  }
};

module.exports.Response = Response;
