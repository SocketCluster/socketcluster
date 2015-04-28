SocketCluster
======

[![SocketCluster logo](https://raw.github.com/topcloud/socketcluster/master/assets/logo.png)](http://socketcluster.io/)

Complete documentation available at: http://socketcluster.io/

## Change log

**29 April 2015** (v2.2.4)

- All timeout and interval values provided to SocketCluster constructor now have to be in milliseconds instead of seconds.


**8 March 2015** (v2.0.2)

Updated http://socketcluster.io/ documentation.

### API changes

In order to prepare SocketCluster for a smooth transition to version 2 over the next few years, some big changes were 
made to the API which will affect v1:
- The Session object (socket.session) on the server no longer exists as of version 1.3.0.
The concept of a session has been superseded by a token-based authentication system (See http://socketcluster.io/#!/docs/authentication).
- Server-side channel entities were introduced - The scServer.global (http://socketcluster.io/#!/docs/api-global) object's subscribe() and channel() methods now 
return a server-side Channel object whose API matches that of the client-side SCChannel object (http://socketcluster.io/#!/docs/api-scchannel).
- The client-side socket (http://socketcluster.io/#!/docs/api-scsocket-client) object now emits a 'ready' event along with useful status info such as whether or not
the socket is authenticated with the server (has a valid auth token and hence the user doesn't need to login again).
- The second 'res' argument provided to the listener function in socket.on(event, listener) is now a function instead of an object with end() and error() methods.
To send an error, just call res('This is an error') or if you want to send back an error code; res(1234, 'This is the error message'). For success, just set the first argument to null; res(null, 'This is a normal response').

All these changes have been noted on the website.

### SocketCluster v2 Early Release

SocketCluster v2 is now available for download. SC2 is our attempt to prepare SocketCluster for a WebSocket-enabled future, as such, SC2 is
dropping support for all hacky long-polling fallback mechanisms which have been an architectural nightmare to manage in large deployments.
The WebSocket adoption rate in the browser is currently estimated at 85%+ and so we would like SC to cater for forward-thinking
developers/companies who are ready to make the bold move towards using pure WebSockets without fallback.
The major trade-off of SC2 is reduced browser support in exchange for significantly increased speed and efficiency (including 
significantly lower network IO overheads).

Some cases where this trade-off may be worthwhile include:
- Where the realtime aspect of the application is non-critical. For example, adding an optional chat feature to an existing app - Maybe users of older browsers can do without this feature.
- Where having an up to date browser is critical to using the application. For example an MMORPG or other online game where support for cutting-edge browser features is essential (e.g. WebGL, LocalStorage, WebWorkers, etc...).

V2 will be maintained and supported in parallel with v1 (fully backwards compatible).
Version 1 will remain the official version until it makes sense to switch to v2 (based on feedback from the community).

Since v1 is still the official version, if you want to use v2, you will need to use a different npm command:

```bash
// Instead of 'npm install -g socketcluster'
npm install -g sc2
```

Once installed, you should be able to invoke the 'sc2' command.
The sc2 command has the exact same sub-commands as the v1 'socketcluster' command.
For details, run:

```bash
sc2 --help
```

The npm package name for the client is **sc2-client**.


## Introduction

SocketCluster is a fast, highly scalable HTTP + realtime server engine which lets you build multi-process 
realtime servers that make use of all CPU cores on a machine/instance.
It removes the limitations of having to run your Node.js server as a single thread and makes your backend 
resilient by automatically recovering from worker crashes and aggregating errors into a central log.

Follow the project on Twitter: https://twitter.com/SocketCluster
Subscribe for updates: http://socketcluster.launchrock.com/

## Memory leak profile

SocketCluster has been tested for memory leaks.
The last full memory profiling was done on SocketCluster v0.9.17 (Node.js v0.10.28) and included checks on load balancer, worker and store processes.

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
For more details on how to use socketcluster-client, go to https://github.com/topcloud/socketcluster-client

It is recommended that you use Node.js version >=0.10.22 due to memory leaks present in older versions.

### Using over HTTPS

In order to run SocketCluster over HTTPS, all you need to do is set the protocol to 'https' and 
provide your private key and certificate as a start option when you instantiate SocketCluster - Example:

```js
var socketCluster = new SocketCluster({
  balancers: 1,
  workers: 3,
  stores: 3,
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

Note that SC lets your store your authentication tokens anywhere you like;
a database of your choice, Redis...

SocketCluster also lets you store session data using the socket.session object. 
This object gives you access to a cluster of in-memory stores called nData.
nData is mostly used internally to allow workers to communicate with one another but it's also useful
to store session-specific data. Note that if you want a user's auth token to span multiple sessions
(so that user doesn't have to log in again after their session expires), then you might want
to use a database to store the auth token instead of using the session object.

If you decide to use the socket.session object, you can invoke any of the methods 
documented here to store and retrieve session data:
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
scServer.addMiddleware(scServer.MIDDLEWARE_HANDSHAKE, function (req, next) {
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
scServer.addMiddleware(scServer.MIDDLEWARE_EVENT, function (socket, event, data, next) {
  if (event == 'bla') {
    next(new Error('bla event is not allowed for socket ' + socket.id + ' on session ' + socket.session.id));
  } else {
    next();
  }
});
```

## Contribute to SocketCluster

- More integration test cases needed
- Unit tests
- Efficiency/speed - faster is better!
- Suggestions?

To contribute; clone this repo, then cd inside it and then run npm install to install all dependencies.

## License

(The MIT License)

Copyright (c) 2013-2015 TopCloud

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the 'Software'), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.