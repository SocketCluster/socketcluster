SocketCluster
======

**See bottom of page for benchmark tests.**

SocketCluster is a fast, highly scalable HTTP + WebSocket (engine.io) server which lets you build multi-process 
realtime systems/apps that make use of all CPU cores on a machine/instance.
It removes the limitations of having to run your Node.js server as a single thread.

SocketCluster was designed to be modular so that you can run other frameworks like express on top of it (or build your own!)

Unlike other realtime engines, SocketCluster deploys itself as a cluster of processes in order to make use of all CPUs/cores on
a machine/instance - This offers a more consistent performance for users and lets you scale vertically without theoretical limits (so long as you can throw more CPU cores at it).
SocketCluster workers are highly parallelized - Asymptotically speaking, SocketCluster is N times faster than any comparable 
single-threaded WebSocket/HTTP server (where N is the number of CPUs/cores available on your machine).

SocketCluster was designed to be lightweight and its realtime API is almost identical to Socket.io.

Follow the project on Twitter: https://twitter.com/SocketCluster

### Memory leak profile

SocketCluster has been tested for memory leaks.
The last full memory profiling was done on SocketCluster v0.9.17 (Node.js v0.10.28) and included checks on load balancer, worker and store processes.

No memory leaks were detected when using the latest Node.js version.
Note that leaks were found when using Node.js versions below v0.10.22 - This is probably the Node.js 'Walmart' memory leak - Not a SocketCluster issue.


## Details

Some key technical features of SocketCluster are:
- Sockets which are bound to the same browser (for example, across multiple tabs) share the same session.
- You can emit an event on a session to notify all sockets that belong to it.
- The SocketCluster client (socketcluster-client) has an option to allow disconnected sockets to automatically (and seamlessly) reconnect
if they lose the connection.
- Server crashes are transparent to users (aside from a 2 to 5 second delay to allow the worker to respawn) - Session data remains intact between crashes.
- It uses a memory store cluster called nData which you can use to store 'volatile' session data which relates to your sockets/sessions.


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
For more details on how to use socketcluster-client, go to https://github.com/topcloud/socketcluster-client

It is recommended that you use Node.js version >=0.10.22 due to memory leaks present in older versions.


## How to use

The following example launches SocketCluster as 7 distinct processes (in addition to the current master process):
- 3 workers on ports 9100, 9101, 9102
- 3 stores on ports 9001, 9002, 9003
- 1 load balancer on port 8000 which distributes requests evenly between the 3 workers

```js
var SocketCluster = require('socketcluster').SocketCluster;

var socketCluster = new SocketCluster({
    workers: [9100, 9101, 9102],
    stores: [9001, 9002, 9003],
    balancerCount: 1, // Optional
    port: 8000,
    appName: 'myapp',
    workerController: 'worker.js',
    // balancerController: 'firewall.js', // Optional
    // storeController: 'store.js', // Optional
    // useSmartBalancing: true, // Optional - If true, load balancing will be based on session id instead of IP address. Defaults to false.
    rebootWorkerOnError: false, // Optional, makes debugging easier - Defaults to true (should be true in production),
    addressSocketLimit: 50 // Optional, prevents malicious clients from hogging up unlimited sockets (memory) on your server - Defaults to 30
});
```

The appName option can be any string which uniquely identifies this application.
This avoids potential issues with having multiple SocketCluster apps run under the same domain - It is 
used internally for various purposes.

The workerController option is the path to a file which each SocketCluster worker will use to bootstrap itself.
This file is a standard Node.js module which must expose a run(worker) function - Inside this run function is where you should
put all your application logic.

The balancerController option is optional and represents the path to a file which each load balancer will use to bootstrap itself.
This file is a standard Node.js module which must expose a run(loadBalancer) function. This run function receives a LoadBalancer instance as argument.
You can use the loadBalancer.addMiddleware(middlewareType, middlewareFunction) function to specify middleware functions to 
preprocess/filter out various requests before they reach your workers - The middlewareType argument can be either loadBalancer.MIDDLEWARE_REQUEST 
or loadBalancer.MIDDLEWARE_UPGRADE.

Example 'worker.js':

