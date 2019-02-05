# AGC Guide

AGC is a collection of services which allow you to easily deploy and scale Asyngular to any number of machines.
AGC is designed to scale linearly and is optimized for running on Kubernetes but it can be setup without using an orchestrator.

AGC is made up of the following services:

- agc-worker (asyngular) https://github.com/SocketCluster/asyngular
- agc-broker https://github.com/SocketCluster/agc-broker
- agc-state https://github.com/SocketCluster/agc-state
- agc-ingress (Kubernetes only)

## How it works

The **agc-worker** service can be made up of any number of regular Asyngular instances - The main difference between running Asyngular as a single instance vs running it as a cluster is that in cluster mode, you need to point each **agc-worker** instance to a working `agc-state` (state server) instance.

The **agc-broker** service can be made up of any number of **agc-broker** instances - This is a special backend-only service which is designed to broker
messages between multiple frontend-facing **agc-worker** instances. All the pub/sub channels in your entire system will be sharded evenly across available **agc-broker** instances.
Just like with the **agc-worker** instances above, each **agc-broker** instance needs to point to a state server in order to work.

The **agc-state** service is made up of a single instance - Its job is to dispatch the state of the cluster to all interested services to allow them to reshard themselves. The **agc-state** instance will notify all frontend **agc-worker** instances whenever a new backend **agc-broker** joins the cluster. This allows **agc-worker** instances to rebalance their pub/sub channels evenly across available brokers whenever a new **agc-broker** instance joins the cluster.
Note that AGC can continue to operate without any disruption of service while the **agc-state** instance is down/unavailable (see notes at the bottom of this page).

## Running on Kubernetes (recommended)

Running on Kubernetes (K8s) is easy; you just need to run all the `.yaml` files from the `kubernetes/` directory from the Asyngular repo (https://github.com/SocketCluster/asyngular/tree/master/kubernetes) using the `kubectl` command (one at a time):

```
kubectl create -f <service-deployment-or-ingress-definition.yaml>
```

By default, you should also add a TLS/SSL key and cert pair to your provider (Rancher has a page were you can just paste them in).
Or if you don't want to use a certificate (not recommended), you can just delete these lines from `agc-ingress.yaml` before you create it with `kubectl`:

```
  tls:
  - secretName: agc-tls-credentials
```

Note that the step above is crucial if you don't want to use TLS/SSL - Otherwise the ingress load balancer service will not show up on your Rancher control panel until you add some credentials with the name `agc-tls-credentials` to your Rancher control panel (See Infrastructure &gt; Certificates page).

## Running using Node.js directly

You can also run AGC using only Node.js version >= 10.x.x.
For simplicity, we will show you how to run everything on your localhost (`127.0.0.1`), but in practice, you will need to change `127.0.0.1` to an appropriate IP, host name or domain name.

First, you need to download each of these repositories to your machine(s):

- `git clone https://github.com/SocketCluster/agc-broker`
- `git clone https://github.com/SocketCluster/agc-state`

Then inside each repo, you should run `npm install` without any arguments to install dependencies.

Then you need to setup a new Asyngular project to use as your user-facing instance.

Once you have the two repos mentioned earlier and your Asyngular project setup, you should launch the state server first by
going inside your local **agc-state** repo and then running the command:

```
node server
```

Next, to launch a broker, you should navigate to your **agc-broker** repo and run the command:

```
AGC_STATE_SERVER_HOST='127.0.0.1' AGC_BROKER_SERVER_PORT='8888' node server
```

Finally, to run a frontend-facing Asyngular instance, you can navigate to your asyngular project directory and run:

```
AGC_STATE_SERVER_HOST='127.0.0.1' ASYNGULAR_PORT='8000' node server
```

You can add a second frontend-facing server by running (this time running on port 8001):

```
AGC_STATE_SERVER_HOST='127.0.0.1' ASYNGULAR_PORT='8001' node server
```
Now if you navigate to either `localhost:8000` or `localhost:8001` in your browser, you should see that your pub/sub channels are shared between the two **agc-worker** instances.

Note that you can provide additional environment variables to various instances to set custom port numbers, passwords etc...
For more info, you can look inside the code in the `server.js` file in each repo and see what `process.env` vars are used.

When running multiples instances of any service on the same machine, make sure that the ports don't clash - Modify the `AGC_BROKER_SERVER_PORT` or `ASYNGULAR_PORT` environment variable for each instance to make sure that they are unique.

## CAP theorem

User-facing instances in AGC are highly available (this was done to ensure that AGC is resilient against DDoS attacks).
Back end instances, on the other hand, are optimized for consistency and efficiency. AGC is designed to quickly recover from failure of back end instances (a few seconds of partial missed messages at worst). Note that it's still possible to implement guaranteed delivery of messages by assigning a unique ID to each published message and resending messages which have not been acknowledged.

## Notes

You should only ever run a single **agc-state** per cluster - Note that the cluster can continue to operate without any disruption while **agc-state** is down.
**agc-state** only needs to be available for a few seconds while AGC is in the process of scaling itself up or down. Even if **agc-state** crashes while in the middle of scaling up, AGC will wait for **agc-state** to become available again (still without disruptions to the existing service) and will resume the scaling operation as soon as the **agc-state** instance becomes available again.
In the event of a crash, K8s will respawn **agc-state** within a few seconds so a failure of **agc-state** will only delay your scale up/down operation at worst.
Nevertheless, it is recommended that you run the **agc-state** instance inside your datacenter/AWS availability zone and do not expose it to the public internet.

The **agc-state** instance does not handle any pub/sub messages and so it is not a bottleneck with regards to the scalability of your cluster (AGC scales linearly).

Note that you can launch the services in any order you like but if your state server is not available, you may get harmless `Socket hung up` warnings on other instances (while they keep trying to reconnect) until **agc-state** becomes available again.
