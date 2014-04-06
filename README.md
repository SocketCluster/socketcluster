SocketCluster
======

SocketCluster is a WebSocket server cluster (with HTTP long-polling fallback) based on engine.io.
Unlike other realtime engines, SocketCluster deploys itself as cluster in order to make use of all CPUs/cores on
a machine/instance - This offers a more consistent performance for users and lets you scale vertically without limits.
SocketCluster workers are highly parallelized - Asymptotically speaking, SocketCluster is N times faster than any other 
available WebSocket server (where N is the number of CPUs/cores available on your machine).
SocketCluster was designed to be lightweight and its API is almost identical to Socket.io.

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

## How to use

The following example launches SocketCluster as 7 distinct processes (in addition to the current master process):
- 3 workers on ports 9100, 9101, 9102
- 3 stores on ports 9001, 9002, 9003
- 1 load balancer on port 8000 which distributes requests evenly between the 3 workers

```js
var socketCluster = new SocketCluster({
    workers: [9100, 9101, 9102],
    stores: [9001, 9002, 9003],
    balancerCount: 1, // Optional
    port: 8000,
    appName: 'myapp',
    workerController: 'worker.js'
});
```

The appName option can be any string which uniquely identifies this application.
This avoids potential issues with having multiple SocketCluster apps run under the same domain
- It is used internally for various purposes.

The workerController option is the path to a file which each SocketCluster worker will use to bootstrap itself.
This file is a standard Node.js module which must expose a run() function - Inside this run function is where you should
put all your application logic.

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
    
    /*
        In here we handle our incoming WebSocket connections and listen for events.
        From here onwards is just like Socket.io.
    */
    wsServer.on('connection', function (socket) {
        setInterval(function () {
            socket.emit('rand', Math.floor(Math.random() * 100));
        }, 1000);
    });
};
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
}
```

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
}
```

### ClusterServer

A ClusterServer instance is returned from worker.getWSServer() - You use it to handle WebSocket connections.