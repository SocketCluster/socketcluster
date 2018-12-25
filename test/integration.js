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

    after(async function () {
      clients.forEach((client) => {
        client.disconnect();
      });
      await socketCluster.destroy();
    });

    it('Should publish data to and receive data from subscribed channel', async function () {
      let channel = clients[0].subscribe('foo');
      await channel.listener('subscribe').once();

      (async () => {
        await wait(10);
        clients[1].publish('foo', 'This is a test');
      })();

      let data = await channel.once();
      assert.equal(data, 'This is a test');
    });

    it('Should handle multiple subscribe and unsubscribe calls in quick succession', async function () {

    });

    it('Should clear all subscriptions after all sockets have been disconnected', async function () {

    });

    describe('Worker restart', function () {
      it('Pub/sub should work after worker restart', async function () {

      });
    });

    describe('Broker restart', function () {
      it('Pub/sub should work after broker restart', async function () {

      });
    });
  });

  describe('Multiple workers and brokers', function () {

  });
});
