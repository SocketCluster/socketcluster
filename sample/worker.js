const SCWorker = require('socketcluster/scworker');
const express = require('express');
const serveStatic = require('serve-static');
const path = require('path');
const morgan = require('morgan');
const healthChecker = require('sc-framework-health-check');

class Worker extends SCWorker {
  run() {
    console.log('   >> Worker PID:', process.pid);
    let environment = this.options.environment;

    let app = express();

    let httpServer = this.httpServer;
    let scServer = this.scServer;

    if (environment === 'dev') {
      // Log every HTTP request. See https://github.com/expressjs/morgan for other
      // available formats.
      app.use(morgan('dev'));
    }
    app.use(serveStatic(path.resolve(__dirname, 'public')));

    // Add GET /health-check express route
    healthChecker.attach(this, app);

    httpServer.on('request', app);

    let count = 0;

    /*
      In here we handle our incoming realtime connections and listen for events.
    */
    (async () => {
      for await (let socket of scServer.listener('connection')) {

        // Some sample logic to show how to handle client events,
        // replace this with your own logic

        (async () => {
          for await (let data of socket.receiver('sampleClientEvent')) {
            count++;
            console.log('Handled sampleClientEvent', data);
            scServer.exchange.publish('sample', count);
          }
        })();

        let interval = setInterval(() => {
          socket.transmit('random', {
            number: Math.floor(Math.random() * 5)
          });
        }, 1000);

        (async () => {
          await socket.listener('disconnect').once();
          clearInterval(interval);
        })();
      }
    })();
  }
}

new Worker();
