# SCC Guide

SCC is a collection of services which allow you to easily deploy and scale SocketCluster to any number of machines.
SCC is designed to scale linearly and is optimized for running on Kubernetes but it can be setup without using an orchestrator.

SCC is made up of the following services:

- scc-worker (SocketCluster) https://github.com/SocketCluster/socketcluster
- scc-broker https://github.com/SocketCluster/scc-broker
- scc-state https://github.com/SocketCluster/scc-state
- scc-ingress (Kubernetes only)

## How it works

The **scc-worker** service can be made up of any number of regular SocketCluster instances - The main difference between running SocketCluster as a single instance vs running it as a cluster is that in cluster mode, you need to point each **scc-worker** instance to a working `scc-state` (state server) instance.

The **scc-broker** service can be made up of any number of **scc-broker** instances - This is a special backend-only service which is designed to broker
messages between multiple frontend-facing **scc-worker** instances. All the pub/sub channels in your entire system will be sharded evenly across available **scc-broker** instances.
Just like with the **scc-worker** instances above, each **scc-broker** instance needs to point to a state server in order to work.

The **scc-state** service is made up of a single instance - Its job is to dispatch the state of the cluster to all interested services to allow them to reshard themselves. The **scc-state** instance will notify all frontend **scc-worker** instances whenever a new backend **scc-broker** joins the cluster. This allows **scc-worker** instances to rebalance their pub/sub channels evenly across available brokers whenever a new **scc-broker** instance joins the cluster.
Note that SCC can continue to operate without any disruption of service while the **scc-state** instance is down/unavailable (see notes at the bottom of this page).

## Running on Kubernetes (recommended)

Running on Kubernetes (K8s) is easy; you just need to run all the `.yaml` files from the `kubernetes/` directory from the SocketCluster repo (https://github.com/SocketCluster/socketcluster/tree/master/kubernetes) using the `kubectl` command (one at a time):

```
kubectl create -f <service-deployment-or-ingress-definition.yaml>
```

By default, you should also add a TLS/SSL key and cert pair to your provider (Rancher has a page were you can just paste them in).
Or if you don't want to use a certificate (not recommended), you can just delete these lines from `scc-ingress.yaml` before you create it with `kubectl`:

```
  tls:
  - secretName: scc-tls-credentials
```

Note that the step above is crucial if you don't want to use TLS/SSL - Otherwise the ingress load balancer service will not show up on your Rancher control panel until you add some credentials with the name `scc-tls-credentials` to your Rancher control panel (See Infrastructure &gt; Certificates page).

## Running using Node.js directly

You can also run SCC using only Node.js version >= 10.x.x.
For simplicity, we will show you how to run everything on your localhost (`127.0.0.1`), but in practice, you will need to change `127.0.0.1` to an appropriate IP, host name or domain name.

First, you need to download each of these repositories to your machine(s):

- `git clone https://github.com/SocketCluster/scc-broker`
- `git clone https://github.com/SocketCluster/scc-state`

Then inside each repo, you should run `npm install` without any arguments to install dependencies.

Then you need to setup a new SocketCluster project to use as your user-facing instance.

Once you have the two repos mentioned earlier and your SocketCluster project setup, you should launch the state server first by
going inside your local **scc-state** repo and then running the command:

```
node server
```

Next, to launch a broker, you should navigate to your **scc-broker** repo and run the command:

```
SCC_STATE_SERVER_HOST='127.0.0.1' SCC_BROKER_SERVER_PORT='8888' node server
```

Finally, to run a frontend-facing SocketCluster instance, you can navigate to your project directory and run:

```
SCC_STATE_SERVER_HOST='127.0.0.1' SOCKETCLUSTER_PORT='8000' node server
```

You can add a second frontend-facing server by running (this time running on port 8001):

```
SCC_STATE_SERVER_HOST='127.0.0.1' SOCKETCLUSTER_PORT='8001' node server
```
Now if you navigate to either `localhost:8000` or `localhost:8001` in your browser, you should see that your pub/sub channels are shared between the two **scc-worker** instances.

Note that you can provide additional environment variables to various instances to set custom port numbers, passwords etc...
For more info, you can look inside the code in the `server.js` file in each repo and see what `process.env` vars are used.

When running multiples instances of any service on the same machine, make sure that the ports don't clash - Modify the `SCC_BROKER_SERVER_PORT` or `SOCKETCLUSTER_PORT` environment variable for each instance to make sure that they are unique.

## CAP theorem

User-facing instances in SCC are highly available (this was done to ensure that SCC is resilient against DDoS attacks).
Back end instances, on the other hand, are optimized for consistency and efficiency. SCC is designed to quickly recover from failure of back end instances (a few seconds of partial missed messages at worst). Note that it's still possible to implement guaranteed delivery of messages by assigning a unique ID to each published message and resending messages which have not been acknowledged.

## Notes

You should only ever run a single **scc-state** per cluster - Note that the cluster can continue to operate without any disruption while **scc-state** is down.
**scc-state** only needs to be available for a few seconds while SCC is in the process of scaling itself up or down. Even if **scc-state** crashes while in the middle of scaling up, SCC will wait for **scc-state** to become available again (still without disruptions to the existing service) and will resume the scaling operation as soon as the **scc-state** instance becomes available again.
In the event of a crash, K8s will respawn **scc-state** within a few seconds so a failure of **scc-state** will only delay your scale up/down operation at worst.
Nevertheless, it is recommended that you run the **scc-state** instance inside your datacenter/AWS availability zone and do not expose it to the public internet.

The **scc-state** instance does not handle any pub/sub messages and so it is not a bottleneck with regards to the scalability of your cluster (SCC scales linearly).

Note that you can launch the services in any order you like but if your state server is not available, you may get harmless `Socket hung up` warnings on other instances (while they keep trying to reconnect) until **scc-state** becomes available again.
