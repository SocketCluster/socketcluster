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

let errorMessage = function (message) {
  console.log(`\x1b[31m[Error]\x1b[0m ${message}`);
};

let successMessage = function (message) {
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

let failedToRemoveDirMessage = function (dirPath) {
  errorMessage(
    `Failed to remove existing directory at ${dirPath}. This directory may be used by another program or you may not have the permission to remove it.`
  );
};

let failedToCreateMessage = function () {
  errorMessage('Failed to create necessary files. Please check your permissions and try again.');
};


let promptInput = async function (message, secret) {
  try {
    const answers = await prompt([
      {
        type: secret ? 'password' : 'input',
        message: message,
        name: 'result',
        default: null
      }
    ]);
    return answers.result;
  } catch (err) {
    errorMessage(err.message);
    process.exit();
  }
};

let promptConfirm = async function (message, options) {
  try {
    let promptOptions = {
      type: 'confirm',
      message: message,
      name: 'result'
    };
    if (options && options.default) {
      promptOptions.default = options.default;
    }
    const answers = await prompt([
      promptOptions
    ]);
    return answers.result;
  } catch(err) {
    errorMessage(err.message);
    process.exit();
  }
};

let copyDirRecursive = function (src, dest) {
  try {
    fs.copySync(src, dest);
    return true;
  } catch (e) {
    failedToCreateMessage();
  }
  return false;
};

let rmdirRecursive = function (dirname) {
  try {
    fs.removeSync(dirname);
    return true;
  } catch (e) {
    failedToRemoveDirMessage(dirname);
  }
  return false;
};

let sanitizeYAML = function (yamlString) {
  return yamlString.replace(/emptyDir: ?(null)?\n/g, 'emptyDir: {}\n');
};

if (argv.help) {
  showCorrectUsage();
  process.exit();
};

if (argv.v) {
  let agDir = `${__dirname}/../`;
  let agPkg = parsePackageFile(agDir);
  console.log('v' + agPkg.version);
  process.exit();
};

let wd = process.cwd();

let appDir = `${__dirname}/../app`;
let destDir = path.normalize(`${wd}/${arg1}`);
let clientFileSourcePath = path.normalize(`${destDir}/node_modules/socketcluster-client/socketcluster-client.js`);
let clientFileDestPath = path.normalize(`${destDir}/public/socketcluster-client.js`);

let createFail = function (error) {
  if (error) {
    errorMessage(`Failed to create SocketCluster app. ${error}`);
  } else {
    errorMessage('Failed to create SocketCluster app.');
  }
  process.exit();
};

let createSuccess = function () {
  console.log('Installing app dependencies using npm. This could take a while...');

  let npmCommand = (process.platform === "win32" ? "npm.cmd" : "npm");
  let options = {
    cwd: destDir,
    maxBuffer: Infinity
  };

  let npmProcess = spawn(npmCommand, ['install'], options);

  npmProcess.stdout.on('data', (data) => {
    process.stdout.write(data);
  });

  npmProcess.stderr.on('data', (data) => {
    process.stderr.write(data);
  });

  npmProcess.on('close', (code) => {
    if (code) {
      errorMessage(`Failed to install npm dependencies. Exited with code ${code}.`);
    } else {
      try {
        fs.writeFileSync(clientFileDestPath, fs.readFileSync(clientFileSourcePath));
        successMessage(`SocketCluster app "${destDir}" was setup successfully.`);
      } catch (err) {
        warningMessage(
          `Failed to copy file from "${clientFileSourcePath}" to "${clientFileDestPath}" - Try copying it manually.`
        );
      }
    }
    process.exit(code);
  });

  npmProcess.stdin.end();
};

let setupMessage = function () {
  console.log('Creating app structure...');
};

let confirmReplaceSetup = function (confirm) {
  if (confirm) {
    setupMessage();
    if (rmdirRecursive(destDir) && copyDirRecursive(appDir, destDir)) {
      createSuccess();
    } else {
      createFail();
    }
  } else {
    errorMessage('SocketCluster "create" action was aborted.');
    process.exit();
  }
};

let getSCCWorkerDeploymentDefPath = function (kubernetesTargetDir) {
  return `${kubernetesTargetDir}/scc-worker-deployment.yaml`;
};

let getSCCBrokerDeploymentDefPath = function (kubernetesTargetDir) {
  return `${kubernetesTargetDir}/scc-broker-deployment.yaml`;
};

let uploadTLSSecret = function (secretName, privateKeyPath, certFilePath, errorLogger) {
  try {
    execSync(`kubectl create secret tls ${secretName} --key ${privateKeyPath} --cert ${certFilePath}`, {stdio: 'inherit'});
  } catch (err) {
    errorLogger(
      'Failed to upload TLS key and certificate pair to Kubernetes. ' +
      'You can try using the following command to upload them manually: ' +
      `kubectl create secret tls ${secretName} --key ${privateKeyPath} --cert ${certFilePath}`
    );
    return false;
  }
  return true;
};

let removeTLSSecret = function (secretName, errorLogger) {
  try {
    execSync(`kubectl delete secret ${secretName}`, {stdio: 'inherit'});
  } catch (err) {
    errorLogger(
      `Failed to remove TLS key and certificate pair "${secretName}" from Kubernetes. ` +
      'You can try using the following command to remove them manually: ' +
      `kubectl delete secret ${secretName}`
    );
    return false;
  }
  return true;
};

(async () => {
  if (command === 'create') {
    let transformK8sConfigs = function () {
      return new Promise((resolve, reject) => {
        let kubernetesTargetDir = destDir + '/kubernetes';
        let kubeConfSCCWorker = getSCCWorkerDeploymentDefPath(kubernetesTargetDir);
        try {
          let kubeConfContentSCCWorker = fs.readFileSync(kubeConfSCCWorker, {encoding: 'utf8'});
          let deploymentConfSCCWorker = YAML.parse(kubeConfContentSCCWorker);

          deploymentConfSCCWorker.spec.template.spec.volumes = [{
            name: 'app-src-volume',
            emptyDir: {}
          }];
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
            name: 'app-src-volume'
          });
          initContainers.push({
            name: 'app-src-container',
            image: '', // image name will be generated during deployment
            volumeMounts: [{
              mountPath: '/usr/dest',
              name: 'app-src-volume'
            }],
            command: ['cp', '-a', '/usr/src/.', '/usr/dest/']
          });
          let formattedYAMLString = sanitizeYAML(YAML.stringify(deploymentConfSCCWorker, Infinity, 2));
          fs.writeFileSync(kubeConfSCCWorker, formattedYAMLString);
        } catch (err) {
          reject(err);
        }
        resolve();
      });
    };

    if (arg1) {
      if (fileExistsSync(destDir)) {
        if (force) {
          confirmReplaceSetup(true);
        } else {
          let message = `There is already a directory at ${destDir}. Do you want to overwrite it?`;
          promptConfirm(message, {default: true}, confirmReplaceSetup);
        }
      } else {
        setupMessage();
        if (copyDirRecursive(appDir, destDir)) {
          try {
            await transformK8sConfigs();
            createSuccess();
          } catch (err) {
            createFail(`Failed to format Kubernetes configs. ${err}`);
          }
        } else {
          createFail();
        }
      }
    } else {
      errorMessage('The "create" command requires a valid <appname> as argument.');
      showCorrectUsage();
      process.exit();
    }
  } else if (command === 'run') {
    let appPath = arg1 || '.';
    let absoluteAppPath = path.resolve(appPath);
    let pkg = parsePackageFile(appPath);
    let appName = pkg.name;

    let portNumber = Number(argv.p) || 8000;
    let envVarList;
    if (argv.e === undefined) {
      envVarList = [];
    } else if (!Array.isArray(argv.e)) {
      envVarList = [argv.e];
    } else {
      envVarList = argv.e;
    }
    let envFlagList = envVarList.map((value) => {
      return `-e "${value}"`;
    });
    let envFlagString = envFlagList.join(' ');
    if (envFlagList.length > 0) {
      envFlagString += ' ';
    }

    try {
      execSync(`docker stop ${appName}`, {stdio: 'ignore'});
      execSync(`docker rm ${appName}`, {stdio: 'ignore'});
    } catch (e) {}

    let dockerCommand = `docker run -d -p ${portNumber}:8000 -v ${absoluteAppPath}:/usr/src/app/ ` +
      `${envFlagString}--name ${appName} socketcluster/socketcluster:v${scVersion} `;
    try {
      execSync(dockerCommand, {stdio: 'inherit'});
      successMessage(`App "${appName}" is running at http://localhost:${portNumber}`);
    } catch (e) {
      errorMessage(`Failed to start app "${appName}".`);
    }
    process.exit();
  } else if (command === 'restart') {
    let appName = arg1;
    if (!appName) {
      let appPath = '.';
      let pkg = parsePackageFile(appPath);
      appName = pkg.name;
    }
    try {
      execSync(`docker stop ${appName}`, {stdio: 'ignore'});
      successMessage(`App '${appName}' was stopped.`);
    } catch (e) {}
    try {
      execSync(`docker start ${appName}`);
      successMessage(`App '${appName}' is running.`);
    } catch (e) {
      errorMessage(`Failed to start app '${appName}'.`);
    }
    process.exit();
  } else if (command === 'stop') {
    let appName = arg1;
    if (!appName) {
      let appPath = '.';
      let pkg = parsePackageFile(appPath);
      appName = pkg.name;
    }
    try {
      execSync(`docker stop ${appName}`);
      execSync(`docker rm ${appName}`);
      successMessage(`App '${appName}' was stopped.`);
    } catch (e) {
      errorMessage(`Failed to stop app '${appName}'.`);
    }
    process.exit();
  } else if (command === 'list') {
    let command = exec(`docker ps${commandRawArgsString}`, (err) => {
      if (err) {
        errorMessage(`Failed to list active containers. ` + err);
      }
      process.exit();
    });
    command.stdout.pipe(process.stdout);
    command.stderr.pipe(process.stderr);
  } else if (command === 'logs') {
    let appName = arg1;
    if (!appName) {
      let appPath = '.';
      let pkg = parsePackageFile(appPath);
      appName = pkg.name;
    }
    let command = exec(`docker logs ${appName}${commandRawArgsString}`, (err) => {
      if (err) {
        errorMessage(`Failed to get logs for '${appName}' app. ` + err);
      }
      process.exit();
    });
    command.stdout.pipe(process.stdout);
    command.stderr.pipe(process.stderr);
  } else if (command === 'deploy' || command === 'deploy-update') {
    let dockerImageName, dockerDefaultImageName;
    let dockerDefaultImageVersionTag = 'v1.0.0';
    let nextVersionTag;

    let appPath = arg1 || '.';
    let pkg = parsePackageFile(appPath);
    let appName = pkg.name;

    let isUpdate = (command === 'deploy-update');

    let failedToDeploy = function (err) {
      errorMessage(`Failed to deploy the '${appName}' app. ${err.message}`);
      process.exit();
    };

    let socketClusterK8sConfigFilePath = appPath + '/socketcluster-k8s.json';
    let socketClusterK8sConfig = parseJSONFile(socketClusterK8sConfigFilePath);

    let addAuthDetailsToSocketClusterK8s = function (socketClusterK8sConfigJSON, username, password) {
      if (!socketClusterK8sConfigJSON.docker) {
        socketClusterK8sConfigJSON.docker = {};
      }
      socketClusterK8sConfigJSON.docker.auth = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
    };

    let saveSocketClusterK8sConfigFile = function (socketClusterK8sConfigJSON) {
      fs.writeFileSync(socketClusterK8sConfigFilePath, JSON.stringify(socketClusterK8sConfigJSON, null, 2));
    };

    let parseVersionTag = function (fullImageName) {
      let matches = fullImageName.match(/:[^:]*$/);
      if (!matches) {
        return '';
      }
      return matches[0] || '';
    };

    let setImageVersionTag = function (imageName, versionTag) {
      if (versionTag.indexOf(':') !== 0) {
        versionTag = ':' + versionTag;
      }
      return imageName.replace(/(\/[^\/:]*)(:[^:]*)?$/g, `$1${versionTag}`);
    };

    let promptDockerAuthDetails = async function () {
      let username, password

      // Check if username is specified
      if (dockerUsername == null) {
        username = await promptInput('Enter your Docker registry username:');
        dockerUsername = username.toLowerCase();
      }

      // Check if password is specified
      if (dockerPassword == null) {
        password = await promptInput('Enter your Docker registry password:', true);
        dockerPassword = password;
      }

      const confirmation = await promptConfirm(`Would you like to save your Docker registry username and password as Base64 to ${socketClusterK8sConfigFilePath}?`, {default: true});

      if(confirmation) {
        saveDockerAuthDetails = confirmation
      }

      return Promise.resolve({ username: dockerUsername, password: dockerPassword, saveDockerAuthDetails})

    };

    let performDeployment = function (dockerConfig, versionTag, username, password) {
      let dockerLoginCommand = `docker login -u "${username}" -p "${password}"`;

      let fullVersionTag;
      if (versionTag) {
        fullVersionTag = `:${versionTag}`;
      } else {
        fullVersionTag = parseVersionTag(dockerConfig.imageName);
      }
      dockerConfig.imageName = setImageVersionTag(dockerConfig.imageName, fullVersionTag);
      if (saveDockerAuthDetails) {
        addAuthDetailsToSocketClusterK8s(socketClusterK8sConfig, username, password);
      }
      try {
        saveSocketClusterK8sConfigFile(socketClusterK8sConfig);
        execSync(`docker build -t ${dockerConfig.imageName} .`, {stdio: 'inherit'});
        execSync(`${dockerLoginCommand}; docker push ${dockerConfig.imageName}`, {stdio: 'inherit'});

        if (tlsSecretName && tlsKeyPath && tlsCertPath) {
          uploadTLSSecret(tlsSecretName, tlsKeyPath, tlsCertPath, warningMessage);
        }

        let kubernetesDirPath = appPath + '/kubernetes';

        let kubeConfSCCWorker = getSCCWorkerDeploymentDefPath(kubernetesDirPath);
        let kubeConfContentSCCWorker = fs.readFileSync(kubeConfSCCWorker, {encoding: 'utf8'});

        let deploymentConfSCCWorker = YAML.parse(kubeConfContentSCCWorker);

        let initContainersSCCWorker = deploymentConfSCCWorker.spec.template.spec.initContainers;
        initContainersSCCWorker.forEach((value, index) => {
          if (value) {
            if (value.name === 'app-src-container') {
              initContainersSCCWorker[index].image = dockerConfig.imageName;
            }
          }
        });

        let formattedYAMLStringSCCWorker = sanitizeYAML(YAML.stringify(deploymentConfSCCWorker, Infinity, 2));
        fs.writeFileSync(kubeConfSCCWorker, formattedYAMLStringSCCWorker);

        let kubeConfSCCBroker = getSCCBrokerDeploymentDefPath(kubernetesDirPath);
        let kubeConfContentSCCBroker = fs.readFileSync(kubeConfSCCBroker, {encoding: 'utf8'});

        let deploymentConfSCCBroker = YAML.parse(kubeConfContentSCCBroker);

        let formattedYAMLStringSCCBroker = sanitizeYAML(YAML.stringify(deploymentConfSCCBroker, Infinity, 2));
        fs.writeFileSync(kubeConfSCCBroker, formattedYAMLStringSCCBroker);

        let ingressKubeFileName = 'scc-ingress.yaml';
        let sccWorkerDeploymentFileName = 'scc-worker-deployment.yaml';

        let deploySuccess = () => {
          successMessage(
            `The '${appName}' app was deployed successfully - You should be able to access it online ` +
            `once it has finished booting up. This can take a while depending on your platform.`
          );
          process.exit();
        };

        if (isUpdate) {
          try {
            execSync(`kubectl replace -f ${kubernetesDirPath}/${sccWorkerDeploymentFileName}`, {stdio: 'inherit'});
          } catch (err) {}

          deploySuccess();
        } else {
          let kubeFiles = fs.readdirSync(kubernetesDirPath);
          let serviceAndDeploymentKubeFiles = kubeFiles.filter((configFilePath) => {
            return configFilePath != ingressKubeFileName;
          });
          serviceAndDeploymentKubeFiles.forEach((configFilePath) => {
            let absolutePath = path.resolve(kubernetesDirPath, configFilePath);
            execSync(`kubectl create -f ${absolutePath}`, {stdio: 'inherit'});
          });

          // Wait a few seconds before deploying ingress (due to a bug in some environments).
          setTimeout(() => {
            try {
              execSync(`kubectl create -f ${kubernetesDirPath}/${ingressKubeFileName}`, {stdio: 'inherit'});
              deploySuccess();
            } catch (err) {
              failedToDeploy(err);
            }
          }, 7000);
        }
      } catch (err) {
        failedToDeploy(err);
      }
    };

    let incrementVersion = function (versionString) {
      return versionString.replace(/[^.]$/, (match) => {
        return parseInt(match) + 1;
      });
    };

    let pushToDockerImageRepo = async function () {
      let versionTagString = parseVersionTag(socketClusterK8sConfig.docker.imageName).replace(/^:/, '');
      if (versionTagString) {
        if (isUpdate) {
          nextVersionTag = incrementVersion(versionTagString);
        } else {
          nextVersionTag = versionTagString;
        }
      } else {
        nextVersionTag = dockerDefaultImageVersionTag;
      }

      const versionTag = await promptInput(`Enter the Docker version tag for this deployment (Default: ${nextVersionTag}):`);

      socketClusterK8sConfig.docker.imageName = setImageVersionTag(socketClusterK8sConfig.docker.imageName, nextVersionTag);
      let dockerConfig = socketClusterK8sConfig.docker;

      if (dockerConfig.auth) {
        let authParts = Buffer.from(dockerConfig.auth, 'base64').toString('utf8').split(':');
        dockerUsername = authParts[0];
        dockerPassword = authParts[1];
        performDeployment(dockerConfig, versionTag, dockerUsername, dockerPassword);
      } else {
        if (!dockerUsername || !dockerPassword) {
          const { username, password } = await promptDockerAuthDetails();
          performDeployment(dockerConfig, versionTag, username, password);
        } else {
          performDeployment(dockerConfig, versionTag, dockerUsername, dockerPassword);
        }
      }
    };

    // If configuration file exists
    if (socketClusterK8sConfig.docker && socketClusterK8sConfig.docker.imageRepo) {
      let versionTagString = parseVersionTag(socketClusterK8sConfig.docker.imageName).replace(/^:/, '');
      if (versionTagString) {
        if (isUpdate) {
          nextVersionTag = incrementVersion(versionTagString);
        } else {
          nextVersionTag = versionTagString;
        }
      } else {
        nextVersionTag = dockerDefaultImageVersionTag;
      }

      const versionTag = await promptInput(`Enter the Docker version tag for this deployment (Default: ${nextVersionTag}):`);

      socketClusterK8sConfig.docker.imageName = setImageVersionTag(socketClusterK8sConfig.docker.imageName, nextVersionTag);
      let dockerConfig = socketClusterK8sConfig.docker;

      if (dockerConfig.auth) {
        let authParts = Buffer.from(dockerConfig.auth, 'base64').toString('utf8').split(':');
        dockerUsername = authParts[0];
        dockerPassword = authParts[1];
        performDeployment(dockerConfig, versionTag, dockerUsername, dockerPassword);
      } else {
        const { username, password } = await promptDockerAuthDetails()

        performDeployment(dockerConfig, versionTag, username, password);
      }
    // If configuration file doesn't exist
    } else {
      let saveSocketClusterK8sConfigs = function () {
        socketClusterK8sConfig.docker = {
          imageRepo: 'https://index.docker.io/v1/',
          imageName: dockerImageName
        };

        if (saveDockerAuthDetails) {
          addAuthDetailsToSocketClusterK8s(socketClusterK8sConfig, dockerUsername, dockerPassword);
        }

        try {
          saveSocketClusterK8sConfigFile(socketClusterK8sConfig);
        } catch (err) {
          failedToDeploy(err);
        }
        pushToDockerImageRepo();
      };

      const provideKeyAndCert = await promptConfirm('Would you like to upload a TLS private key and certificate to your cluster? (both must be unencrypted)', {default: true})

      if (provideKeyAndCert) {
        const secretName = await promptInput(`Insert a TLS secretName for Kubernetes (or press enter to leave it as "${DEFAULT_TLS_SECRET_NAME}" - Recommended):`) || DEFAULT_TLS_SECRET_NAME;
        const privateKeyPath = await promptInput('Insert the path to a private key file to upload to K8s (or press enter to cancel):')

        if (!privateKeyPath) {
          return;
        }

        const certFilePath = await promptInput('Insert the path to a certificate file to upload to K8s (or press enter to cancel):')

        if (!certFilePath) {
          return;
        }

        tlsSecretName = secretName;
        tlsKeyPath = privateKeyPath;
        tlsCertPath = certFilePath;
      }

      await promptDockerAuthDetails();

      dockerDefaultImageName = `${dockerUsername}/${appName}`;

      let imageName = await promptInput(`Enter the Docker image name without the version tag (Or press enter for default: ${dockerDefaultImageName}):`);

      imageName = imageName || dockerDefaultImageName;
      let slashes = imageName.match(/\//g) || [];
      if (slashes.length !== 1) {
        failedToDeploy(
          new Error('Invalid Docker image name; it must be in the format organizationName/projectName')
        );
      }
      dockerImageName = setImageVersionTag(imageName, dockerDefaultImageVersionTag);

      // Save config file
      saveSocketClusterK8sConfigs();
    }
  } else if (command === 'undeploy') {
    let appPath = arg1 || '.';

    let pkg = parsePackageFile(appPath);
    let appName = pkg.name;

    let kubernetesDirPath = appPath + '/kubernetes';
    let kubeFiles = fs.readdirSync(kubernetesDirPath);
    kubeFiles.forEach((configFilePath) => {
      let absolutePath = path.resolve(kubernetesDirPath, configFilePath);
      try {
        execSync(`kubectl delete -f ${absolutePath}`, {stdio: 'inherit'});
      } catch (err) {}
    });

    successMessage(`The '${appName}' app was undeployed successfully.`);

    process.exit();
  } else if (command === 'add-secret') {
    let secretName = argv.s || DEFAULT_TLS_SECRET_NAME;
    let privateKeyPath = argv.k;
    let certFilePath = argv.c;

    if (privateKeyPath == null || certFilePath == null) {
      errorMessage(`Failed to upload secret. Both a key file path (-k) and a certificate file path (-c) must be provided.`);
    } else {
      let success = uploadTLSSecret(secretName, privateKeyPath, certFilePath, errorMessage);
      if (success) {
        successMessage(`The private key and cert pair were added to your cluster under the secret name "${secretName}".`);
      }
    }
    process.exit();
  } else if (command === 'remove-secret') {
    let secretName = argv.s || DEFAULT_TLS_SECRET_NAME;
    let success = removeTLSSecret(secretName, errorMessage);
    if (success) {
      successMessage(`The private key and cert pair under the secret name "${secretName}" were removed from your cluster.`);
    }
    process.exit();
  } else {
    errorMessage(`"${command}" is not a valid SocketCluster command.`);
    showCorrectUsage();
    process.exit();
  }
})()
