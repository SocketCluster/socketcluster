var scHotReboot = require('sc-hot-reboot');

module.exports.run = function (socketCluster) {
  socketCluster.on(socketCluster.EVENT_WORKER_CLUSTER_START, function (workerClusterInfo) {
    console.log('   >> WorkerCluster PID:', workerClusterInfo.pid);
  });

  if (socketCluster.options.environment == 'dev') {
    // This will cause SC workers to reboot when code changes anywhere in the app directory.
    // The second options argument here is passed directly to chokidar.
    // See https://github.com/paulmillr/chokidar#api for details.
    console.log(`   !! The sc-hot-reboot plugin is watching for code changes in the ${__dirname} directory`);
    scHotReboot.attach(socketCluster, {
      cwd: __dirname,
      ignored: ['public', 'node_modules', 'README.md', 'Dockerfile', 'server.js', 'master.js', 'broker.js', /[\/\\]\./, '*.log']
    });
  }
};
