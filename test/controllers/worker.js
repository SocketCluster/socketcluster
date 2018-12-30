const SCWorker = require('socketcluster/scworker');

class Worker extends SCWorker {
  run() {
    console.log(`   >> Worker PID: ${process.pid}`);

    let httpServer = this.httpServer;
    let scServer = this.scServer;

    (async () => {
      for await (let {data} of this.listener('masterMessage')) {
        if (data.sendGoodRequestToMaster) {
          let result = await this.sendRequestToMaster({value: 123});
          this.sendMessageToMaster({success: result.value === 12300});
        } else if (data.sendBadRequestToMaster) {
          let result;
          let error;
          try {
            result = await this.sendRequestToMaster({fail: true});
          } catch (err) {
            error = err;
          }
          // Send success if we got an error as expected.
          this.sendMessageToMaster({
            success: error && error.name === 'MasterFailedToRespondError'
          });
        } else {
          this.sendMessageToMaster({value: data.value + 1});
        }
      }
    })();

    (async () => {
      for await (let req of this.listener('masterRequest')) {
        if (req.data.fail) {
          let error = new Error('Worker could not process request');
          error.name = 'WorkerFailedToRespondError';
          req.error(error);
        } else {
          req.end({value: req.data.value * 10});
        }
      }
    })();
  }
}

new Worker();
