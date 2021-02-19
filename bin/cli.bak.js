#!/usr/bin/env node

const fs = require('fs-extra');
const path = require('path');
const argv = require('minimist')(process.argv.slice(2));
const childProcess = require('child_process');
const inquirer = require('inquirer');
const prompt = inquirer.createPromptModule();
const exec = childProcess.exec;
const execSync = childProcess.execSync;
const spawn = childProcess.spawn;
const fork = childProcess.fork;
const YAML = require('yamljs');

const scVersion = require('../package.json').version

const DEFAULT_TLS_SECRET_NAME = 'scc-tls-credentials';

let command = argv._[0];
let commandRawArgs = process.argv.slice(3);
let commandRawArgsString = commandRawArgs.join(' ');
if (commandRawArgsString.length) {
  commandRawArgsString = ' ' + commandRawArgsString;
}

let arg1 = argv._[1];
let force = argv.force ? true : false;

let dockerUsername, dockerPassword;
let saveDockerAuthDetails = null;

let tlsSecretName = null;
let tlsKeyPath = null;
let tlsCertPath = null;

let fileExistsSync = function (filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
  } catch (err) {
    return false;
  }
  return true;
};

let parseJSONFile = function (filePath) {
  try {
    if (fileExistsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, {encoding: 'utf8'}));
    }
  } catch (e) {}

  return {};
};

let parsePackageFile = function (moduleDir) {
  let packageFile = path.join(moduleDir, 'package.json');
  return parseJSONFile(packageFile);
};

let this.errorLog = function (message) {
  console.log(`\x1b[31m[Error]\x1b[0m ${message}`);
};

let this.successLog = function (message) {
  console.log(`\x1b[32m[Success]\x1b[0m ${message}`);
};

let warningMessage = function (message) {
  console.log(`\x1b[33m[Warning]\x1b[0m ${message}`);
};

let showCorrectUsage = function () {
  console.log('Usage: socketcluster [options] [command]\n');
  console.log('Options:');
  console.log("  -v            Get the version of the current SocketCluster installation");
  console.log('  --help        Get info on how to use this command');
  console.log('  --force       Force all necessary directory modifications without prompts');
  console.log();
  console.log('Commands:');
  console.log('  create <appname>            Create a new boilerplate app in your working directory');
  console.log('  run <path>                  [requires docker] Run the app at path inside a container on your local machine');
  console.log('  restart <app-path-or-name>  [requires docker] Restart the app at path');
  console.log('  stop <app-path-or-name>     [requires docker] Stop the app');
  console.log('  list                        [requires docker] List all running Docker containers on your local machine');
  console.log('  logs <app-path-or-name>     [requires docker] Get logs for the specified app');
  console.log('    -f                        Follow the logs');
  console.log('  deploy <app-path>           [requires kubectl] Deploy the app at path to your Kubernetes cluster');
  console.log('  deploy-update <app-path>    [requires kubectl] Deploy update to an app which was previously deployed');
  console.log('  undeploy <app-path>         [requires kubectl] Shutdown all core app services running on your cluster');
  console.log('  add-secret                  [requires kubectl] Upload a TLS key and cert pair to your cluster');
  console.log(`    -s                        Optional secret name; defaults to "${DEFAULT_TLS_SECRET_NAME}"`);
  console.log('    -k                        Path to a key file');
  console.log('    -c                        Path to a certificate file');
  console.log('  remove-secret               [requires kubectl] Remove a TLS key and cert pair from your cluster');
  console.log(`    -s                        Optional secret name; defaults to "${DEFAULT_TLS_SECRET_NAME}"`);
  console.log('');
  let extraMessage = 'Note that the app-name/app-path in the commands above is optional (except for create) - If not provided, ' +
    'socketcluster will use the current working directory as the app path.';
  console.log(extraMessage);
};

