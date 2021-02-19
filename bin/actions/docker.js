const dockerStop = async function () {
  let appName = arg1;
  if (!appName) {
    let appPath = '.';
    let pkg = parsePackageFile(appPath);
    appName = pkg.name;
  }
  try {
    execSync(`docker stop ${appName}`);
    execSync(`docker rm ${appName}`);
    this.successLog(`App '${appName}' was stopped.`);
  } catch (e) {
    this.errorLog(`Failed to stop app '${appName}'.`);
  }
  process.exit();
};

const dockerRestart = async function () {
  let appName = arg1;
  if (!appName) {
    let appPath = '.';
    let pkg = parsePackageFile(appPath);
    appName = pkg.name;
  }
  try {
    execSync(`docker stop ${appName}`, { stdio: 'ignore' });
    this.successLog(`App '${appName}' was stopped.`);
  } catch (e) {}
  try {
    execSync(`docker start ${appName}`);
    this.successLog(`App '${appName}' is running.`);
  } catch (e) {
    this.errorLog(`Failed to start app '${appName}'.`);
  }
  process.exit();
};

const dockerRun = async function () {
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
    execSync(`docker stop ${appName}`, { stdio: 'ignore' });
    execSync(`docker rm ${appName}`, { stdio: 'ignore' });
  } catch (e) {}

  let dockerCommand =
    `docker run -d -p ${portNumber}:8000 -v ${absoluteAppPath}:/usr/src/app/ ` +
    `${envFlagString}--name ${appName} socketcluster/socketcluster:v${scVersion} `;
  try {
    execSync(dockerCommand, { stdio: 'inherit' });
    this.successLog(
      `App "${appName}" is running at http://localhost:${portNumber}`,
    );
  } catch (e) {
    this.errorLog(`Failed to start app "${appName}".`);
  }
  process.exit();
};

const dockerList = async function () {
  let command = exec(`docker ps${commandRawArgsString}`, (err) => {
    if (err) {
      this.errorLog(`Failed to list active containers. ` + err);
    }
    process.exit();
  });
  command.stdout.pipe(process.stdout);
  command.stderr.pipe(process.stderr);
};

const dockerLogs = async function () {
  let appName = arg1;
  if (!appName) {
    let appPath = '.';
    let pkg = parsePackageFile(appPath);
    appName = pkg.name;
  }
  let command = exec(`docker logs ${appName}${commandRawArgsString}`, (err) => {
    if (err) {
      this.errorLog(`Failed to get logs for '${appName}' app. ` + err);
    }
    process.exit();
  });
  command.stdout.pipe(process.stdout);
  command.stderr.pipe(process.stderr);
};

module.exports = {
  dockerRestart,
  dockerRun,
  dockerStop,
  dockerList,
  dockerLogs,
};
