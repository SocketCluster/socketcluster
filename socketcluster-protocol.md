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

## Handshake

As soon as you establish a WebSocket connection, you are to send a special Handshake event for `socketcluster-server` to initiate the socket.  
Clients are not allowed to interact with the server before Handshake.  

#### **Handshake event** is a JSON-encoded string with the following structure:

```js
{
  event: '#handshake'

  // [optional] A JSON-compatible Object
  data: { },

  // [optional] Call ID
  cid: 1
}
```

`socketcluster-server` <=v14:  
- If `cid` was specified in the Handshake event, `socketcluster-server` will send back Handshake event response with matching `rid`.  
If `cid` was not specified, no Handshake event response will be sent.  

`socketcluster-server` >=v15:  
- Whether or not `cid` was specified in the Handshake event, `socketcluster-server` will always send back Handshake event response.  
If `cid` was specified in the Handshake event, Handshake event response will include matching `rid`.  
If `cid` was not specified, `rid` will be omitted.  

#### **Handshake event response** is a JSON-encoded string with the following structure:

```js
{
  data: {
    // A unique ID, assigned to this socket connection by the server
    id: 'Y7gRvz-hVW_uXx5qAAH',

    // Value of `pingTimeout` configuration option of the server
    pingTimeout: 20000, // ms

    // Look at the Authentication layer overview for more information
    isAuthenticated: false
  }

  // [optional] Response ID
  rid: 1,
}
```

---

## Connection health check (ping/pong)

`socketcluster-server` periodically sends ping messages to connected clients to check whether or not a connection is still alive.  
A SocketCluster client has to answer every ping message with pong message as soon as possible.  

#### **Protocol V1:**  
Ping message (from server) is a String: `'#1'`  
Pong message (from client) is a String: `'#2'`  
#### **Protocol V2:**  
Ping message (from server) is an empty String: `''`  
Pong message (from client) is an empty String: `''`  

Ping/pong mechanism is required to account for cases when a connection might be closed without sending a proper SocketCluster `#disconnect`\* event or WebSockets `Close` control frame.  
For example, if a user's internet drops out suddenly, there would be no way to tell that the `socket` is no longer connected otherwise.  

\* \- In Protocol V2 `#disconnect` event is deprecated and no longer in use.

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

---

### The pub/sub layer

Coming soon....

