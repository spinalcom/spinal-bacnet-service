'use strict';

const expect = require('chai').expect;
const Client = require('../../lib/client');
const npdu = require('../../lib/npdu');
const bvlc = require('../../lib/bvlc');
const dgram = require('dgram');
const utils = require('./client-utils');

describe('bacstack - client discovery and BBMD', () => {
  let client;
  let transport;
  beforeEach(() => {
    transport = new utils.Transport();
    client = new Client({transport: transport, apduTimeout: 30});
  });
  afterEach(() => client.close());

  it('sends local broadcast and directed unicast with the correct BVLC function', () => {
    client.whoIs();
    client.whoIs({address: '192.168.2.10'});
    expect(transport.sent[0].buffer[1]).to.equal(11);
    expect(transport.sent[0].receiver).to.equal('192.168.1.255');
    expect(transport.sent[1].buffer[1]).to.equal(10);
    expect(transport.sent[1].receiver).to.equal('192.168.2.10');
  });

  it('supports global and specific BACnet network discovery through a router', () => {
    client.whoIs({address: '192.168.2.1', dest: {net: 65535}});
    client.whoIs({address: '192.168.2.1', dest: {net: 10, adr: [5]}});
    const global = npdu.decode(transport.sent[0].buffer, 4);
    const specific = npdu.decode(transport.sent[1].buffer, 4);
    expect(global.destination.net).to.equal(65535);
    expect(global.hopCount).to.equal(255);
    expect(specific.destination.adr).to.deep.equal([5]);
    expect(specific.destination.net).to.equal(10);
  });

  it('uses the original device IP and port from forwarded I-Am messages', () => {
    let device;
    client.on('iAm', result => device = result);
    transport.emit('message', utils.iAm(null, {address: '192.168.2.9', port: 47809}), '192.168.1.1', 47808);
    expect(device.address).to.equal('192.168.2.9');
    expect(device.port).to.equal(47809);
    expect(device.SADR).to.equal(null);
  });

  it('does not leak a routed source into the next directly connected device', () => {
    const devices = [];
    client.on('iAm', result => devices.push(result));
    transport.emit('message', utils.iAm({net: 10, adr: [5]}), '192.168.1.1', 47808);
    transport.emit('message', utils.iAm(), '192.168.1.9', 47808);
    expect(devices[0].SADR.net).to.equal(10);
    expect(devices[1].SADR).to.equal(null);
  });

  it('registers before distributing discovery through a BBMD', () => {
    let registered = false;
    client.registerForeignDevice({address: '192.168.2.1', port: 47809}, 60, err => {
      expect(err).to.equal(null);
      registered = true;
    });
    expect(transport.sent[0].buffer).to.deep.equal(Buffer.from([129, 5, 0, 6, 0, 60]));
    expect(() => client.whoIs()).to.throw('ERR_FOREIGN_DEVICE_NOT_REGISTERED');
    transport.emit('message', Buffer.from([129, 0, 0, 6, 0, 0]), '192.168.2.8', 47809);
    expect(registered).to.equal(false);
    transport.emit('message', Buffer.from([129, 0, 0, 6, 0, 0]), '192.168.2.1', 47809);
    expect(registered).to.equal(true);
    client.whoIs({dest: {net: 65535}});
    expect(transport.sent[1].buffer[1]).to.equal(9);
    expect(transport.sent[1].receiver).to.deep.equal({address: '192.168.2.1', port: 47809});
  });

  it('reports BBMD rejection, blocks broadcast fallback and permits registration retry', () => {
    let error;
    client.registerForeignDevice('192.168.2.1', 60, err => error = err);
    transport.emit('message', Buffer.from([129, 0, 0, 6, 0, 48]), '192.168.2.1', 47808);
    expect(error.message).to.contain('ERR_FOREIGN_DEVICE_REGISTRATION');
    expect(() => client.whoIs()).to.throw('ERR_FOREIGN_DEVICE_NOT_REGISTERED');
    client.registerForeignDevice('192.168.2.1', 60, () => {});
    expect(transport.sent.length).to.equal(2);
  });

  it('reports missing BBMD responses without leaving a registration pending', (done) => {
    client.registerForeignDevice('192.168.2.1', 60, err => {
      expect(err.message).to.equal('ERR_FOREIGN_DEVICE_REGISTRATION_TIMEOUT');
      expect(client._bbmd.pending).to.equal(null);
      expect(client._bbmd.registered).to.equal(false);
      done();
    });
  });

  it('reports registration send failures and cancels pending registration on close', () => {
    const sendError = new Error('EHOSTUNREACH');
    transport.onSend = item => item.next(sendError);
    let failure;
    client.registerForeignDevice('192.168.2.1', 60, err => failure = err);
    expect(failure).to.equal(sendError);
    transport.onSend = null;
    client.registerForeignDevice('192.168.2.1', 60, err => failure = err);
    client.close();
    expect(failure.message).to.equal('ERR_CLIENT_CLOSED');
  });

  it('invalidates registration when the BBMD refuses broadcast distribution', () => {
    client.registerForeignDevice('192.168.2.1', 60, () => {});
    transport.emit('message', Buffer.from([129, 0, 0, 6, 0, 0]), '192.168.2.1', 47808);
    let failure;
    client.on('error', err => failure = err);
    transport.emit('message', Buffer.from([129, 0, 0, 6, 0, 96]), '192.168.2.1', 47808);
    expect(failure.message).to.equal('BVLC_RESULT - Code:96');
    expect(() => client.whoIs()).to.throw('ERR_FOREIGN_DEVICE_NOT_REGISTERED');
  });

  it('renews registration automatically and clears its timer on close', (done) => {
    client.registerForeignDevice('192.168.2.1', 1, err => expect(err).to.equal(null));
    transport.emit('message', Buffer.from([129, 0, 0, 6, 0, 0]), '192.168.2.1', 47808);
    transport.onSend = item => {
      expect(item.buffer[1]).to.equal(5);
      expect(item.buffer.readUInt16BE(4)).to.equal(1);
      transport.emit('message', Buffer.from([129, 0, 0, 6, 0, 0]), '192.168.2.1', 47808);
      const bbmd = client._bbmd;
      client.close();
      expect(bbmd.renewal._destroyed).to.equal(true);
      done();
    };
  });

  it('rejects truncated BVLC headers, forwarded packets and invalid NPDUs', () => {
    expect(bvlc.decode(Buffer.from([129, 4, 0, 4]), 0)).to.equal(undefined);
    expect(bvlc.decode(Buffer.from([129, 0, 0, 4]), 0)).to.equal(undefined);
    expect(() => transport.emit('message', Buffer.from([129, 10, 0, 6, 2, 0]), '192.168.1.1')).not.to.throw();
    expect(() => client.registerForeignDevice('invalid', 60, () => {})).to.throw(RangeError);
    expect(() => client.registerForeignDevice('192.168.1.1', 0, () => {})).to.throw(RangeError);
  });

  it('discovers via a UDP BBMD and reads directly from the forwarded device address', (done) => {
    client.close();
    const bbmd = dgram.createSocket('udp4');
    const device = dgram.createSocket('udp4');
    bbmd.on('error', done);
    device.on('error', done);
    bbmd.bind(0, '127.0.0.2', () => {
      const port = bbmd.address().port;
      device.bind(port, '127.0.0.3', () => {
        bbmd.on('message', (buffer, remote) => {
          if (buffer[1] === 5) {
            bbmd.send(Buffer.from([129, 0, 0, 6, 0, 0]), remote.port, remote.address);
          } else {
            expect(buffer[1]).to.equal(9);
            bbmd.send(utils.iAm(null, {address: '127.0.0.3', port: port}), remote.port, remote.address);
          }
        });
        device.on('message', (buffer, remote) => {
          const request = utils.request({buffer: buffer});
          device.send(utils.readAck(request.invokeId, 'remote-device'), remote.port, remote.address);
        });
        client = new Client({interface: '127.0.0.1', port: port, apduTimeout: 1000});
        client.on('error', done);
        client.once('iAm', found => {
          expect(found.address).to.equal('127.0.0.3');
          expect(found.port).to.equal(port);
          client.readProperty({address: found.address, port: found.port}, {type: 8, instance: found.deviceId}, 77, (err, result) => {
            expect(err).to.equal(null);
            expect(result.values[0].value).to.equal('remote-device');
            client.close();
            device.close(() => bbmd.close(done));
          });
        });
        client.registerForeignDevice({address: '127.0.0.2', port: port}, 60, err => {
          expect(err).to.equal(null);
          client.whoIs();
        });
      });
    });
  });
});
