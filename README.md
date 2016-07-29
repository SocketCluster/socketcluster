SocketCluster
======

[![Join the chat at https://gitter.im/SocketCluster/socketcluster](https://badges.gitter.im/Join%20Chat.svg)](https://gitter.im/SocketCluster/socketcluster?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge)

[![NPM](https://nodei.co/npm/socketcluster.png?stars&downloads&downloadRank)](https://nodei.co/npm/socketcluster/)

[![SocketCluster logo](https://raw.github.com/SocketCluster/socketcluster/master/assets/logo.png)](http://socketcluster.io/)

Complete documentation available at: http://socketcluster.io/

## Change log

**29 July 2016** (v5.0.0)

### Introducing SCC (on Kubernetes)

SCC stands for SocketCluster Cluster.
You can now finally run SocketCluster as an actual cluster - We have just released a set of images to DockerHub along with some .yaml config files for Kubernetes  (see kubernetes/ directory at the root of this repo). This means that you can now (relatively easily) deploy and scale SocketCluster on up to 1000 machines/nodes running Kubernetes - You literally just have to upload each .yaml file one by one using `kubectl create -f <service-definition.yaml>` and then add your SSL/TLS key and cert to your provider (see `kubernetes/sc-ingress.yaml`). It's been tested on a Rancher v1.1.0 (http://rancher.com/) Kubernetes cluster (We haven't yet tested on Google Container Engine). The cluster can be automatically scaled up and down (using the `kubectl scale` command) and the channels will be re-sharded automatically across available nodes.

SCC is made up of 4 different services which can be scaled independently. We will add more documentation in the near future on how to get started.
Also we will add information on how to extend SCC with your own code to you can build entire, highly scalable apps on top of it (without having to learn about distributed systems).

What use cases are SCC built for?

SCC differs from existing pub/sub systems and message queues in the following ways:

1. SCC is primarily intended as a frontend/web facing realtime service/framework - This already makes it quite different from most realtime pub/sub systems like
RabbitMQ, NSQ, Kafka and Redis which are mostly intended purely for server-side use (the use cases are quite different). That said, you CAN use SC as a backend-only system if you like.

2. RabbitMQ, NSQ, Kafka are optimized for dealing with predefined realtime queues/channels with very high throughput - They're not very good at handling high-churn. SCC is designed to handle channel churn - It can create and destroy channels dynamically at a rate of about 10K channels per second per process (and scaled linearly accross multiples nodes). Each SC channel can handle about 20K messages per second (this is much lower than what you could handle per channel/queue with Kafka for example). So basically, it's good if you want to have a system where you have millions of users who just create and destroy millions of unique channels on the fly as they navigate through an app (for example).

3. SCC is a framework; from the beginning, it was designed so that you could add your own middleware and business logic... Ultimately, we want SCC to replace the need for Backend as a Service.

Note that we have plans to offer a hosted Kubernetes platform (built on top of Rancher) - Where you will be able to easily deploy your SCC apps to Kubernetes running on your own infrastructure of choice (including Amazon EC2 and custom infrastructure). If this sounds interesting to you, please sign up to https://baasil.io/ - We will email you when it's ready.

### µWebSockets

µWS has been bundled with SC as an optional WebSocket server for a few months now. Based on our testing, we found µWS to be several times faster than the more established WS module.
As of v5.0.0 - We have made µWS our default WebSocket server engine. We still bundle the old WS module for backwards compatibility with older systems - You can roll back to the WS module by setting the `wsEngine` option of SocketCluster to `'ws'`. This switch to µWS shouldn't affect any existing code that you have (it has already been tested in production for several months by various users of SC) but it's important to be aware of this change.

**22 July 2016** (v4.7.0)

- Since the Node.js domain module is now deprecated, we have switched to using our own sc-domain module which uses Promises to capture async errors.
The sc-domain module doesn't behave exactly like the Node.js domain module though; the main difference is that it does not capture unhandled + nested 'error' events (it only captures thrown errors including those thrown asynchronously). This means that you now have to be more careful about handling all your 'error' events - SC's default behavior for handling uncaught error events is to crash and respawn the affected process - This is the approach recommended by the Node.js core team.

**16 January 2016** (v4.2.0)

- The schedulingPolicy option (http://socketcluster.io/#!/docs/api-socketcluster) is now 'rr' by default (except on Windows) - After doing some stress testing on large 8-core Linux EC2 instances, the 'rr' policy turned out to be much better at distributing load across multiple CPU cores. The downside of the 'rr' policy is that all new connection fds pass through
a central master process but that process turned out to be extremely efficient. It's not a perfect solution but it's much better than letting the Linux OS handle it.

## Introduction

SocketCluster is a fast, highly scalable HTTP + realtime server engine which lets you build multi-process
realtime servers that make use of all CPU cores on a machine/instance.
It removes the limitations of having to run your Node.js server as a single thread and makes your backend
resilient by automatically recovering from worker crashes and aggregating errors into a central log.

Follow the project on Twitter: https://twitter.com/SocketCluster
Subscribe for updates: http://socketcluster.launchrock.com/

## Memory leak profile

SocketCluster has been tested for memory leaks.
The last full memory profiling was done on SocketCluster v0.9.17 (Node.js v0.10.28) and included checks on worker and broker processes.

No memory leaks were detected when using the latest Node.js version.
Note that leaks were found when using Node.js versions below v0.10.22 - This is probably the Node.js 'Walmart' memory leak - Not a SocketCluster issue.

## Main Contributors

- Jonathan Gros-Dubois
- Nelson Zheng
- wactbprot (nData)
- epappas (nData)
- Gabriel Muller

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
docker run -d -v /home/my-username/controllers/:/usr/src/controllers/ -e "SOCKETCLUSTER_WORKER_CONTROLLER=/usr/src/controllers/worker.js" socketcluster/socketcluster
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

## License

(The MIT License)

Copyright (c) 2013-2016 SocketCluster.io

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the 'Software'), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
