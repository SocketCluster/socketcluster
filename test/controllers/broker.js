const SCBroker = require('socketcluster/scbroker');

class Broker extends SCBroker {
  run() {
    console.log(`   >> Broker PID: ${process.pid}`);
  }
}

new Broker();
