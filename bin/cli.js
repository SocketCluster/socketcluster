#!/usr/bin/env node

const { REPLClient } = require('@maartennnn/cli-builder')
const actions = require('./actions')

let helpFooter =
  'Note that the app-name/app-path in the commands above is optional (except for create) - If not provided, ' +
  'socketcluster will use the current working directory as the app path.'

const cli = new REPLClient({
  binCommand: 'socketcluster',
  enableInteractive: 'false',
  helpFooter,
  actions
})

const commands = {
  create: {
    execute: async (appName) => await cli.actions.create(appName),
    help: 'Create a new boilerplate app in your working directory',
    input: '<app-name>',
  },
  run: {
    execute: async (path) => await cli.actions.dockerRun(path),
    help:
      '[requires docker] Run the app at path inside a container on your local machine',
    input: '<path>',
  },
  restart: {
    execute: async (appName) => await cli.actions.dockerRestart(appName),
    help: '[requires docker] Restart the app at path',
    input: '<app-path-or-name>',
  },
  stop: {
    execute: async (path) => await cli.actions.dockerStop(path),
    help: '[requires docker] Stop the app',
    input: '<app-path-or-name>',
  },
  list: {
    execute: async () => await cli.actions.dockerList(),
    help:
      '[requires docker] List all running Docker containers on your local machine',
  },
  logs: {
    execute: async (appName) => await cli.actions.dockerLogs(appName),
    help: '[requires docker] Get logs for the specified app',
    input: '<app-path-or-name>',
    options: [{ option: 's', help: 'Follow the logs' }],
  },
  deploy: {
    execute: async (path) => await cli.actions.k8sDeployAndDeployUpdate(path),
    help:
      '[requires kubectl] Deploy the app at path to your Kubernetes cluster',
    input: '<app-path>',
  },
  deployUpdate: {
    execute: async (path) => await cli.actions.k8sDeployAndDeployUpdate(path, true),
    help:
      '[requires kubectl] Deploy update to an app which was previously deployed',
    input: '<app-path>',
  },
  undeploy: {
    execute: async (path) => await cli.actions.k8sUndeploy(path, true),
    help:
      '[requires kubectl] Shutdown all core app services running on your cluster',
    input: '<app-path>',
  },
  addSecret: {
    execute: () => {},
    help: '[requires kubectl] Upload a TLS key and cert pair to your cluster',
    options: [
      { option: 's', help: 'Optional secret name; defaults to' },
      { option: 'k', help: 'Path to a key file' },
      { option: 'c', help: 'Path to a certificate file' },
    ],
  },
  removeSecret: {
    execute: () => {},
    help: '[requires kubectl] Remove a TLS key and cert pair from your cluster',
    options: [{ option: 's', help: 'Optional secret name; defaults to ' }],
  },
}

cli.run(commands)
