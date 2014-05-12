SocketCluster
======

SocketCluster is a WebSocket server cluster (with HTTP long-polling fallback) based on engine.io.
Unlike other realtime engines, SocketCluster deploys itself as a cluster in order to make use of all CPUs/cores on
a machine/instance - This offers a more consistent performance for users and lets you scale vertically without limits.
SocketCluster workers are highly parallelized - Asymptotically speaking, SocketCluster is N times faster than any other 
available WebSocket server (where N is the number of CPUs/cores available on your machine).
SocketCluster was designed to be lightweight and its API is almost identical to Socket.io.

Latest benchmark results (v0.9.8, 12/05/2014)

![alt tag](https://raw.github.com/topcloud/socketcluster/master/benchmarks/socketcluster_v0.9.8.png)

See bottom of page for details (Benchmark #2).

Other advantages of SocketCluster include:
- Sockets which are bound to the same browser (for example, across multiple tabs) share the same session.
- You can emit an event on a session to notify all sockets that belong to it.
- The SocketCluster client (socketcluster-client) has an option to allow disconnected sockets to automatically (and seamlessly) reconnect
if they lose the connection.
- Server crashes are transparent to users (aside from a 2 to 5 second delay to allow the worker to respawn) - Session data remains intact between crashes.
- It uses a memory store cluster called nData which you can use to store 'volatile' session data which relates to your sockets/sessions.

To install, run:

```bash
npm install socketcluster
```

Note that to use socketcluster you will also need the client which you an get using the following command:

```bash
npm install socketcluster-client
```

The socketcluster-client script is called socketcluster.js (located in the main socketcluster-client directory) 
- You should include it in your HTML page using a &lt;script&gt; tag in order to interact with SocketCluster.
For more details on how to use socketcluster-client, go to https://github.com/topcloud/socketcluster-client

**Scroll to the bottom of this README for results of benchmark tests.**

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
    balancerController: 'firewall.js' // Optional
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
    var wsServer = worker.getWSServer();
    
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

On the socket:
```js
socket.emit('foo', eventData, callback);
```

On the current session (this is the recommended way in case user has multiple open tabs):
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

### Using with Express

Using SocketCluster with express is simple, you put the code inside your workerController:

```js
module.exports.run = function (worker) {
    // Get a reference to our raw Node HTTP server
    var httpServer = worker.getHTTPServer();
    // Get a reference to our WebSocket server
    var wsServer = worker.getWSServer();
    
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

## Contribute to SocketCluster

- Tests needed - While some of the underlying modules of SC are well tested, 
it would be nice to add some higher-level tests to help maintain high code quality.
- Benchmarks - It would be nice to have some formal benchmarks comparing SocketCluster's performance with alternatives to 
get a better view of its strengths and weaknesses. Also having some graphs to prove that SocketCluster scales linearly as
you add more workers/CPUs would be nice. This has been verified informally with a few CPU cores, but more thorough testing would be welcome!
- Speed - More speed is always better!

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
    
### SocketWorker

A SocketWorker object is passed as the argument to your workerController's run(worker) function.
Example - Inside worker.js:

```js
module.exports.run = function (worker) {
    // worker here is an instance of SocketWorker
};
```

### ClusterServer

A ClusterServer instance is returned from worker.getWSServer() - You use it to handle WebSocket connections.

## Benchmarks

### Benchmark #1 (v0.9.6, 08/05/2014)

#### Procedure

For this CPU benchmark, we compared Socket.io with SocketCluster on an 8-core Amazon EC2 m3.2xlarge instance running Linux.
For this test, a new client (connection) was opened every 5 seconds - As soon as the connection was established, 
each new client immediately started sending messages at a rate of 1000 messages per second to the server.
These messages were dispatched through a 'ping' event which had an object {param: 'pong'} as payload.
The server's logic in handling the message was pretty basic - It would simply count the number of such messages received and log the value every 10 seconds.

#### Observations

* When run as a single process on a single CPU core, SocketCluster performs worse than Socket.io.
* As you add more CPU cores and more processes (proportional to the number of cores), SocketCluster quickly catches up. SocketCluster became worthwhile as soon as you added a second CPU core.
* Until a certain point, traffic was not distributed exactly evenly between the SocketCluster load balancers - Initially, one of the load balancer processes was handling more than 2 times
as much load as the next one.
* As the strain on that load balancer increased to around the 50% CPU mark, other load balancers started picking up the slack... This must have something to do with way the OS does
its round robin balancing.
* The test was only set to reach up to 100 concurrent connections (each sending 1000 messages per second) - Total of 100K messages per second. SocketCluster was still in decent shape.

#### Screenshots

![alt tag](https://raw.github.com/topcloud/socketcluster/master/benchmarks/socketcluster_socket_io_test_1.png)


### Benchmark #2 (v0.9.8, 12/05/2014)

#### Procedure

For this CPU benchmark, we tested SocketCluster on an 8-core Amazon EC2 m3.2xlarge instance running Linux.
The test procedure here was similar to Benchmark #1 with a few changes:
* Instead of connecting a new client every 5 seconds, we created a new one every second.
* The maximum number of connections created was set at 170K.
* The messages were fully bidirectional this time - The client sent a 'ping' event containing a JavaScript object (cast to JSON) like in Benchmark #1 but instead of just counting it,
the server responded to that ping event with a 'pong' event.
* Fewer processes were used this time: 5 load balancers, 5 workers and 2 stores.

#### Observations

* An upgrade to the loadbalancer module to v0.9.12 resulted in much more even distribution between workers.
Older versions of loadbalancer tended to not respond as well to large, sudden traffic spikes.
The new version of loadbalancer uses an algorithm which leverages random probability with deterministic 'bad luck' correction to make sure that the load is spread evenly between workers.
* The processes settings were poorly tuned in the previous benchmark - It's wasteful to use many more processes than you have CPU cores.
* Using fewer processes resulted in a very healthy load average of 3.33 (out of a possible 8). We could probably have pushed well past 200K connections with our current setup.
The setup of 5 load balancer, 5 workers and 2 stores is still not ideal - Maybe one more worker process would have brought the perfect balance?
