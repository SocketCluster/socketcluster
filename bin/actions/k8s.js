const path = require('path');
const { execSync } = require('child_process');
const fs = require('fs-extra');
const YAML = require('yamljs');

const {
  parsePackageFile,
  parseJSONFile,
  getSCCWorkerDeploymentDefPath,
  getSCCBrokerDeploymentDefPath,
  sanitizeYAML,
} = require('../lib');

const DEFAULT_TLS_SECRET_NAME = 'scc-tls-credentials';

let dockerUsername, dockerPassword;
let saveDockerAuthDetails = null;

let tlsSecretName = null;
let tlsKeyPath = null;
let tlsCertPath = null;

const uploadTLSSecret = function (
  secretName,
  privateKeyPath,
  certFilePath,
  errorLogger,
) {
  try {
    execSync(
      `kubectl create secret tls ${secretName} --key ${privateKeyPath} --cert ${certFilePath}`,
      { stdio: 'inherit' },
    );
  } catch (err) {
    errorLogger(
      'Failed to upload TLS key and certificate pair to Kubernetes. ' +
        'You can try using the following command to upload them manually: ' +
        `kubectl create secret tls ${secretName} --key ${privateKeyPath} --cert ${certFilePath}`,
    );
    return false;
  }
  return true;
};

const removeTLSSecret = function (secretName, errorLogger) {
  try {
    execSync(`kubectl delete secret ${secretName}`, { stdio: 'inherit' });
  } catch (err) {
    errorLogger(
      `Failed to remove TLS key and certificate pair "${secretName}" from Kubernetes. ` +
        'You can try using the following command to remove them manually: ' +
        `kubectl delete secret ${secretName}`,
    );
    return false;
  }
  return true;
};

