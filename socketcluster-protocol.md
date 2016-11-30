# SocketCluster Protocol V1

## Overview

SocketCluster implements a protocol on top of the WebSockets protocol to allow clients to communicate with a SocketCluster server.
This protocol is made up of multiple layers (some of which are optional), these are:
- The event layer
- The pub/sub layer [optional]
- The authentication layer [optional]

In order to make a simple SC client, you do not need to implement all the layers - Only the first 'event layer' is required - This
will allow your client to expose a `socket.emit('eventName', data)` and `socket.on('eventName', handlerFunction)`.

### The event layer

**Emitted events**

An emitted event is a simple JSON string with this format:

```
{
  // The name of the event
  event: 'eventName',

  // Any JSON-compatible data type (e.g. String, Number, Date, Object).
  data: eventData,

  // Each emitted event can have call ID (if specified, it needs to be unique for the life of the
  // client session) - You can use UUID strings, but for efficiency, we recommend using
  // a number starting a 1 and incrementing that it with each event sent.
  // For efficiency, you only need to specify the cid if you expect a response (rid) from
  // the other side of the connection.
  cid: 11
}
```

To emit an event, you just need to send a JSON string like the one above through an open WebSocket connection linked to a SocketCluster server.
Note that the server might also emit event messages to the client - You should listen for those incoming messages on the WebSocket; they will have the same format as above.


**Event responses**

Whenever a client emits an event to the server, the server can (optionally) send a matching response to that event in the following format:

```
{
  // In SC, every event message has a cid and every response message has a matching rid.
  // You should only have a single matching response for each cid.
  "rid": 11,

  // Any JSON-compatible data type (e.g. String, Number, Date, Object) sent back by the server.
  "data": responseData
}
```

Note that if you receive an event message from the server, you can optionally send back a response message to this by sending a JSON string like that one above
to the server - But you need to make sure that the rid you provide matches the cid of the original event.

It does not matter where the event originated (from the server or the client), an event must have a unique cid and a response (if sent) must have a matching rid.

In SC, sending back a response to an event is always optional (depends on user logic); the client or server might decide to throw an error if a response to an event has not been received
after a certain timeout or it could have no timeout.

As an example; for the SocketCluster JavaScript client, if the user provides a callback to the `socket.emit('eventName', data, callback)` then we will throw an error if the server does not
send back a response after ackTimeout. However, if the user does not provide a callback to `socket.emit('eventName', data)` then the client will assume that we don't expect a response to that event and so it will not throw an error in that case.


**The SocketCluster handshake**

Before you can send custom events to the SocketCluster server, you first need to establish a WebSocket connection to a SocketCluster server and then perform a handshake to initiate the socket.

As soon as the WebSocket connection is opened, your client should emit a special `#handshake` event to the server, the `#handshake` event message should look like this:

```
{
  event: '#handshake',

  // To implement authentication, we will need to pass an object here, but
  // we don't need to worry about this for now - So you can just leave
  // this as an empty object.
  data: {},

  // This can be any number/string, just make sure that it is unique for the life of the client session.
  cid: 1
}
```

As soon as it receives the event, your server should send back a handshake response event message in this format:

```
{
  // The rid will match the cid from the #handshake event.
  "rid": 1,
  "data": {
    // This is the ID for the SC connection assigned by the server.
    "id": "Y7Uw-jHCJP-gld4QAAAA",

    // Because we did not send any auth token, this will be false.
    "isAuthenticated": false,

    // SC uses a ping/pong mechanism for checking if a connection is alive.
    // This value is the number of milliseconds of inactivity after which the SC server
    // will mark this connections as dead.
    "pingTimeout": 10000
  }
}
```


**Ping and pong - Connection health check**

As mentioned above, SC has a ping/pong mechanism for checking whether or not a connection is still alive.
This is to account for scenarios were a connection might close without sending a proper `#disconnect` event or close control frame (more on this later).
For example, if the user's internet drops out suddenly, there would be no way to tell that the socket is no longer connected.

The protocol for ping/pong is simple.
The SocketCluster server will periodically send a ping message to the client and the client has to answer every ping with a pong message.

The ping message which comes from the server is just the string:

`#1`

Whenever you get this message from the WebSocket, your client needs to send back this string as soon as possible:

`#2`

We chose to use the strings `#1` and `#2` to minimize bandwidth consumption.


### The pub/sub layer

Coming soon....
