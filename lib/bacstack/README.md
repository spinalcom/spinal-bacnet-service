# Node BACstack

A BACnet protocol stack written in pure JavaScript. BACnet is a protocol to
interact with building automation devices defined by ASHRAE.

[![](https://badge.fury.io/js/bacstack.svg)](http://badge.fury.io/js/bacstack)
[![](https://travis-ci.org/fh1ch/node-bacstack.svg?branch=master)](https://travis-ci.org/fh1ch/node-bacstack)
[![](https://coveralls.io/repos/fh1ch/node-bacstack/badge.svg?branch=master)](https://coveralls.io/r/fh1ch/node-bacstack?branch=master)
[![](https://codeclimate.com/github/fh1ch/node-bacstack/badges/gpa.svg)](https://codeclimate.com/github/fh1ch/node-bacstack)
[![](https://david-dm.org/fh1ch/node-bacstack/status.svg)](https://david-dm.org/fh1ch/node-bacstack)

## Usage

Add Node BACstack to your project by using:

``` sh
npm install --save bacstack
```

The API documentation is available under **[fh1ch.github.io/node-bacstack](https://fh1ch.github.io/node-bacstack)**.

### Discovery across networks

IP broadcasts do not normally cross IP routers or VLANs. Choose the path that
matches your installation; the library cannot infer an unknown BBMD/router or
configure network equipment for you.

```js
const Bacnet = require('bacstack');
const client = new Bacnet({
  interface: '192.168.1.10',
  broadcastAddress: '192.168.1.255',
  apduTimeout: 6000,
  maxParallelRequests: 4
});
client.on('error', console.error);
client.on('iAm', device => {
  // address/port identify the IP device or router, not the forwarding BBMD.
  // SADR identifies the device behind a BACnet router, when present.
  const receiver = Object.assign({
    address: device.address,
    port: device.port
  }, device.SADR);
  client.readProperty(receiver, {type: 8, instance: device.deviceId}, 77,
    (err, result) => {
      if (err) return console.error(err);
      console.log(result);
    });
});

// Same IP subnet:
client.whoIs();

// Known BACnet/IP device on another IP subnet (requires IP connectivity):
client.whoIs({address: '192.168.2.10'});

// BACnet router, e.g. IP to MS/TP: global or specific network discovery.
client.whoIs({address: '192.168.1.20', dest: {net: 65535}});
client.whoIs({address: '192.168.1.20', dest: {net: 100}});
```

For broadcast discovery on a remote BACnet/IP subnet, configure a BBMD there
to accept Foreign Device Registration. Register before calling `whoIs()`:

```js
client.registerForeignDevice({address: '192.168.2.1', port: 47808}, 60, err => {
  if (err) return console.error(err);
  client.whoIs(); // Distribute-Broadcast-To-Network via the registered BBMD.
});
```

Registration is accepted only after a successful BVLC result from the BBMD.
It renews automatically at 75% of the TTL. Failed initial registration is
reported to the callback; failed renewal emits `error`. Broadcast discovery
is blocked after registration fails/expires rather than silently falling back
to a local broadcast. Call `registerForeignDevice()` again to retry a failed
registration. `close()` stops renewal; the BBMD entry expires after its TTL.
Explicit unicast discovery remains available independently of registration.

Existing routed calls with a separate destination remain supported:
`readProperty(ip, SADR, objectId, propertyId, options, callback)`,
`readPropertyMultiple(ip, SADR, requests, options, callback)` and
`writeProperty(ip, SADR, objectId, propertyId, values, options, callback)`.
An endpoint `{address, port, net, adr}` can also be passed instead of an IP to
confirmed services; omit `net`/`adr` for direct BACnet/IP devices.

Allow bidirectional UDP traffic (usually port 47808), select the correct
interface, and use a broadcast-capable network for local discovery. Docker
bridge networks, VPNs and NAT may require explicit network configuration.
BBMD and BACnet routing do not bypass firewalls or solve arbitrary NAT setups.

### Parallel requests and timeouts

Confirmed requests are queued FIFO, with **16 active requests per client** by
default (`maxParallelRequests`, range 1..256). Start with 1-4 for slow devices
or MS/TP networks. This is a global limit, not a per-device limit. Timeouts
start when a request is dispatched, not while it waits in the queue.

Active invoke IDs are not reused, and explicit IDs (including zero) must be
unique among active and queued requests. Conflicts return
`ERR_INVOKE_ID_IN_USE` to the callback. Segmented responses are assembled
independently per peer, routed source and transaction; accepted segments
refresh that transaction's inactivity timeout.

`apduTimeout` is not a discovery timeout: Who-Is is unconfirmed and responses
arrive as `iAm` events. Increasing it does not fix missing network routes.
Requests are not automatically retried, particularly to avoid repeating writes.
`close()` cancels active and queued requests with `ERR_CLIENT_CLOSED`.
In the enclosing service, an individual request timeout no longer resets the
shared client; explicit client reset remains available.

### Features

The BACNET standard defines a wide variety of services as part of it's
specification. While Node BACstack tries to be as complete as possible,
following services are already supported at this point in time:

| Service                        | Execute                                                                                | Handle                                                                        |
|--------------------------------|:--------------------------------------------------------------------------------------:|:-----------------------------------------------------------------------------:|
| Who Is                         | [yes](https://fh1ch.github.io/node-bacstack/bacstack.html#.whoIs)                      | [yes](https://fh1ch.github.io/node-bacstack/bacstack.html#.event:whoIs)       |
| I Am                           | yes¹                                                                                   | [yes](https://fh1ch.github.io/node-bacstack/bacstack.html#.event:iAm)         |
| Who Has                        | yes¹                                                                                   | yes¹                                                                          |
| I Have                         | yes¹                                                                                   | yes¹                                                                          |
| Time Sync                      | [yes](https://fh1ch.github.io/node-bacstack/bacstack.html#.timeSync)                   | [yes](https://fh1ch.github.io/node-bacstack/bacstack.html#.event:timeSync)    |
| UTC Time Sync                  | [yes](https://fh1ch.github.io/node-bacstack/bacstack.html#.timeSyncUTC)                | [yes](https://fh1ch.github.io/node-bacstack/bacstack.html#.event:timeSyncUTC) |
| Read Property                  | [yes](https://fh1ch.github.io/node-bacstack/bacstack.html#.readProperty)               | yes¹                                                                          |
| Read Property Multiple         | [yes](https://fh1ch.github.io/node-bacstack/bacstack.html#.readPropertyMultiple)       | yes¹                                                                          |
| Read Range                     | yes¹                                                                                   | yes¹                                                                          |
| Write Property                 | [yes](https://fh1ch.github.io/node-bacstack/bacstack.html#.writeProperty)              | yes¹                                                                          |
| Write Property Multiple        | [yes](https://fh1ch.github.io/node-bacstack/bacstack.html#.writePropertyMultiple)      | yes¹                                                                          |
| Add List Element               | yes¹                                                                                   | yes¹                                                                          |
| Remove List Element            | yes¹                                                                                   | yes¹                                                                          |
| Create Object                  | yes¹                                                                                   | yes¹                                                                          |
| Delete Object                  | yes¹                                                                                   | yes¹                                                                          |
| Subscribe COV                  | yes¹                                                                                   | yes¹                                                                          |
| Subscribe Property             | yes¹                                                                                   | yes¹                                                                          |
| Atomic Read File               | yes¹                                                                                   | yes¹                                                                          |
| Atomic Write File              | yes¹                                                                                   | yes¹                                                                          |
| Reinitialize Device            | [yes](https://fh1ch.github.io/node-bacstack/bacstack.html#.reinitializeDevice)         | yes¹                                                                          |
| Device Communication Control   | [yes](https://fh1ch.github.io/node-bacstack/bacstack.html#.deviceCommunicationControl) | yes¹                                                                          |
| Get Alarm Summary              | yes¹                                                                                   | yes¹                                                                          |
| Get Event Information          | yes¹                                                                                   | yes¹                                                                          |
| Get Enrollment Summary         | yes¹                                                                                   | yes¹                                                                          |
| Acknowledge Alarm              | yes¹                                                                                   | yes¹                                                                          |
| Confirmed Event Notification   | yes¹                                                                                   | yes¹                                                                          |
| Unconfirmed Event Notification | yes¹                                                                                   | yes¹                                                                          |
| Unconfirmed Private Transfer   | yes¹                                                                                   | yes¹                                                                          |
| Confirmed Private Transfer     | yes¹                                                                                   | yes¹                                                                          |

¹ Support implemented as Beta (untested, undocumented, breaking interface)

### Example

``` js
const bacnet = require('bacstack');

// Initialize BACStack
const client = new bacnet({apduTimeout: 6000});

// Discover Devices
client.on('iAm', (device) => {
  console.log('address: ', device.address);
  console.log('deviceId: ', device.deviceId);
  console.log('maxApdu: ', device.maxApdu);
  console.log('segmentation: ', device.segmentation);
  console.log('vendorId: ', device.vendorId);
});
client.whoIs();

// Read Device Object
const requestArray = [{
  objectId: {type: 8, instance: 4194303},
  properties: [{id: 8}]
}];
client.readPropertyMultiple('192.168.1.43', requestArray, (err, value) => {
  console.log('value: ', value);
});
```

## Contributing

Implementing and maintaining a protocol stack is a lot of work, therefore any
help is appreciated, from creating issues, to contributing documentation, fixing
issues and adding new features.

Please follow the [Contribution Guide](CONTRIBUTING.md) when submitting any
changes.

## License

[The MIT License](http://opensource.org/licenses/MIT)

Copyright (c) 2017-2018 Fabio Huser <fabio@fh1.ch>

**Note:** This is not an official product of the BACnet Advocacy Group. BACnet®
is a registered trademark of American Society of Heating, Refrigerating and
Air-Conditioning Engineers (ASHRAE).
