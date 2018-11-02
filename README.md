SocketCluster
======

[![Join the chat at https://gitter.im/SocketCluster/socketcluster](https://badges.gitter.im/Join%20Chat.svg)](https://gitter.im/SocketCluster/socketcluster?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge)

[![SocketCluster logo](https://raw.github.com/SocketCluster/socketcluster/master/assets/logo.png)](http://socketcluster.io/)

Complete documentation available at: http://socketcluster.io/

Documentation for SCC is available at https://github.com/SocketCluster/socketcluster/blob/master/scc-guide.md

## Introduction

SocketCluster is a fast, highly scalable HTTP + realtime server engine which lets you build multi-process
realtime servers that make use of all CPU cores on a machine/instance.
It removes the limitations of having to run your Node.js server as a single thread and makes your backend
resilient by automatically recovering from worker crashes and aggregating errors into a central log on each host.
SC can also auto-scale across multiple hosts on top of Kubernetes; see SCC guide: https://github.com/SocketCluster/socketcluster/blob/master/scc-guide.md.

Follow the project on Twitter: https://twitter.com/SocketCluster
Subscribe for updates: http://socketcluster.launchrock.com/


## Installation

There are two ways to install SocketCluster.


### The easy way (Sets up boilerplate - Ready to run):

Setup the socketcluster command:

```bash
npm install -g socketcluster
```

OR

```bash
sudo npm install -g socketcluster
```

Then

```bash
socketcluster create myapp
```

Once it's installed, go to your new myapp/ directory and launch with:

```bash
node server
```

Access at URL http://localhost:8000/

### The hard way (More modular - Separate server and client):

```bash
npm install socketcluster
```

You will also need to install the client separately which you can get using the following command:

```bash
npm install socketcluster-client
```

The socketcluster-client script is called socketcluster.js (located in the main socketcluster-client directory)
- You should include it in your HTML page using a &lt;script&gt; tag in order to interact with SocketCluster.
For more details on how to use socketcluster-client, go to https://github.com/SocketCluster/socketcluster-client

It is recommended that you use Node.js version >=0.10.22 due to memory leaks present in older versions.

### Using over HTTPS

In order to run SocketCluster over HTTPS, all you need to do is set the protocol to 'https' and
provide your private key and certificate as a start option when you instantiate SocketCluster - Example:

```js
var socketCluster = new SocketCluster({
  workers: 3,
  brokers: 3,
  port: 8000,
  appName: 'myapp',
  workerController: 'worker.js',
  protocol: 'https',
  protocolOptions: {
    key: fs.readFileSync(__dirname + '/keys/enc_key.pem', 'utf8'),
    cert: fs.readFileSync(__dirname + '/keys/cert.pem', 'utf8'),
    passphrase: 'passphase4privkey'
  }
});
```

The protocolOptions option is exactly the same as the one you pass to a standard Node HTTPS server:
http://nodejs.org/api/https.html#https_https_createserver_options_requestlistener


## Docker and SocketCluster

You can create an app on top of SocketCluster's docker image. The SC container can be run standalone or
as a base image for your own container.

The official SocketCluster container on DockerHub is here: https://hub.docker.com/r/socketcluster/socketcluster/

The Dockerfile for the base image is here: https://github.com/SocketCluster/socketcluster/blob/master/sample/Dockerfile

To use the SocketCluster container as your base image, your app's Dockerfile might look like this:

```
FROM socketcluster/socketcluster
MAINTAINER John Smith

LABEL version="1.0.0"
LABEL description="Custom app based on SocketCluster"

WORKDIR /usr/src/
COPY . /usr/src/

RUN npm install

EXPOSE 8000

CMD ["npm", "start"]

```

Then you can just build your container using:

```docker build -t my-socketcluster-app:v1.0.0 .```

Note that there are more ways to run SocketCluster with Docker.
You can also mount your own volumes and point to custom worker.js and broker.js files which are
inside those volumes using environment variables. You can see the environment variables which are used
by SocketCluster here: https://github.com/SocketCluster/socketcluster/blob/master/sample/server.js

Docker volumes allow you to sneak your own directories (containing your own worker.js and broker.js source files) into the SocketCluster container without having to rebuild the image (good for development).
Read this section on volumes to get an idea of how they work with Docker: https://docs.docker.com/engine/userguide/containers/dockervolumes/

Note that if you want to attach any volumes to your SocketCluster container, you should mount them to the ```/usr/src/``` path (inside the container) - That's the root directory from which SC loads user-defined source code.

For example, if you wanted to quickly run SocketCluster with your own workerController file (```worker.js```), you could just put your ```worker.js``` file inside a ```/home/my-username/controllers/``` directory (on your host system) and then bundle it into the container as a volume by running a command like this (example):

```
docker run -d -v /home/my-username/controllers/:/usr/src/controllers/ -p 8000:8000 -e "SOCKETCLUSTER_WORKER_CONTROLLER=/usr/src/controllers/worker.js" socketcluster/socketcluster
```

To summarize:

- The ```-d``` flag just tells Docker to run the container in the background.
- The ```-v``` flag tells docker to mount the ```/home/my-username/controllers/``` directory (which is on your host machine) and map it to the ```/usr/src/controllers/``` (inside the SocketCluster container).
- The ```-e``` flag allows you to define custom environment variables. Here we are just using the SOCKETCLUSTER_WORKER_CONTROLLER env var to tell SocketCluster
to use the worker.js file which is inside the volume which we just mounted to the container at path ```/usr/src/controllers/```.
- The final argument ```socketcluster/socketcluster``` is the Docker image.


## Contribute to SocketCluster

- More integration test cases needed
- Unit tests
- Efficiency/speed - faster is better!
- Suggestions?

To contribute; clone this repo, then cd inside it and then run npm install to install all dependencies.


## Change log

See [GitHub releases](https://github.com/SocketCluster/socketcluster/releases) for changes.


## License

[MIT](LICENSE)
