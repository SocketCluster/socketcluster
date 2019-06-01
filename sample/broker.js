var SCBroker = require('socketcluster/scbroker');
var scClusterBrokerClient = require('scc-broker-client');

class Broker extends SCBroker {
  run() {
    console.log('   >> Broker PID:', process.pid);

    /*
      If either `SCC_STATE_SERVER_HOST='123.45.67.89' node server.js` environment variable is set,
      or `node server.js --cssh '123.45.67.89'` argument is provided,
      the broker will try to attach itself to the SC Cluster for automatic horizontal scalability.
      This is mostly intended for the Kubernetes deployment of SocketCluster - In this case,
      The clustering/sharding all happens automatically.
    */
    if (this.options.clusterStateServerHost) {
      scClusterBrokerClient.attach(this, {
        stateServerHost: this.options.clusterStateServerHost,
        stateServerPort: this.options.clusterStateServerPort,
        mappingEngine: this.options.clusterMappingEngine,
        clientPoolSize: this.options.clusterClientPoolSize,
        authKey: this.options.clusterAuthKey,
        stateServerConnectTimeout: this.options.clusterStateServerConnectTimeout,
        stateServerAckTimeout: this.options.clusterStateServerAckTimeout,
        stateServerReconnectRandomness: this.options.clusterStateServerReconnectRandomness
      });
    }
  }
}

new Broker();