```js
var fs = require('fs');

module.exports.run = function (worker) {
    // Get a reference to our raw Node HTTP server
    var httpServer = worker.getHTTPServer();
    // Get a reference to our WebSocket server
    var wsServer = worker.getSCServer();
    
    /*
        We're going to read our main HTML file and the socketcluster-client
        script from disk and serve it to clients using the Node HTTP server.
    */
    
    var htmlPath = __dirname + '/index.html';
    var clientPath = __dirname + '/node_modules/socketcluster-client/socketcluster.js';
    
    var html = fs.readFileSync(htmlPath, {
        encoding: 'utf8'
    });
    
    var clientCode = fs.readFileSync(clientPath, {
        encoding: 'utf8'
    });

    /*
        Very basic code to serve our main HTML file to clients and
        our socketcluster-client script when requested.
        It may be better to use a framework like express here.
        Note that the 'req' event used here is different from the standard Node.js HTTP server 'request' event 
        - The 'request' event also captures SocketCluster-related requests; the 'req'
        event only captures the ones you actually need. As a rule of thumb, you should not listen to the 'request' event.
    */
    httpServer.on('req', function (req, res) {
        if (req.url == '/socketcluster.js') {
            res.writeHead(200, {
                'Content-Type': 'text/javascript'
            });
            res.end(clientCode);
        } else if (req.url == '/') {
            res.writeHead(200, {
                'Content-Type': 'text/html'
            });
            res.end(html);
        }
    });
    
    var activeSessions = {};
    
    /*
        In here we handle our incoming WebSocket connections and listen for events.
        From here onwards is just like Socket.io but with some additional features.
    */
    wsServer.on('connection', function (socket) {
        // Emit a 'greet' event on the current socket with value 'hello world'
        socket.emit('greet', 'hello world');
        
        /*
            Store that socket's session for later use.
            We will emit events on it later - Those events will 
            affect all sockets which belong to that session.
        */
        activeSessions[socket.session.id] = socket.session;
    });
  
    wsServer.on('disconnection', function (socket) {
        console.log('Socket ' + socket.id + ' was disconnected');
    });
    
    wsServer.on('sessiondestroy', function (ssid) {
        delete activeSessions[ssid];
    });
    
    setInterval(function () {
        /*
            Emit a 'rand' event on each active session.
            Note that in this case the random number emitted will be the same across all sockets which
            belong to the same session (I.e. All open tabs within the same browser).
        */
        for (var i in activeSessions) {
            activeSessions[i].emit('rand', Math.floor(Math.random() * 100));
        }
    }, 1000);
};
```

### Emitting events

SocketCluster lets you emit events in several ways:

On the current session (this is the recommended way; accounts for multiple open tabs):
```js
socket.session.emit('foo', eventData, callback);
```

On a specific session (possibly hosted on a different worker process):
```js
// Function signature: emit(sessionId, event, data, callback)
socket.global.emit('localhost_9101_8000_0_47kR_u7W4LGk56rSAAAA', 'foo', eventData, callback);
```

Broadcast to all sessions (on all worker processes):
```js
socket.global.broadcast('foo', eventData, callback);
```

Broadcast to all sessions (this time we access the global object directly from the SCServer instance):
```js
wsServer.global.broadcast('foo', eventData, callback);
```

On the socket (only use this one if you know what you're doing; generally, it's better to emit on a session):
```js
socket.emit('foo', eventData, callback);
```

### Using with Express

Using SocketCluster with express is simple, you put the code inside your workerController:

```js
module.exports.run = function (worker) {
    // Get a reference to our raw Node HTTP server
    var httpServer = worker.getHTTPServer();
    // Get a reference to our WebSocket server
    var wsServer = worker.getSCServer();
    
    var app = require('express')();
    
    // Add whatever express middleware you like...
    
    // Make your express app handle all essential requests
    httpServer.on('req', app);
};
```

### Using over HTTPS

In order to run SocketCluster over HTTPS, all you need to do is set the protocol to 'https' and 
provide your private key and certificate as a start option when you instantiate SocketCluster - Example:

```js
var socketCluster = new SocketCluster({
  workers: [9100, 9101, 9102],
  stores: [9001, 9002, 9003],
  balancerCount: 1, // Optional
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

Note that encryption/decryption in SocketCluster happens at the LoadBalancer level (SocketCluster launches one or more 
lightweight load balancers to distribute traffic evenly between your SocketCluster workers).
LoadBalancers are responsible for encrypting/decrypting all network traffic. What this means is that your code (which is in the worker layer)
will only ever deal with raw HTTP traffic.

### Authentication

SocketCluster lets you store session data using the socket.session object. 
This object gives you access to a cluster of in-memory stores called nData.
You can effectively invoke any of the methods documented here to store and retrieve session data:
https://github.com/topcloud/ndata

For example, to authorize a user, you could check their login credentials and upon
success, you could add an auth token to that session:

```js
socket.session.set('isUserAuthorized', true, callback);
```

Then, on subsequent events, you could check for that token before handling the event:

```js
socket.session.get('isUserAuthorized', function (err, value) {
  if (value) {
    // Token is set, therefore this event is authorized
  }
});
```

The session object can also be accessed from the req object that you get from 
SocketCluster's HTTP server 'req' event (I.e. req.session).

SocketCluster provides two middleware lines for filtering out sockets and events.

MIDDLEWARE_HANDSHAKE middleware for filtering out sockets based on session data:
```js
wsServer.addMiddleware(wsServer.MIDDLEWARE_HANDSHAKE, function (req, next) {
  req.session.get('isUserAuthorized', function (err, value) {
    if (value) {
      next();
    } else {
      next('Session ' + req.session.id + ' was not authorized');
    }
  });
});
```

MIDDLEWARE_EVENT middleware for filtering out individual events:
```js
wsServer.addMiddleware(wsServer.MIDDLEWARE_EVENT, function (socket, event, data, next) {
  if (event == 'bla') {
    next(new Error('bla event is not allowed for socket ' + socket.id + ' on session ' + socket.session.id));
  } else {
    next();
  }
});
```

## Contribute to SocketCluster

- Tests needed - While some of the underlying modules of SC are well tested, 
it would be nice to add some higher-level tests to help maintain high code quality.
- Documentation - Inline source documentation is needed.
- Benchmarks - More benchmarks - Particularly, it would be nice to get an idea of how many concurrent connections SocketCluster can handle on a big machine.
- Efficiency/speed - faster is better!

To contribute; clone this repo, then cd inside it and then run npm install to install all dependencies.

## API (Documentation coming soon)

### SocketCluster

Exposed by `require('socketcluster').SocketCluster`.

### SocketCluster(opts:Object)

Creates a new SocketCluster, must be invoked with the new keyword.

```js
var SocketCluster = require('socketcluster').SocketCluster;

