const assert = require('assert');
const SocketCluster = require('socketcluster');
const socketClusterClient = require('socketcluster-client');
const path = require('path');

const PORT = 8088;
// TODO 2: Remove uws from distribution.
// TODO 2: Handle uncaught promise rejection in SocketCluster master/worker...
const WS_ENGINE = 'ws';
const ENVIRONMENT = 'dev';
const CLIENT_COUNT = 10;

function wait(duration) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, duration);
  });
}

let socketCluster;
let clients;

describe('Integration tests', function () {
  describe('Single worker and broker', function () {
    before(async function () {
      let options = {
        workers: 1,
        brokers: 1,
        port: PORT,
        wsEngine: WS_ENGINE,
        workerController: path.join(__dirname, 'controllers', 'worker.js'),
        brokerController: path.join(__dirname, 'controllers', 'broker.js'),
        socketChannelLimit: 1000,
        crashWorkerOnError: true,
        killMasterOnSignal: false,
        processTermTimeout: 500,
        forceKillTimeout: 1000,
        environment: ENVIRONMENT
      };
      socketCluster = new SocketCluster(options);
      await socketCluster.listener(socketCluster.EVENT_READY).once();
    });

    after(async function () {
      await socketCluster.destroy();
    });

    beforeEach(async function () {
      clients = [];
      for (let i = 0; i < CLIENT_COUNT; i++) {
        clients.push(
          socketClusterClient.create({
            hostname: '127.0.0.1',
            port: PORT,
            autoReconnect: true,
            autoReconnectOptions: {
              initialDelay: 50,
              randomness: 0,
              multiplier: 1,
              maxDelay: 50
            }
          })
        );
      }

      await Promise.all(
        clients.map(async (client) => {
          await client.listener('connect').once();
        })
      );
    });

    afterEach(async function () {
      clients.forEach((client) => {
        client.disconnect();
      });
    });

    describe('Pub/sub', function () {
      it('Should publish data to and receive data from subscribed channel', async function () {
        let channel = clients[0].subscribe('foo');
        await channel.listener('subscribe').once();

        (async () => {
          await wait(10);
          clients[1].publish('foo', 'This is a test');
          await wait(10);
          clients[2].publish('foo', 'One');
          await wait(20);
          clients[5].publish('foo', 'Two');
        })();

        let data = await channel.once();
        assert.equal(data, 'This is a test');
        data = await channel.once();
        assert.equal(data, 'One');
        data = await channel.once();
        assert.equal(data, 'Two');
      });

      it('Should handle multiple subscribe and unsubscribe calls in quick succession', async function () {
        let channel = clients[0].channel('foo');

        (async () => {
          await wait(10);
          channel.subscribe();
          await channel.listener('subscribe').once();
          channel.unsubscribe();
          channel.subscribe();
          channel.unsubscribe();
          channel.subscribe();
          channel.unsubscribe();
          await wait(100);
          channel.closeAllListeners();
        })();

        let stateChanges = [];
        for await (let stateChangeData of channel.listener('subscribeStateChange')) {
          stateChanges.push(stateChangeData);
        }
        let expectedStateChanes = [
          {oldChannelState: 'pending', newChannelState: 'subscribed', subscriptionOptions: {}},
          {oldChannelState: 'subscribed', newChannelState: 'unsubscribed'}
        ];
        assert.equal(JSON.stringify(stateChanges), JSON.stringify(expectedStateChanes));
      });

      it('Should clear all subscriptions after all sockets have been disconnected', async function () {

      });
    });

    describe('During worker restart', function () {
      it('Pub/sub should work after worker restart', async function () {
        socketCluster.killWorkers();
        await socketCluster.listener(socketCluster.EVENT_WORKER_EXIT).once();
        let channel = clients[0].subscribe('foo');
        await channel.listener('subscribe').once();

        (async () => {
          await wait(10);
          clients[1].publish('foo', 'This is a test');
          await wait(10);
          clients[2].publish('foo', 'One');
          await wait(20);
          clients[5].publish('foo', 'Two');
          await wait(20);
          channel.close();
        })();

        let receivedList = [];
        for await (let data of channel) {
          receivedList.push(data);
        }

        assert.equal(receivedList[0], 'This is a test');
        assert.equal(receivedList[1], 'One');
        assert.equal(receivedList[2], 'Two');
      });
    });

    describe('During broker restart', function () {
      it('Pub/sub should work after broker restart', async function () {
        socketCluster.killBrokers();
        await socketCluster.listener(socketCluster.EVENT_BROKER_EXIT).once();
        let channel = clients[7].subscribe('foo');
        console.log('---- BEFORE', channel.state); // TODO 2
        await channel.listener('subscribe').once();
        console.log('---- AFTER');

        (async () => {
          await wait(10);
          clients[1].publish('foo', 'This is a test');
          await wait(10);
          clients[2].publish('foo', 'One');
          await wait(20);
          clients[5].publish('foo', 'Two');
          await wait(20);
          channel.close();
        })();

        let receivedList = [];
        for await (let data of channel) {
          receivedList.push(data);
        }

        assert.equal(receivedList[0], 'This is a test');
        assert.equal(receivedList[1], 'One');
        assert.equal(receivedList[2], 'Two');
      });
    });
  });

  describe('Multiple workers and brokers', function () {
    before(async function () {
      let options = {
        workers: 3,
        brokers: 3,
        port: PORT,
        wsEngine: WS_ENGINE,
        workerController: path.join(__dirname, 'controllers', 'worker.js'),
        brokerController: path.join(__dirname, 'controllers', 'broker.js'),
        socketChannelLimit: 1000,
        crashWorkerOnError: true,
        killMasterOnSignal: false,
        processTermTimeout: 500,
        forceKillTimeout: 1000,
        environment: ENVIRONMENT
      };
      socketCluster = new SocketCluster(options);
      await socketCluster.listener(socketCluster.EVENT_READY).once();
    });

    after(async function () {
      await socketCluster.destroy();
    });

    beforeEach(async function () {
      clients = [];
      for (let i = 0; i < CLIENT_COUNT; i++) {
        clients.push(
          socketClusterClient.create({
            hostname: '127.0.0.1',
            port: PORT
          })
        );
      }

      await Promise.all(
        clients.map(async (client) => {
          await client.listener('connect').once();
        })
      );
    });

    afterEach(async function () {
      clients.forEach((client) => {
        client.disconnect();
      });
    });

    describe('Pub/sub', function () {
      it('Should publish data to and receive data from subscribed channel', async function () {
        let channel = clients[0].subscribe('foo');
        await channel.listener('subscribe').once();

        (async () => {
          await wait(10);
          clients[1].publish('foo', 'This is a test');
          await wait(10);
          clients[2].publish('foo', 'One');
          await wait(20);
          clients[5].publish('foo', 'Two');
        })();

        let data = await channel.once();
        assert.equal(data, 'This is a test');
        data = await channel.once();
        assert.equal(data, 'One');
        data = await channel.once();
        assert.equal(data, 'Two');
      });
    });

    describe('IPC requests and messages', function () {
      it('Should support sending a message from the master process to a worker and back', async function () {
        socketCluster.sendMessageToWorker(1, {value: 1});
        let {workerId, data} = await socketCluster.listener('workerMessage').once();
        assert.equal(workerId, 1);
        assert.notEqual(data, null);
        assert.equal(data.value, 2);
      });

      it('Should support sending a message from the master process to a broker and back', async function () {
        socketCluster.sendMessageToBroker(0, {value: 10});
        let {brokerId, data} = await socketCluster.listener('brokerMessage').once();
        assert.equal(brokerId, 0);
        assert.notEqual(data, null);
        assert.equal(data.value, 11);
      });

      it('Should support sending a request from the master process to a worker and back', async function () {
        // Send good request.
        let result = await socketCluster.sendRequestToWorker(2, {value: 3});
        assert.notEqual(result, null);
        assert.equal(result.value, 30);

        // Send bad request.
        let error;
        result = null;
        try {
          result = await socketCluster.sendRequestToWorker(1, {fail: true});
        } catch (err) {
          error = err;
        }
        assert.notEqual(error, null);
        assert.equal(error.name, 'WorkerFailedToRespondError');

        // Ask worker to send us a good request.
        socketCluster.sendMessageToWorker(0, {sendGoodRequestToMaster: true});
        let req = await socketCluster.listener('workerRequest').once();
        req.end({value: req.data.value * 100});

        let {workerId, data} = await socketCluster.listener('workerMessage').once();
        assert.equal(workerId, 0);
        assert.notEqual(data, null);
        assert.equal(data.success, true);

        // Ask worker to send us a bad request.
        socketCluster.sendMessageToWorker(2, {sendBadRequestToMaster: true});
        req = await socketCluster.listener('workerRequest').once();
        let failedResponseError = new Error('Master failed to respond');
        failedResponseError.name = 'MasterFailedToRespondError';
        req.error(failedResponseError);

        let brokerResultMessage = await socketCluster.listener('workerMessage').once();
        assert.equal(brokerResultMessage.workerId, 2);
        assert.notEqual(brokerResultMessage.data, null);
        assert.equal(brokerResultMessage.data.success, true);
      });

      it('Should support sending a request from the master process to a broker and back', async function () {
        // Send good request.
        let result = await socketCluster.sendRequestToBroker(2, {value: 3});
        assert.notEqual(result, null);
        assert.equal(result.value, 30);

        // Send bad request.
        let error;
        result = null;
        try {
          result = await socketCluster.sendRequestToBroker(1, {fail: true});
        } catch (err) {
          error = err;
        }
        assert.notEqual(error, null);
        assert.equal(error.name, 'BrokerFailedToRespondError');

        // Ask broker to send us a good request.
        socketCluster.sendMessageToBroker(0, {sendGoodRequestToMaster: true});
        let req = await socketCluster.listener('brokerRequest').once();
        req.end({value: req.data.value * 100});

        let {brokerId, data} = await socketCluster.listener('brokerMessage').once();
        assert.equal(brokerId, 0);
        assert.notEqual(data, null);
        assert.equal(data.success, true);

        // Ask broker to send us a bad request.
        socketCluster.sendMessageToBroker(2, {sendBadRequestToMaster: true});
        req = await socketCluster.listener('brokerRequest').once();
        let failedResponseError = new Error('Master failed to respond');
        failedResponseError.name = 'MasterFailedToRespondError';
        req.error(failedResponseError);

        let brokerResultMessage = await socketCluster.listener('brokerMessage').once();
        assert.equal(brokerResultMessage.brokerId, 2);
        assert.notEqual(brokerResultMessage.data, null);
        assert.equal(brokerResultMessage.data.success, true);
      });
    });
  });
});
