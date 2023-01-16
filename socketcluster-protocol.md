# SocketCluster Protocol

## Overview

SocketCluster protocol is implemented on top of the WebSockets protocol and consists of multiple components:
- Handshake
- Connection health check (ping/pong)
- Event layer
- Pub/Sub layer
- Authentication layer

Minimal requirements for a simple SocketCluster compatible client are to implement:  
Handshake, ping/pong and (at least partially) the Event layer.  

Pub/Sub and Authentication layers are completely optional.


### Contrast between Protocol V1 and V2

- SocketCluster <=v14 uses Protocol v1.  
  SocketCluster >=v15 uses Protocol v2 by default and supports `protocolVersion` configuration option, which allows it to work with clients which use Protocol v1.  

- SocketCluster <=v14 doesn't send back Handshake event response, if `cid` is not specified in Handshake event.  
  SocketCluster >=v15 always sends back Handshake event response, regardles of `cid` presence. If `cid` is not present in Handshake event, `rid` is omitted from Handshake event response.  

- In SocketCluster >=v15 `#disconnect` event is deprecated and no longer in use.  

- Protocol V1 uses `'#1'` and `'#2'` for ping/pong
  Protocol V2 uses empty strings `''` for both.  

- In Protocol V1 all event names starting with `'#'` are considered reserved for special control events.  
  In Protocol V2 only a handful of event names starting with `'#'` are considered reserved.  


### Reserved event names

Protocol V1:  

- All event names starting with `'#'`  

Protocol V2:  
- `#handshake`
- `#publish`
- `#subscribe`
- `#unsubscribe`
- `#kickOut`
- `#authenticate`
- `#setAuthToken`
- `#removeAuthToken`


### Call ID & Response ID

`cid` - Call ID  
`rid` - Response ID  

Some events require acknowledgement from another side of communication, in other words they expect event responses.  
In order to track which event responses belong to which events, `cid` and `rid` exist in SocketCluster Protocol.  


`cid` must be unique for each event sent, during the whole socket connection lifetime.  
Call IDs originated from server and Call IDs originated from client are two different sets of ids and are being appointed and tracked separately.  

`cid`, included in events sent from `socketcluster-server` to a SocketCluster client, for each new socket connection, will always start with number `1` and will be incremented with each event sent.

In your custom SocketCluster client you could use something like `UUID` strings for `cid` but, for efficiency, it's recommended to also use number `1` and increment it with each subsequent event sent.  


Some special events expect no response, hence `cid` for them is not required and ignored if present.  

---

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
  // a number starting a 1 and incrementing it with each event sent.
  // For additional efficiency, you only need to specify the cid if you expect a response (rid) from
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
  // In SC, an event message may have a cid; a response message must have a matching rid.
  // You should only have a single matching response for each cid.
  "rid": 11,

  // Any JSON-compatible data type (e.g. String, Number, Date, Object) sent back by the server.
  "data": responseData
}
```

Note that if you receive an event message from the server, you can optionally send back a response message to this by sending a JSON string like that one above
to the server - But you need to make sure that the rid you provide matches the cid of the original event.

In SC, sending back a response to an event is always optional (depends on user logic); the client or server might decide to throw an error if a response to an event has not been received after a certain timeout or it could have no timeout.

As an example; for the SocketCluster JavaScript client, if the user provides a callback to the `socket.emit('eventName', data, callback)` then we will throw an error if the server does not send back a response after ackTimeout. However, if the user does not provide a callback to `socket.emit('eventName', data)` then the client will assume that we don't expect a response to that event and so it will not throw an error in that case.


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
This is to account for scenarios were a connection might close without sending a proper WebSocket close control frame.
For example, if the user's internet drops out suddenly, there would be no way to tell that the socket is no longer connected.

For the ping/pong protocol, the SocketCluster server will periodically send a ping message to the client and the client has to answer every ping with a pong message.

The ping message which comes from the server is just an empty string (``).

Whenever you get this message from the WebSocket, your client needs to send back an empty string as soon as possible.

Note that there are three kinds of strings which have special meaning within SocketCluster:

1. Ping/pong empty strings
2. Event packets (I.e. JSON objects that have an `event` property)
3. Response packets (I.e. JSON objects that have an `rid` property)

Every other kind of string/binary packet will be interpreted as a raw message and should trigger a `raw` event on the client socket.


### The pub/sub layer

Coming soon....

