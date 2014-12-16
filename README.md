SocketCluster
======

[![SocketCluster logo](https://raw.github.com/topcloud/socketcluster/master/assets/logo.png)](http://socketcluster.io/)

Complete documentation available at: http://socketcluster.io/

## Change log

**14 November 2014** (v1.0.1)

Updated http://socketcluster.io/ documentation (partially).

v1.0.1 is not a drop-in upgrade. It involves some major changes to the client-side API (documented on website).
Before this version, SC made no explicit distinction between pub/sub channels and regular client <=> server events.
By listening to an event, the socket was implicitly subscribing to a channel by the same name.
This feature was nice but it also masked a lot of the complexity behind SC and made handling events vs channels ambiguous and took
away flexibility from the developer.

The goal of this release is to make SC a viable open-source alternative to commercial realtime services like PubNub, Pusher, Firebase, etc...
But without you having to give up control over your backend.

Here is some sample code which demonstrates how to use the new API:

```js
// Subscribe to a channel

var fooChannel = socket.subscribe('foo');
// or
socket.subscribe('foo'); // We don't necessarily need the channel object

```

```js
// Subscribe events

// Note that subscribe will only fail if explicitly blocked by middleware.
// If the connection drops out, the subscription will stay pending until 
// the connection comes back.

fooChannel.on('subscribeFail', function (err, channelName) {
 // ...
});

fooChannel.on('subscribe', function (channelName) {
 // ...
});

socket.on('subscribeFail', function (err, channelName) {
  // ...
});

socket.on('subscribe', function (channelName) {
  // ...
});
```

```js
// Watch incoming channel data

fooChannel.watch(function (data) {
  // This function will run whenever data is published
  // to the foo channel.
});
// or
socket.watch('foo', function (data) {
  // This function will run whenever data is published
  // to the foo channel.
});
```

```js
// Publish data to a channel

fooChannel.publish(12345);             // publish from channel
// or
socket.channel('foo').publish(12345);  // same as above
// or
socket.publish('foo', 12345);          // publish from socket
// or
socket.publish('foo', {a: 123, b: 4}); // objects are valid too
```

```js
fooChannel.unsubscribe();  // unsubscribe from channel
// or
socket.unsubscribe('foo'); // unsubscribe using socket
```

```js
// Emit events between client and server.
// This is the same as before.

socket.emit('greeting', {from: 'alice', message: 'Hello'});
```

```js
// Listen to events emitted on socket.
// Same as before.

socket.on('greeting', function (data) {
 // ...
});
```


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

- More test cases needed - Add unit tests.
- Efficiency/speed - faster is better!

To contribute; clone this repo, then cd inside it and then run npm install to install all dependencies.

## License

MIT