var socketCluster = new SocketCluster({
    workers: [9100, 9101, 9102],
    stores: [9001, 9002, 9003],
    port: 8000,
    appName: 'myapp',
    workerController: 'worker.js'
});
```

Documentation on all supported options is coming soon (there are around 30 of them - Most of them are optional).
    
### SCWorker

A SCWorker object is passed as the argument to your workerController's run(worker) function.
Example - Inside worker.js:

```js
module.exports.run = function (worker) {
    // worker here is an instance of SCWorker
};
```

### SCServer

An SCServer instance is returned from worker.getSCServer() - You use it to handle WebSocket connections.

## Benchmarks

### Throughput (SocketCluster v0.9.8)

The goal of this test was to see how many JavaScript (JSON) objects SocketCluster could process each second on a decent machine.

#### Procedure

For this CPU benchmark, SocketCluster was tested on an 8-core Amazon EC2 m3.2xlarge instance running Linux.
* A new client was created every second until there were 100 concurrent clients.
* The maximum number of messages sent was set to be 170K (1700 messages per second per client).
* The messages were fully bidirectional - The client sent a 'ping' event containing a JavaScript object (cast to JSON) and the server responded with a 'pong' JavaScript object. That object had a 'count' property to indicate the total number of pings received so far by the current worker.
* SocketCluster was setup to use 5 load balancers, 5 workers and 2 stores.

#### Observations

* An upgrade to the loadbalancer module to v0.9.12 resulted in much more even distribution between workers.
Older versions of loadbalancer tended to not respond as well to large, sudden traffic spikes.
The new version of loadbalancer uses an algorithm which leverages random probability with deterministic 'bad luck' correction to make sure that the load is spread evenly between workers.
* The processes settings were poorly tuned in the previous benchmark - It's wasteful to use many more processes than you have CPU cores.
* Using fewer processes resulted in a very healthy load average of 3.33 (out of a possible 8). We could probably have pushed well past 200K connections with our current setup.
The setup of 5 load balancer, 5 workers and 2 stores is still not ideal - Maybe one more worker process would have brought the perfect balance?

#### Screenshot

![alt tag](https://raw.github.com/topcloud/socketcluster/master/benchmarks/socketcluster_v0.9.8.png)


### Concurrency (SocketCluster v0.9.20)

The goal of this test was to estimate how many concurrent users SocketCluster could comfortably handle.

#### Procedure

SocketCluster was deployed on an 8-core Amazon EC2 m3.2xlarge instance running Linux.
The SocketCluster client was run on the largest possible 32-core Amazon EC2 c3.8xlarge instance running Linux - This was necessary in order to be able to simulate 42K concurrent users from a single machine.

* Virtual users (on client) were created (connected) at a rate of approximately 160 per second.
* The maximum number of concurrent virtual users was set to 42K - This is a limit of the client, not the server.
* Each virtual user sent a 'ping' message every 6 seconds on average. The payload of the 'ping' event was a JavaScript object (cast to JSON), the response was a 'pong' object containing the total number of pings received by the current worker so far.
* A standard browser (Chrome) was connected to the SC server remotely (sending pings occasionally) to check that the service was still performant in real terms throughout the whole test (also used to check the growing ping count over time).
* SocketCluster was setup to run with 4 load balancers, 3 workers and 1 store.

#### Observations

* CPU (of busiest worker) peaked to around 60% near the end while new connections where still being created (at rate of 160 per second).
* Once connections settled at 42K, the CPU use of the busiest worker dropped to around 45%
* The store didn't do much work - In reality only 7 CPU cores were fully exploited.
* The load average was under 2 (out of a possible 8), so there was plenty of room for more users.
* Memory usage was negligible when compared to CPU usage.
* The huge 32-core EC2 client machine could not get very far past 42K connections - CPU usage on the client was approaching 100% on all 32 cores. Past a certain point, the client would start lagging and the load on the server would drop.

#### Screenshot

![alt tag](https://raw.github.com/topcloud/socketcluster/master/benchmarks/sc_42k_clients.png)