const k8sDeployAndDeployUpdate = async function (arg1, updateRequest) {
  let dockerImageName, dockerDefaultImageName;
  let dockerDefaultImageVersionTag = 'v1.0.0';
  let nextVersionTag;

  const self = this

  let appPath = arg1 || '.';
  let pkg = parsePackageFile(appPath);
  let appName = pkg.name;

  let isUpdate = updateRequest;

  let failedToDeploy = (err) => {
    this.errorLog(`Failed to deploy the '${appName}' app. ${err.message}`);
    process.exit();
  };

  let socketClusterK8sConfigFilePath = appPath + '/socketcluster-k8s.json';
  let socketClusterK8sConfig = parseJSONFile(socketClusterK8sConfigFilePath);

  let addAuthDetailsToSocketClusterK8s = function (
    socketClusterK8sConfigJSON,
    username,
    password,
  ) {
    if (!socketClusterK8sConfigJSON.docker) {
      socketClusterK8sConfigJSON.docker = {};
    }
    socketClusterK8sConfigJSON.docker.auth = Buffer.from(
      `${username}:${password}`,
      'utf8',
    ).toString('base64');
  };

  let saveSocketClusterK8sConfigFile = function (socketClusterK8sConfigJSON) {
    fs.writeFileSync(
      socketClusterK8sConfigFilePath,
      JSON.stringify(socketClusterK8sConfigJSON, null, 2),
    );
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

  let promptDockerAuthDetails = async () => {
    let username, password;

    // Check if username is specified
    if (dockerUsername == null) {
      username = await this.promptInput('Enter your Docker registry username:');
      dockerUsername = username.toLowerCase();
    }

    // Check if password is specified
    if (dockerPassword == null) {
      password = await this.promptInput(
        'Enter your Docker registry password:',
        true,
      );
      dockerPassword = password;
    }

    const confirmation = await this.promptConfirm(
      `Would you like to save your Docker registry username and password as Base64 to ${socketClusterK8sConfigFilePath}?`,
      { default: true },
    );

    if (confirmation) {
      saveDockerAuthDetails = confirmation;
    }

    return Promise.resolve({
      username: dockerUsername,
      password: dockerPassword,
      saveDockerAuthDetails,
    });
  };

  let performDeployment = function (
    dockerConfig,
    versionTag,
    username,
    password,
  ) {
    let dockerLoginCommand = `docker login -u "${username}" -p "${password}"`;

    let fullVersionTag;
    if (versionTag) {
      fullVersionTag = `:${versionTag}`;
    } else {
      fullVersionTag = parseVersionTag(dockerConfig.imageName);
    }
    dockerConfig.imageName = setImageVersionTag(
      dockerConfig.imageName,
      fullVersionTag,
    );
    if (saveDockerAuthDetails) {
      addAuthDetailsToSocketClusterK8s(
        socketClusterK8sConfig,
        username,
        password,
      );
    }
    try {
      saveSocketClusterK8sConfigFile(socketClusterK8sConfig);
      execSync(`docker build -t ${dockerConfig.imageName} .`, {
        stdio: 'inherit',
      });
      execSync(`${dockerLoginCommand}; docker push ${dockerConfig.imageName}`, {
        stdio: 'inherit',
      });

      if (tlsSecretName && tlsKeyPath && tlsCertPath) {
        uploadTLSSecret(tlsSecretName, tlsKeyPath, tlsCertPath, warningMessage);
      }

      let kubernetesDirPath = appPath + '/kubernetes';

      let kubeConfSCCWorker = getSCCWorkerDeploymentDefPath(kubernetesDirPath);
      let kubeConfContentSCCWorker = fs.readFileSync(kubeConfSCCWorker, {
        encoding: 'utf8',
      });

      let deploymentConfSCCWorker = YAML.parse(kubeConfContentSCCWorker);

      let initContainersSCCWorker =
        deploymentConfSCCWorker.spec.template.spec.initContainers;
      initContainersSCCWorker.forEach((value, index) => {
        if (value) {
          if (value.name === 'app-src-container') {
            initContainersSCCWorker[index].image = dockerConfig.imageName;
          }
        }
      });

      let formattedYAMLStringSCCWorker = sanitizeYAML(
        YAML.stringify(deploymentConfSCCWorker, Infinity, 2),
      );
      fs.writeFileSync(kubeConfSCCWorker, formattedYAMLStringSCCWorker);

      let kubeConfSCCBroker = getSCCBrokerDeploymentDefPath(kubernetesDirPath);
      let kubeConfContentSCCBroker = fs.readFileSync(kubeConfSCCBroker, {
        encoding: 'utf8',
      });

      let deploymentConfSCCBroker = YAML.parse(kubeConfContentSCCBroker);

      let formattedYAMLStringSCCBroker = sanitizeYAML(
        YAML.stringify(deploymentConfSCCBroker, Infinity, 2),
      );
      fs.writeFileSync(kubeConfSCCBroker, formattedYAMLStringSCCBroker);

      let ingressKubeFileName = 'scc-ingress.yaml';
      let sccWorkerDeploymentFileName = 'scc-worker-deployment.yaml';

      let deploySuccess = () => {
        self.successLog(
          `The '${appName}' app was deployed successfully - You should be able to access it online ` +
            `once it has finished booting up. This can take a while depending on your platform.`,
        );
        process.exit();
      };

      if (isUpdate) {
        try {
          execSync(
            `kubectl replace -f ${kubernetesDirPath}/${sccWorkerDeploymentFileName}`,
            { stdio: 'inherit' },
          );
        } catch (err) {}

        deploySuccess();
      } else {
        let kubeFiles = fs.readdirSync(kubernetesDirPath);
        let serviceAndDeploymentKubeFiles = kubeFiles.filter(
          (configFilePath) => {
            return configFilePath != ingressKubeFileName;
          },
        );
        serviceAndDeploymentKubeFiles.forEach((configFilePath) => {
          let absolutePath = path.resolve(kubernetesDirPath, configFilePath);
          execSync(`kubectl create -f ${absolutePath}`, { stdio: 'inherit' });
        });

        // Wait a few seconds before deploying ingress (due to a bug in some environments).
        setTimeout(() => {
          try {
            execSync(
              `kubectl create -f ${kubernetesDirPath}/${ingressKubeFileName}`,
              { stdio: 'inherit' },
            );
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

  let pushToDockerImageRepo = async () => {
    let versionTagString = parseVersionTag(
      socketClusterK8sConfig.docker.imageName,
    ).replace(/^:/, '');
    if (versionTagString) {
      if (isUpdate) {
        nextVersionTag = incrementVersion(versionTagString);
      } else {
        nextVersionTag = versionTagString;
      }
    } else {
      nextVersionTag = dockerDefaultImageVersionTag;
    }

    const versionTag = await this.promptInput(
      `Enter the Docker version tag for this deployment (Default: ${nextVersionTag}):`,
    );

    socketClusterK8sConfig.docker.imageName = setImageVersionTag(
      socketClusterK8sConfig.docker.imageName,
      nextVersionTag,
    );
    let dockerConfig = socketClusterK8sConfig.docker;

    if (dockerConfig.auth) {
      let authParts = Buffer.from(dockerConfig.auth, 'base64')
        .toString('utf8')
        .split(':');
      dockerUsername = authParts[0];
      dockerPassword = authParts[1];
      performDeployment(
        dockerConfig,
        versionTag,
        dockerUsername,
        dockerPassword,
      );
    } else {
      if (!dockerUsername || !dockerPassword) {
        const { username, password } = await promptDockerAuthDetails();
        performDeployment(dockerConfig, versionTag, username, password);
      } else {
        performDeployment(
          dockerConfig,
          versionTag,
          dockerUsername,
          dockerPassword,
        );
      }
    }
  };

  // If configuration file exists
  if (
    socketClusterK8sConfig.docker &&
    socketClusterK8sConfig.docker.imageRepo
  ) {
    let versionTagString = parseVersionTag(
      socketClusterK8sConfig.docker.imageName,
    ).replace(/^:/, '');
    if (versionTagString) {
      if (isUpdate) {
        nextVersionTag = incrementVersion(versionTagString);
      } else {
        nextVersionTag = versionTagString;
      }
    } else {
      nextVersionTag = dockerDefaultImageVersionTag;
    }

    const versionTag = await this.promptInput(
      `Enter the Docker version tag for this deployment (Default: ${nextVersionTag}):`,
    );

    socketClusterK8sConfig.docker.imageName = setImageVersionTag(
      socketClusterK8sConfig.docker.imageName,
      nextVersionTag,
    );
    let dockerConfig = socketClusterK8sConfig.docker;

    if (dockerConfig.auth) {
      let authParts = Buffer.from(dockerConfig.auth, 'base64')
        .toString('utf8')
        .split(':');
      dockerUsername = authParts[0];
      dockerPassword = authParts[1];
      performDeployment(
        dockerConfig,
        versionTag,
        dockerUsername,
        dockerPassword,
      );
    } else {
      const { username, password } = await promptDockerAuthDetails();

      performDeployment(dockerConfig, versionTag, username, password);
    }
    // If configuration file doesn't exist
  } else {
    let saveSocketClusterK8sConfigs = function () {
      socketClusterK8sConfig.docker = {
        imageRepo: 'https://index.docker.io/v1/',
        imageName: dockerImageName,
      };

      if (saveDockerAuthDetails) {
        addAuthDetailsToSocketClusterK8s(
          socketClusterK8sConfig,
          dockerUsername,
          dockerPassword,
        );
      }

      try {
        saveSocketClusterK8sConfigFile(socketClusterK8sConfig);
      } catch (err) {
        failedToDeploy(err);
      }
      pushToDockerImageRepo();
    };

    const provideKeyAndCert = await this.promptConfirm(
      'Would you like to upload a TLS private key and certificate to your cluster? (both must be unencrypted)',
      { default: true },
    );

    if (provideKeyAndCert) {
      const secretName =
        (await this.promptInput(
          `Insert a TLS secretName for Kubernetes (or press enter to leave it as "${DEFAULT_TLS_SECRET_NAME}" - Recommended):`,
        )) || DEFAULT_TLS_SECRET_NAME;
      const privateKeyPath = await this.promptInput(
        'Insert the path to a private key file to upload to K8s (or press enter to cancel):',
      );

      if (!privateKeyPath) {
        return;
      }

      const certFilePath = await this.promptInput(
        'Insert the path to a certificate file to upload to K8s (or press enter to cancel):',
      );

      if (!certFilePath) {
        return;
      }

      tlsSecretName = secretName;
      tlsKeyPath = privateKeyPath;
      tlsCertPath = certFilePath;
    }

    await promptDockerAuthDetails();

    dockerDefaultImageName = `${dockerUsername}/${appName}`;

    let imageName = await this.promptInput(
      `Enter the Docker image name without the version tag (Or press enter for default: ${dockerDefaultImageName}):`,
    );

    imageName = imageName || dockerDefaultImageName;
    let slashes = imageName.match(/\//g) || [];
    if (slashes.length !== 1) {
      failedToDeploy(
        new Error(
          'Invalid Docker image name; it must be in the format organizationName/projectName',
        ),
      );
    }
    dockerImageName = setImageVersionTag(
      imageName,
      dockerDefaultImageVersionTag,
    );

    // Save config file
    saveSocketClusterK8sConfigs();
  }
};

const k8sUndeploy = async function (arg1) {
  let appPath = arg1 || '.';

  let pkg = parsePackageFile(appPath);
  let appName = pkg.name;

  let kubernetesDirPath = appPath + '/kubernetes';
  let kubeFiles = fs.readdirSync(kubernetesDirPath);
  kubeFiles.forEach((configFilePath) => {
    let absolutePath = path.resolve(kubernetesDirPath, configFilePath);
    try {
      execSync(`kubectl delete -f ${absolutePath}`, { stdio: 'inherit' });
    } catch (err) {}
  });

  this.successLog(`The '${appName}' app was undeployed successfully.`);

  process.exit();
};

const k8sAddSecret = async function () {
  let secretName = this.argv.s || DEFAULT_TLS_SECRET_NAME;
  let privateKeyPath = this.argv.k;
  let certFilePath = this.argv.c;

  if (privateKeyPath == null || certFilePath == null) {
    this.errorLog(
      `Failed to upload secret. Both a key file path (-k) and a certificate file path (-c) must be provided.`,
    );
  } else {
    let success = uploadTLSSecret(
      secretName,
      privateKeyPath,
      certFilePath,
      this.errorLog,
    );
    if (success) {
      this.successLog(
        `The private key and cert pair were added to your cluster under the secret name "${secretName}".`,
      );
    }
  }
  process.exit();
};

const k8sRemoveSecret = async function () {
  const secretName = this.argv.s || DEFAULT_TLS_SECRET_NAME;
  const success = removeTLSSecret(secretName, this.errorLog);
  if (success) {
    this.successLog(
      `The private key and cert pair under the secret name "${secretName}" were removed from your cluster.`,
    );
  }
  process.exit();
};

module.exports = {
  k8sAddSecret,
  k8sDeployAndDeployUpdate,
  k8sRemoveSecret,
  k8sUndeploy,
};
