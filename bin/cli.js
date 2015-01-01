#!/usr/bin/env node

process.stdin.resume();
process.stdin.setEncoding('utf8');

var wrench = require('wrench');
var fs = require('fs');
var path = require('path');
var argv = require('minimist')(process.argv.slice(2));
var childProcess = require('child_process');
var exec = childProcess.exec;
var spawn = childProcess.spawn;
var fork = childProcess.fork;

var command = argv._[0];
var commandRawArgs = process.argv.slice(3);
var arg1 = argv._[1];
var force = argv.force ? true : false;

var parsePackageFile = function (moduleDir) {
  var packageFile = moduleDir + '/package.json';
  try {
    if (fs.existsSync(packageFile)) {
      return JSON.parse(fs.readFileSync(packageFile, {encoding: 'utf8'}));
    }
  } catch (e) {}
  
  return {};
}

var errorMessage = function (message) {
  console.log('\033[0;31m[Error]\033[0m ' + message);
}

var successMessage = function (message) {
  console.log('\033[0;32m[Success]\033[0m ' + message);
}

var warningMessage = function (message) {
  console.log('\033[0;33m[Warning]\033[0m ' + message);
}

var showCorrectUsage = function () {
  console.log('Usage: socketcluster [options] [command]\n');
  console.log('Options:');
  console.log("  -v            Get the version of the current SocketCluster installation");
  console.log('  --help        Get info on how to use this command');
  console.log('  --force       Force all necessary directory modifications without prompts');
  console.log();
  console.log('Commands:');
  console.log('  create <appname>            Create a new boilerplate app in working directory');
}

var failedToRemoveDirMessage = function (dirPath) {
  errorMessage('Failed to remove existing directory at ' + dirPath + '. This directory may be used by another program or you may not have the permission to remove it.');
}

var failedToCreateMessage = function () {
  errorMessage('Failed to create necessary files. Please check your permissions and try again.');
}

var prompt = function (message, callback) {
  process.stdout.write(message + ' ');
  process.stdin.on('data', function inputHandler(text) {
    process.stdin.removeListener('data', inputHandler);
    callback(text)
  });
}

var promptConfirm = function (message, callback) {
  prompt(message, function (data) {
    data = data.toLowerCase().replace(/[\r\n]/g, '');
    callback(data == 'y' || data == 'yes');
  });
}

var copyDirRecursive = function (src, dest) {
  try {
    wrench.copyDirSyncRecursive(src, dest);
    return true;
  } catch (e) {
    failedToCreateMessage();
  }
  return false;
}

var rmdirRecursive = function (dirname) {
  try {
    wrench.rmdirSyncRecursive(dirname);
    return true;
  } catch (e) {
    failedToRemoveDirMessage(dirname);
  }
  return false;
}

if (argv.help) {
  showCorrectUsage();
  process.exit();
}

if (argv.v) {
  var scDir = __dirname + '/../';
  var scPkg = parsePackageFile(scDir);
  console.log('v' + scPkg.version);
  process.exit();
}

var wd = process.cwd();

var sampleDir = __dirname + '/../sample';
var destDir = path.normalize(wd + '/' + arg1);
var clientFileSourcePath = path.normalize(destDir + '/node_modules/socketcluster-client/socketcluster.js');
var clientFileDestPath = path.normalize(destDir + '/public/socketcluster.js');

var createFail = function () {
  errorMessage("Failed to create SocketCluster sample app.");
  process.exit();
};

var createSuccess = function () {
  console.log('Installing app dependencies using npm. This could take a while...');
  
  var npmCommand = (process.platform === "win32" ? "npm.cmd" : "npm");
  var options = {
    cwd: destDir,
    maxBuffer: Infinity
  };

  var npmProcess = spawn(npmCommand, ['install'], options);
  
  npmProcess.stdout.on('data', function (data) {
    process.stdout.write(data);
  });
  
  npmProcess.stderr.on('data', function (data) {
    process.stderr.write(data);
  });
  
  npmProcess.on('close', function (code) {
    if (code) {
      errorMessage('Failed to install npm dependencies. Exited with code ' + code + '.');
    } else {
      try {
        fs.writeFileSync(clientFileDestPath, fs.readFileSync(clientFileSourcePath));
        successMessage("SocketCluster sample '" + destDir + "' was setup successfully.");
      } catch (err) {
        warningMessage("Failed to copy file from '" + clientFileSourcePath + "' to '" + 
          clientFileDestPath + "' - Try copying it manually.");
      }
    }
    process.exit(code);
  });
  
  npmProcess.stdin.end();
};

var setupMessage = function () {
  console.log('Creating app structure...');
};

var confirmReplaceSetup = function (confirm) {
  if (confirm) {
    setupMessage();
    if (rmdirRecursive(destDir) && copyDirRecursive(sampleDir, destDir)) {
      createSuccess();
    } else {
      createFail();
    }
  } else {
    errorMessage("SocketCluster 'create' action was aborted.");
    process.exit();
  }
};

if (command == 'create') {
  if (arg1) {
    if (fs.existsSync(destDir)) {
      if (force) {
        confirmReplaceSetup(true);
      } else {
        var message = "There is already a directory at " + destDir + '. Do you want to overwrite it? (y/n)';
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
    errorMessage("The 'create' command requires a valid <appname> as argument.");
    showCorrectUsage();
    process.exit();
  }
} else {
  errorMessage("'" + command + "' is not a valid SocketCluster command.");
  showCorrectUsage();
  process.exit();
}
