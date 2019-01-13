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

let command = argv._[0];
let commandRawArgs = process.argv.slice(3);
let arg1 = argv._[1];
let force = argv.force ? true : false;

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
  console.log('Usage: asyngular [options] [command]\n');
  console.log('Options:');
  console.log("  -v            Get the version of the current Asyngular installation");
  console.log('  --help        Get info on how to use this command');
  console.log('  --force       Force all necessary directory modifications without prompts');
  console.log();
  console.log('Commands:');
  console.log('  create <appname>            Create a new boilerplate app in working directory');
  // TODO: Implement
  // console.log('  run <path>                  Run app at path inside container on your local machine');
  // console.log('  restart <app-path-or-name>  Restart an app with the specified name');
  // console.log('  stop <app-path-or-name>     Stop an app with the specified name');
  // console.log('  list                        List all running Docker containers on your local machine');
  // console.log('  logs <app-path-or-name>     Get logs for the app with the specified name');
  // console.log('    -f                        Follow the logs');
  // console.log('  deploy <app-path>           Deploy app at path to your Baasil.io cluster');
  // console.log('  deploy-update <app-path>    Deploy update to app which was previously deployed');
  // console.log('  undeploy <app-path>         Shutdown all core app services running on your cluster');
  console.log('');
  let extraMessage = 'Note that the app-name/app-path in the commands above is optional (except for create) - If not provided, ' +
    'asyngular will use the current working directory as the app path.';
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

let promptInput = function (message, callback, secret) {
  prompt([
    {
      type: secret ? 'password' : 'input',
      message: message,
      name: 'result',
      default: null
    }
  ]).then((answers) => {
    callback(answers.result);
  }).catch((err) => {
    errorMessage(err.message);
    process.exit();
  });
};

let promptConfirm = function (message, callback) {
  prompt([
    {
      type: 'confirm',
      message: message,
      name: 'result'
    }
  ]).then((answers) => {
    callback(answers.result);
  }).catch((err) => {
    errorMessage(err.message);
    process.exit();
  });
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

if (argv.help) {
  showCorrectUsage();
  process.exit();
};

if (argv.v) {
  let scDir = `${__dirname}/../`;
  let scPkg = parsePackageFile(scDir);
  console.log('v' + scPkg.version);
  process.exit();
};

let wd = process.cwd();

let sampleDir = `${__dirname}/../sample`;
let destDir = path.normalize(`${wd}/${arg1}`);
let clientFileSourcePath = path.normalize(`${destDir}/node_modules/asyngular-client/asyngular-client.js`);
let clientFileDestPath = path.normalize(`${destDir}/public/asyngular-client.js`);

let createFail = function () {
  errorMessage('Failed to create Asyngular sample app.');
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

  npmProcess.stdout.on('data', function (data) {
    process.stdout.write(data);
  });

  npmProcess.stderr.on('data', function (data) {
    process.stderr.write(data);
  });

  npmProcess.on('close', function (code) {
    if (code) {
      errorMessage(`Failed to install npm dependencies. Exited with code ${code}.`);
    } else {
      try {
        fs.writeFileSync(clientFileDestPath, fs.readFileSync(clientFileSourcePath));
        successMessage(`Asyngular sample "${destDir}" was setup successfully.`);
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
    if (rmdirRecursive(destDir) && copyDirRecursive(sampleDir, destDir)) {
      createSuccess();
    } else {
      createFail();
    }
  } else {
    errorMessage('Asyngular "create" action was aborted.');
    process.exit();
  }
};

if (command === 'create') {
  if (arg1) {
    if (fileExistsSync(destDir)) {
      if (force) {
        confirmReplaceSetup(true);
      } else {
        let message = `There is already a directory at ${destDir}. Do you want to overwrite it?`;
        promptConfirm(message, confirmReplaceSetup);
      }
    } else {
      setupMessage();
      if (copyDirRecursive(sampleDir, destDir)) {
        createSuccess();
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
    `${envFlagString}--name ${appName} socketcluster/asyngular:v1.0.10`;
  try {
    execSync(dockerCommand, {stdio: 'inherit'});
    successMessage(`App "${appName}" is running at http://localhost:${portNumber}`);
  } catch (e) {
    errorMessage(`Failed to start app "${appName}".`);
  }
  process.exit();
} else {
  errorMessage(`"${command}" is not a valid Asyngular command.`);
  showCorrectUsage();
  process.exit();
}
