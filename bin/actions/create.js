const fs = require('fs-extra');
const { spawn } = require('child_process');
const YAML = require('yamljs');

const {
  destDir,
  fileExistsSync,
  appDir,
  getSCCWorkerDeploymentDefPath,
  sanitizeYAML,
  clientFileDestPath,
  clientFileSourcePath,
} = require('../lib');

const copyDirRecursive = (src, dest, opts) => {
  try {
    fs.copySync(src, dest);
    return true;
  } catch (e) {
    opts.errorLog(
      'Failed to create necessary files. Please check your permissions and try again.',
    );
  }
  return false;
};

const createSuccess = (destinationDir, opts) => {
  console.log(
    'Installing app dependencies using npm. This could take a while...',
  );

  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const options = {
    cwd: destinationDir,
    maxBuffer: Infinity,
  };

  const npmProcess = spawn(npmCommand, ['install'], options);

  npmProcess.stdout.on('data', (data) => {
    process.stdout.write(data);
  });

  npmProcess.stderr.on('data', (data) => {
    process.stderr.write(data);
  });

  npmProcess.on('close', (code) => {
    const clientFileDestination = clientFileDestPath(destinationDir);
    const clientFileSource = clientFileSourcePath(destinationDir);

    if (code) {
      opts.errorLog(
        `Failed to install npm dependencies. Exited with code ${code}.`,
      );
    } else {
      try {
        fs.writeFileSync(
          clientFileDestination,
          fs.readFileSync(clientFileSource),
        );
        opts.successLog(
          `SocketCluster app "${destinationDir}" was setup successfully.`,
        );
      } catch (err) {
        opts.errorLog(
          `Failed to copy file from "${clientFileSource}" to "${clientFileDestination}" - Try copying it manually.`,
          code,
        );
      }
    }
  });

  npmProcess.stdin.end();
};

const setupMessage = function () {
  console.log('Creating app structure...');
};

const confirmReplaceSetup = function (confirm, destinationDir, opts) {
  const rmdirRecursive = function (dirname) {
    try {
      fs.removeSync(dirname);
      return true;
    } catch (e) {
      opts.errorLog(
        `Failed to remove existing directory at ${dirPath}. This directory may be used by another program or you may not have the permission to remove it.`,
      );
    }
    return false;
  };

  if (confirm) {
    setupMessage();
    if (
      rmdirRecursive(destinationDir) &&
      copyDirRecursive(appDir, destinationDir, opts)
    ) {
      createSuccess(null, this);
    } else {
      this.errorLog();
    }
  } else {
    this.errorLog('SocketCluster "create" action was aborted.');
  }
};

const create = async function (app) {
  const destinationDir = destDir(app);

  let transformK8sConfigs = function () {
    return new Promise((resolve, reject) => {
      let kubernetesTargetDir = destinationDir + '/kubernetes';
      let kubeConfSCCWorker = getSCCWorkerDeploymentDefPath(
        kubernetesTargetDir,
      );
      try {
        let kubeConfContentSCCWorker = fs.readFileSync(kubeConfSCCWorker, {
          encoding: 'utf8',
        });
        let deploymentConfSCCWorker = YAML.parse(kubeConfContentSCCWorker);

        deploymentConfSCCWorker.spec.template.spec.volumes = [
          {
            name: 'app-src-volume',
            emptyDir: {},
          },
        ];

        let containers = deploymentConfSCCWorker.spec.template.spec.containers;
        let templateSpec = deploymentConfSCCWorker.spec.template.spec;

        if (!templateSpec.initContainers) {
          templateSpec.initContainers = [];
        }
        let initContainers = templateSpec.initContainers;
        let appSrcContainerIndex;
        containers.forEach((value, index) => {
          if (value && value.name == 'scc-worker') {
            appSrcContainerIndex = index;
            return;
          }
        });
        if (!containers[appSrcContainerIndex].volumeMounts) {
          containers[appSrcContainerIndex].volumeMounts = [];
        }
        containers[appSrcContainerIndex].volumeMounts.push({
          mountPath: '/usr/src/app',
          name: 'app-src-volume',
        });
        initContainers.push({
          name: 'app-src-container',
          image: '', // image name will be generated during deployment
          volumeMounts: [
            {
              mountPath: '/usr/dest',
              name: 'app-src-volume',
            },
          ],
          command: ['cp', '-a', '/usr/src/.', '/usr/dest/'],
        });
        let formattedYAMLString = sanitizeYAML(
          YAML.stringify(deploymentConfSCCWorker, Infinity, 2),
        );
        fs.writeFileSync(kubeConfSCCWorker, formattedYAMLString);
      } catch (err) {
        reject(err);
      }
      resolve();
    });
  };

  if (app) {
    if (fileExistsSync(destinationDir)) {
      if (this.argv.force) {
        confirmReplaceSetup(true, destinationDir, this);
      } else {
        let message = `There is already a directory at ${destinationDir}. Do you want to overwrite it?`;
        if (
          await this.promptConfirm(
            message,
            { default: true },
            confirmReplaceSetup,
          )
        ) {
          createSuccess(destinationDir, this);
        }
      }
    } else {
      setupMessage();
      if (copyDirRecursive(appDir, destinationDir, this)) {
        try {
          await transformK8sConfigs();
          createSuccess(destinationDir, this);
        } catch (err) {
          this.errorLog(
            `Failed to format Kubernetes configs. Failed to create SocketCluster app. ${err}`,
          );
        }
      } else {
        this.errorLog('Failed to create SocketCluster app.');
      }
    }
  } else {
    this.errorLog(
      'The "create" command requires a valid <appname> as argument.',
    );
    showCorrectUsage();
    process.exit();
  }
};

module.exports = { create };
