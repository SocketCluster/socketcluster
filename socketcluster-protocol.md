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

## Event layer

Event layer is responsible for `one-to-one` communication between a particular socket connection and the server.

### Basic part
Basic part of the Event layer is responsible for transmitting and receiving user-defined events.  
API example from JavaScript `socketcluster-client` v17:
```js
// transmit an event to the server
socket.transmit('eventName', data)

// receive events from the server
for await (const data of socket.receiver('eventName')) {
  console.info('received data', data)
}
```
For more in depth knowledge on API visit https://socketcluster.io/docs/basic-usage  


#### **Transmitted event** is a JSON-encoded string with the following structure:

```js
{
  // Arbitrary name of the event*
  event: 'eventName',

  // [optional] Any JSON-compatible data
  data: eventData,
}
```
\* \- Some event names starting with `'#'` are [reserved for special control events](#Reserved-event-names) in SocketCluster Protocol.  

Transmitted events never expect responses.  
Even if `action.TRANSMIT` was blocked within `agServer.MIDDLEWARE_INBOUND`, no response will be sent.  


### Advanced part

Advanced part of the Event layer is responsible for invoking and processing **Remote Procedure Calls**.  
API example from JavaScript `socketcluster-client` v17:
```js
// invoke a remote procedure on the server
const responseData = await socket.invoke('procedureName', data)

// process remote procedure calls from the server
for await (const request of socket.procedure('procedureName')) { 
  console.info('received data', request.data)
  request.end(dataToReturnToServer)
}
```

Transmitted events and RPC are similar in structure. They share the same property `event` for their names, but they are different entities.  
In order to invoke a RPC, a SocketCluster client should send a RPC request.  
Unlike transmitted events, every RPC request must include a unique `cid` (Call ID), because every RPC expects a RPC response with matching `rid` (Response ID) from another side of communication.  

#### **RPC request** is a JSON-encoded string with the following structure:
```js
{
  // Call ID
  cid: 12345,

  // Arbitrary name of the procedure*
  event: 'procedureName',

  // [optional] Any JSON-compatible data
  data: procedureData
}
```
\* \- Some procedure names starting with `'#'` are [reserved for special control events](#Reserved-event-names) in SocketCluster Protocol.


When the RPC request is processed, a RPC response should be sent back.  

#### **Successful RPC response** is a JSON-encoded string with the following structure:

```js
{
  // Response ID
  rid: 12345,

  // [optional] Any JSON-compatible data
  data: responseData
}
```

If the RPC request was blocked within `agServer.MIDDLEWARE_INBOUND`, then the argument, which was provided to the `action.block(err)` method, will be included into the RPC response as `error` property.  
If no argument was provided to the `action.block()` method, the `error` will contain default SocketCluster `SilentMiddlewareBlockedError`:  

#### **Unsuccessful RPC response** is a JSON-encoded string with the following structure:
```js
{
  rid: 12345,

  error: {
    message: 'The invoke AGAction was blocked by inbound middleware',
    name: 'SilentMiddlewareBlockedError',
    type: 'inbound'
  }
}
```

Every RPC response must include `rid` exactly matching `cid` of the respective RPC.  
As an example, let's invoke a RPC from the server side.  
API example from `socketcluster-server` v17:
```js
try {
  const responseData = await socket.invoke('procedureName', data)
} catch (err) {
  if (err.name === 'TimeoutError') {
    // ...
  }
}
```

If no response with matching `rid` will be received from a client, the `socket.invoke` method will throw `TimeoutError`, after time interval specified in `ackTimeout` configuration option of the server.

Most of the [SocketCluster clients](https://github.com/SocketCluster/client-drivers) follow the same logic.  
A SocketCluster client sets a timer (alike `setTimeout`) for each RPC sent, with consideration of `cid`. Those timers expose a `TimeoutError` when are finished. And if the client receives a RPC response with `rid` matching `cid` of one of the ongoing timers, the client destroys the timer before it fires up.

---

## Pub/Sub layer

Pub/Sub layer is responsible for `one-to-many` communication between a particular socket connection or a particular SocketCluster worker and unlimited amount of connected sockets, which are subscribed to a Pub/Sub channel.  

### Subscribe

In order to subscribe a socket connection to a Pub/Sub channel, a SocketCluster client should send to server a subscription request.  
API example from JavaScript `socketcluster-client` v17:  
```js
const channel = socket.subscribe('channelName')
for await (const message of channel) {
  console.info(message)
}
```

#### **Subscription request** is a JSON-encoded string with the following structure:

```js
{
  event: '#subscribe',

  data: {
    // Arbitrary name of the channel to subscribe to
    channel: 'channelName'
  },

  cid: 12345
}
```

When subscription request will be processed, `socketcluster-server` will send back subscription response with matching `rid`. So the client would know it's successfully subscribed to the channel.  

#### **Successful subscription response** is a JSON-encoded string with the following structure:
```js
{
  rid: 12345
}
```

If the subscription request was blocked within `agServer.MIDDLEWARE_INBOUND`, then the argument, which was provided to the `action.block(err)` method, will be included into the subscription response as `error` property.  
If no argument was provided to the `action.block()` method, the `error` will contain default SocketCluster `SilentMiddlewareBlockedError`:  

#### **Unsuccessful subscription response** is a JSON-encoded string with the following structure:

```js
{
  rid: 12345,

  error: {
    message: 'The subscribe AGAction was blocked by inbound middleware',
    name: 'SilentMiddlewareBlockedError',
    type: 'inbound'
  }
}
```


### Publish

In order to publish a message to a Pub/Sub channel, a SocketCluster client should send to server a publish request.  
API example from JavaScript `socketcluster-client` v17:  
```js
// transmitPublish will not include `cid`
socket.transmitPublish('channelName', messageData)

// invokePublish will include `cid`
const responseData = await socket.invokePublish('channelName', messageData)
```

#### **Publish request** is a JSON-encoded string with the following structure:

```js
{
  event: '#publish',

  data: {
    // Name of the channel to publish message to
    channel: 'channelName',
    // [optional] Any JSON-compatible data
    data: messageData
  },

  // [optional]
  cid: 12345
}
```

If `cid` was specified, `socketcluster-server` will send back publish response with matching `rid`. So the client would know the sent message was successfully published to the channel.  

#### **Successful publish response** is a JSON-encoded string with the following structure:  

```js
{
  rid: 12345
}
```

If `cid` was specified and the publish request was blocked within `agServer.MIDDLEWARE_INBOUND`, then the argument, which was provided to the `action.block(err)` method, will be included into the publish response as `error` property.  
If no argument was provided to the `action.block()` method, the `error` will contain default SocketCluster `SilentMiddlewareBlockedError`:  

#### **Unsuccessful publish response** is a JSON-encoded string with the following structure:  

```js
{
  rid: 12345,

  error: {
    message: 'The publishIn AGAction was blocked by inbound middleware',
    name: 'SilentMiddlewareBlockedError',
    type: 'inbound'
  }
}
```


If `cid` was not specified in the publish request, no publish response will be sent even if the request was unsuccessful.

### Unsubscribe

In order to unsubscribe a socket connection from a Pub/Sub channel, a SocketCluster client should send to server unsubscription event.  

#### **Unsubscription event** is a JSON-encoded string with the following structure:  

```js
{
  event: '#unsubscribe',

  // Name of a channel to unsubscribe from
  data: 'channelName',

  // [optional] Call ID
  cid: 12345
}
```

When unsubscription event will be processed, `socketcluster-server` will send back unsubscription event response with matching `rid`. So the client would know it's successfully unsubscribed from the channel.  

#### **Unsubscription event response** is a JSON-encoded string with the following structure:  

```js
{
  rid: 12345
}
```

If no `cid` was specified in the unsubscription event, no unsubscription event response will be sent.  

### Kick out

It's possible, from server side, to forcibly unsubscribe a socket connection from one or more particular Pub/Sub channels or from all Pub/Sub channels at once.  
API example from `socketcluster-server` v17:
```js
socket.kickOut(['channelName', 'channelName2'], 'custom message')
```
In that case a SocketCluster client will receive a special `#kickOut` event. Or multiple events, if it was kicked from multiple channels. One per each channel it was kicked from.

#### **kickOut event** is a JSON-encoded string with the following structure:  

```js
{
  event: '#kickOut',

  data: {
    // Name of the channel the socket connection was kicked from
    channel: 'channelName',

    // [optional] a message provided to the socket.kickOut method
    message: 'custom message'
  }
}
```
