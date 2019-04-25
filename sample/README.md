SocketCluster Sample App
======

This is an example of a basic SC application, which is used as a blueprint for bootstrapping new SC applications via `socketcluster create myApp` command.
Do not use it directly, it lacks some files, which are created via SC cli as a part of bootstrapping process.
In order to get fully functional copy of this app, execute the following commands:

```sh
npm install -g socketcluster
socketcluster create myApp
cd myApp
node server.js
```