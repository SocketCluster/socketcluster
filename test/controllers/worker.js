const SCWorker = require('socketcluster/scworker');

class Worker extends SCWorker {
  run() {
    console.log(`   >> Worker PID: ${process.pid}`);

    let httpServer = this.httpServer;
    let scServer = this.scServer;

    // (async () => {
    //   for await (let {socket} of scServer.listener('connection')) {
    //
    //   }
    // })();
  }
}

new Worker();
