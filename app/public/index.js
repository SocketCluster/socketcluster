import { create } from '/socketcluster-client.min.js';

// Initiate the connection to the server
let socket = create();

(async () => {
  for await (let { error } of socket.listener('error')) {
    console.error(error);
  }
})();

(async () => {
  for await (let event of socket.listener('connect')) {
    console.log('Socket is connected');
  }
})();
