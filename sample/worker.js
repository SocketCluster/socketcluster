var fs = require('fs');
var express = require('express');
var serveStatic = require('serve-static');
var path = require('path');

module.exports.run = function (worker) {
  console.log('   >> Worker PID:', process.pid);
  
  var app = require('express')();
  
  // Get a reference to our raw Node HTTP server
  var httpServer = worker.getHTTPServer();
  // Get a reference to our realtime SocketCluster server
  var scServer = worker.getSCServer();
  
  app.use(serveStatic(path.resolve(__dirname, 'public')));

  httpServer.on('req', app);

  var count = 0;

  /*
    In here we handle our incoming realtime connections and listen for events.
    From here onwards is just like Socket.io but with some additional features.
  */
  scServer.on('connection', function (socket) {
    socket.on('ping', function (data) {
      count++;
      console.log('PING', data);
      scServer.global.publish('pong', count);
    });
  });
};