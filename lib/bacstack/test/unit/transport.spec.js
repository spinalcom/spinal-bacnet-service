'use strict';

const expect = require('chai').expect;
const dgram = require('dgram');
const Transport = require('../../lib/transport');

describe('bacstack - UDP transport', () => {
  it('queues sends until bound and preserves sender ports on receive', (done) => {
    const peer = dgram.createSocket('udp4');
    const transport = new Transport({port: 0, interface: '127.0.0.1'});
    transport.on('error', done);
    peer.on('error', done);
    peer.bind(0, '127.0.0.1', () => {
      const port = peer.address().port;
      peer.once('message', (buffer, rinfo) => {
        expect(buffer.toString()).to.equal('hello');
        peer.send(Buffer.from('reply'), rinfo.port, rinfo.address);
      });
      transport.once('message', (buffer, address, sourcePort) => {
        expect(buffer.toString()).to.equal('reply');
        expect(address).to.equal('127.0.0.1');
        expect(sourcePort).to.equal(port);
        transport.close();
        peer.close(done);
      });
      transport.open();
      const message = Buffer.from('hello');
      transport.send(message, message.length, {address: '127.0.0.1', port: port});
      message.fill(0);
    });
  });

  it('emits socket errors on error rather than passing them to the packet decoder', (done) => {
    const transport = new Transport({port: 0, interface: '127.0.0.1'});
    let messages = 0;
    transport.on('message', () => messages++);
    transport.open();
    transport.once('listening', () => {
      const expected = new Error('socket failure');
      transport.once('error', err => {
        expect(err).to.equal(expected);
        expect(messages).to.equal(0);
        transport.close();
        done();
      });
      transport._server.emit('error', expected);
    });
  });

  it('propagates asynchronous send errors to the caller', (done) => {
    const transport = new Transport({port: 0, interface: '127.0.0.1'});
    transport.open();
    transport.once('listening', () => {
      transport.send(Buffer.alloc(65508), 65508, {address: '127.0.0.1', port: 47808}, err => {
        expect(err).to.be.instanceOf(Error);
        expect(err.code).to.equal('EMSGSIZE');
        transport.close();
        done();
      });
    });
  });

  it('reports invalid receiver ports through the send callback', (done) => {
    const transport = new Transport({port: 0, interface: '127.0.0.1'});
    transport.open();
    transport.once('listening', () => {
      transport.send(Buffer.from('hello'), 5, {address: '127.0.0.1', port: 0}, err => {
        expect(err).to.be.instanceOf(RangeError);
        transport.close();
        done();
      });
    });
  });
});
