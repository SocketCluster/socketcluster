const SCBroker = require('socketcluster/scbroker');

class Broker extends SCBroker {
  run() {
    console.log(`   >> Broker PID: ${process.pid}`);

    (async () => {
      for await (let {data} of this.listener('masterMessage')) {
        if (data.sendGoodRequestToMaster) {
          let result = await this.sendRequestToMaster({value: 456});
          this.sendMessageToMaster({success: result.value === 45600});
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
          let error = new Error('Broker could not process request');
          error.name = 'BrokerFailedToRespondError';
          req.error(error);
        } else {
          req.end({value: req.data.value * 10});
        }
      }
    })();
  }
}

new Broker();
