#!/usr/bin/env node

const { REPLClient } = require('@maartennnn/cli-builder');
const actions = require('./actions');

let helpFooter =
  'Note that the app-name/app-path in the commands above is optional (except for create) - If not provided, ' +
  'socketcluster will use the current working directory as the app path.';

const cli = new REPLClient({
  binCommand: 'socketcluster',
  enableInteractive: false,
  helpFooter,
  actions,
});

if (cli.argv.v || cli.argv.version) {
  cli.successLog(`Version: ${require('../package.json').version}`);
  process.exit(0)
}

// CLI ACTIONS CAN BE FOUND IN BIN/ACTIONS/. THESE ARE MOUNTED VIA THE REPLCIENT
const commands = {
  execute: () => cli.errorLog('Input not recognized try socketcluster -h'),
  create: {
    execute: async ({ argument, options }) => await cli.actions.create(argument, options),
    help: 'Create a new boilerplate app in your working directory',
    input: '<app-name>',
  },
  run: {
    execute: async ({ argument, options }) => await cli.actions.dockerRun(argument, options),
    help: '[requires docker] Run the app at path inside a container on your local machine',
    input: '<path>',
  },
  restart: {
    execute: async ({ argument, options }) => await cli.actions.dockerRestart(argument, options),
    help: '[requires docker] Restart the app at path',
    input: '<app-path-or-name>',
  },
  stop: {
    execute: async ({ argument, options }) => await cli.actions.dockerStop(argument, options),
    help: '[requires docker] Stop the app',
    input: '<app-path-or-name>',
  },
  list: {
    execute: async () => await cli.actions.dockerList(),
    help: '[requires docker] List all running Docker containers on your local machine',
  },
  logs: {
    execute: async ({ argument, options }) =>
      await cli.actions.dockerLogs(argument, options),
    help: '[requires docker] Get logs for the specified app',
    input: '<app-path-or-name>',
    options: [{ option: 'f', help: 'Follow the logs' }],
  },
  deploy: {
    execute: async ({ argument, options }) =>
      await cli.actions.k8sDeployAndDeployUpdate(argument, options),
    help: '[requires kubectl] Deploy the app at path to your Kubernetes cluster',
    input: '<app-path>',
  },
  deployUpdate: {
    execute: async ({ argument, options }) =>
      await cli.actions.k8sDeployAndDeployUpdate(argument, options, true),
    help: '[requires kubectl] Deploy update to an app which was previously deployed',
    input: '<app-path>',
  },
  undeploy: {
    execute: async ({ argument, options }) => await cli.actions.k8sUndeploy(argument, options, true),
    help: '[requires kubectl] Shutdown all core app services running on your cluster',
    input: '<app-path>',
  },
  addSecret: {
    execute: async ({ argument, options }) => await cli.actions.k8sAddSecret(argument, options),
    help: '[requires kubectl] Upload a TLS key and cert pair to your cluster',
    options: [
      { option: 's', help: 'Optional secret name' },
      { option: 'k', help: 'Path to a key file' },
      { option: 'c', help: 'Path to a certificate file' },
    ],
  },
  removeSecret: {
    execute: async ({ argument, options }) => await cli.actions.k8sRemoveSecret(argument, options),
    help: '[requires kubectl] Remove a TLS key and cert pair from your cluster',
    options: [{ option: 's', help: 'Optional secret name' }],
  },
  v: async () => cli.successLog(`Version: ${require('../package.json').version}`),
};

cli.run(commands);
