/*
  This script waits for the master controller script to become available.
  With orchestrators like Kubernetes, the master controller file may be fed in through
  a volume container at runtime and so it is necessary to wait for it before launch.
*/

var fsUtil = require('socketcluster/fsutil');
var waitForFile = fsUtil.waitForFile;

var SOCKETCLUSTER_MASTER_DEFAULT_CONTROLLER = './server.js';
var masterControllerPath = process.env.SOCKETCLUSTER_MASTER_CONTROLLER || SOCKETCLUSTER_MASTER_DEFAULT_CONTROLLER;
var bootCheckInterval = Number(process.env.SOCKETCLUSTER_BOOT_CHECK_INTERVAL) || 200;
var bootTimeout = Number(process.env.SOCKETCLUSTER_CONTROLLER_BOOT_TIMEOUT) || 10000;
var bootStartTime = Date.now();

var errorMessage = `Failed to locate the master controller file at path ${masterControllerPath} ` +
`before SOCKETCLUSTER_CONTROLLER_BOOT_TIMEOUT`;

waitForFile(masterControllerPath, bootCheckInterval, bootStartTime, bootTimeout, errorMessage)
.catch((err) => {
  console.error('> Boot error: ' + err.message);
  process.exit(1);
});
