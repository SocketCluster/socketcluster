SocketCluster
======

[![Join the chat at https://gitter.im/SocketCluster/socketcluster](https://badges.gitter.im/Join%20Chat.svg)](https://gitter.im/SocketCluster/socketcluster?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge)

[![SocketCluster logo](https://raw.github.com/SocketCluster/socketcluster/master/assets/logo.png)](http://socketcluster.io/)

Complete documentation available at: http://socketcluster.io/

## Change log

**16 January 2016** (v4.2.0)

- The schedulingPolicy option (http://socketcluster.io/#!/docs/api-socketcluster) is now 'rr' by default (except on Windows) - After doing some stress testing on large 8-core Linux EC2 instances, the 'rr' policy turned out to be much better at distributing load across multiple CPU cores. The downside of the 'rr' policy is that all connections pass through
a central master process but that process turned out to be extremely efficient. It's not a perfect solution but it's much better than letting the Linux OS handle it.

**05 January 2016** (v4.0.0)

- Middleware functions used to have different arguments (depending on the middleware type); now they are all in the format ```function (req, next) {...}```.
The ```req``` object will have different properties depending on the middleware type. See addMiddleware() method here: http://socketcluster.io/#!/docs/api-scserver
- When invoking ```socket.emit``` or ```socket.publish``` - When a callback was provided, it would emit an 'error' event on the socket if the operation failed.
This is no longer the case - The callback will still receive the error as the first argument like it used to (assuming that there was an error), but it
just won't be emitted as an 'error' event on the socket - It is considered an application error (not an SC error).
- The 'notice' event was replaced with a 'warning' event - This is more consistent with the convention used in most other frameworks.
- You can now pass custom error objects to the ```next(err)``` callback inside middleware functions; this is now recommended instead of plain strings.
The ```err``` object you provide can inherit from the ```Error``` object (but this isn't necessary). It is recommended that whatever object you provide has
a ```name``` and a ```message``` property; you can also add custom properties to your error object and the client will receive those as rehydrated ```Error``` objects. Note that this is a non-breaking change - You can still pass a string as ```err``` and it won't break anything.
- On the server-side, the ```socket.removeAuthToken()``` method was replaced by ```socket.deauthenticate()```.

This release introduces many other non-breaking changes.

- See RFC: https://github.com/SocketCluster/socketcluster/issues/137
- The docs have been updated on the website. See http://socketcluster.io/

**22 November 2015** (v3.0.0)

- The defaultAuthTokenExpiryInMinutes and defaultAuthTokenExpiry config options have been removed - Use authDefaultExpiry instead (value is in seconds).
- Ping and pong are now represented as raw messages '#1' and '#2' instead of '1' and '2' - This is to avoid potential conflicts with user logic when
using the raw ```socket.send(...)``` method.

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


## Contribute to SocketCluster

- More integration test cases needed
- Unit tests
- Efficiency/speed - faster is better!
- Suggestions?

To contribute; clone this repo, then cd inside it and then run npm install to install all dependencies.

## License

(The MIT License)

Copyright (c) 2013-2015 SocketCluster.io

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the 'Software'), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
