'use strict';

const expect = require('chai').expect;
const Client = require('../../lib/client');
const npdu = require('../../lib/npdu');
const services = require('../../lib/services');
const enums = require('../../lib/enum');
const utils = require('./client-utils');

describe('bacstack - parallel client transactions', () => {
  let client;
  let transport;
  const address = '192.168.1.10';
  const objectId = {type: 8, instance: 42};
  beforeEach(() => {
    transport = new utils.Transport();
    client = new Client({transport: transport, apduTimeout: 40, maxParallelRequests: 4});
  });
  afterEach(() => client.close());

  const read = (callback, options) => client.readProperty(address, objectId, 77, options || {}, callback);
  const respond = (item, value) => transport.emit('message', utils.readAck(utils.request(item).invokeId, value), address, 47808);

  it('bounds concurrency and completes 600 parallel requests with matching responses', () => {
    let completed = 0;
    const results = [];
    for (let i = 0; i < 600; i++) {
      read((err, result) => {
        expect(err).to.equal(null);
        expect(result.values[0].value).to.equal('value-' + i);
        results.push(result.values[0].value);
        completed++;
      });
    }
    expect(transport.sent.length).to.equal(4);
    let index = 0;
    while (completed < 600) {
      const active = transport.sent.slice(index, index + 4);
      expect(new Set(active.map(item => utils.request(item).invokeId)).size).to.equal(active.length);
      active.reverse().forEach(item => {
        expect(Object.keys(client._invokeStore).length).to.be.at.most(4);
        respond(item, 'value-' + transport.sent.indexOf(item));
        index++;
      });
    }
    expect(results.length).to.equal(600);
    expect(new Set(results).size).to.equal(600);
    expect(client._requestQueue.length).to.equal(0);
    expect(Object.keys(client._invokeStore).length).to.equal(0);
  });

  it('supports the full 256 invoke IDs without overwriting active callbacks', () => {
    client.close();
    client = new Client({transport: transport, maxParallelRequests: 256});
    let completed = 0;
    for (let i = 0; i < 300; i++) read(() => completed++);
    expect(transport.sent.length).to.equal(256);
    expect(new Set(transport.sent.map(item => utils.request(item).invokeId)).size).to.equal(256);
    for (let i = 0; i < 300; i++) respond(transport.sent[i], 'ok');
    expect(completed).to.equal(300);
  });

  it('preserves explicit invokeId zero and rejects duplicates and invalid IDs', () => {
    read(() => {}, {invokeId: 0});
    expect(utils.request(transport.sent[0]).invokeId).to.equal(0);
    let error;
    read(err => error = err, {invokeId: 0});
    expect(error.message).to.equal('ERR_INVOKE_ID_IN_USE');
    read(err => error = err, {invokeId: 256});
    expect(error).to.be.instanceOf(RangeError);
    expect(transport.sent.length).to.equal(1);
  });

  it('does not allocate an automatic ID reserved by a queued explicit request', () => {
    client.close();
    client = new Client({transport: transport, maxParallelRequests: 1});
    read(() => {});
    read(() => {});
    read(() => {}, {invokeId: 1});
    respond(transport.sent[0], 'ok');
    expect(utils.request(transport.sent[1]).invokeId).not.to.equal(1);
    respond(transport.sent[1], 'ok');
    expect(utils.request(transport.sent[2]).invokeId).to.equal(1);
  });

  it('registers callbacks before sending, including synchronous transport responses', () => {
    transport.onSend = item => respond(item, 'immediate');
    let value;
    read((err, result) => {
      expect(err).to.equal(null);
      value = result.values[0].value;
    });
    expect(value).to.equal('immediate');
    expect(Object.keys(client._invokeStore).length).to.equal(0);
  });

  it('ignores responses from the wrong device, port or service', () => {
    let completed = false;
    read(() => completed = true);
    const id = utils.request(transport.sent[0]).invokeId;
    transport.emit('message', utils.readAck(id, 'wrong'), '192.168.1.11', 47808);
    transport.emit('message', utils.readAck(id, 'wrong'), address, 47809);
    transport.emit('message', utils.simpleAck(id), address, 47808);
    expect(completed).to.equal(false);
    respond(transport.sent[0], 'correct');
    expect(completed).to.equal(true);
  });

  it('routes legacy SADR reads and only accepts responses from that BACnet device', () => {
    const source = {net: 10, adr: [5]};
    let completed = false;
    client.readProperty(address, source, objectId, 77, {}, (err, result) => {
      expect(err).to.equal(null);
      expect(result.values[0].value).to.equal('routed');
      completed = true;
    });
    const item = transport.sent[0];
    expect(npdu.decode(item.buffer, 4).destination.net).to.equal(10);
    expect(npdu.decode(item.buffer, 4).hopCount).to.equal(255);
    transport.emit('message', utils.readAck(utils.request(item).invokeId, 'wrong', {net: 10, adr: [6]}), address, 47808);
    expect(completed).to.equal(false);
    transport.emit('message', utils.readAck(utils.request(item).invokeId, 'routed', source), address, 47808);
    expect(completed).to.equal(true);
  });

  it('supports routed endpoints with a non-default UDP port', () => {
    const receiver = {address: address, port: 47809, net: 20, adr: [7]};
    let completed = false;
    client.readProperty(receiver, objectId, 77, (err) => {
      expect(err).to.equal(null);
      completed = true;
    });
    const item = transport.sent[0];
    expect(item.receiver).to.deep.equal(receiver);
    transport.emit('message', utils.readAck(utils.request(item).invokeId, 'ok', {net: 20, adr: [7]}), address, 47809);
    expect(completed).to.equal(true);
  });

  it('preserves array index zero and explicit no-segmentation capability', () => {
    read(() => {}, {arrayIndex: 0, maxSegments: 0, maxApdu: 0});
    const item = transport.sent[0];
    const request = utils.request(item);
    const offset = 4 + npdu.decode(item.buffer, 4).len + request.len;
    expect(request.maxSegments).to.equal(0);
    expect(request.maxApdu).to.equal(0);
    expect(request.type & enums.PduConReqBits.SEGMENTED_RESPONSE_ACCEPTED).to.equal(0);
    expect(services.readProperty.decode(item.buffer, offset, item.buffer.length - offset).property.index).to.equal(0);
  });

  it('starts queued request timeouts only when sent', (done) => {
    client.close();
    client = new Client({transport: transport, maxParallelRequests: 1, apduTimeout: 40});
    read(err => expect(err.message).to.equal('ERR_TIMEOUT'));
    read((err, result) => {
      expect(err).to.equal(null);
      expect(result.values[0].value).to.equal('queued');
      done();
    });
    transport.onSend = item => respond(item, 'queued');
  });

  it('reports send failures and continues draining the queue', () => {
    let failures = 0;
    transport.onSend = item => item.next(new Error('EHOSTUNREACH'));
    for (let i = 0; i < 20; i++) read(err => {
      expect(err.message).to.equal('EHOSTUNREACH');
      failures++;
    });
    expect(failures).to.equal(20);
    expect(Object.keys(client._invokeStore).length).to.equal(0);
  });

  it('ignores late send errors after an invoke ID has been reused', () => {
    read(() => {}, {invokeId: 7});
    const first = transport.sent[0];
    respond(first, 'first');
    let completed = false;
    read(err => {
      expect(err).to.equal(null);
      completed = true;
    }, {invokeId: 7});
    first.next(new Error('late send failure'));
    expect(completed).to.equal(false);
    respond(transport.sent[1], 'second');
    expect(completed).to.equal(true);
  });

  it('cancels active and queued requests once without later timeouts', (done) => {
    let closed = 0;
    let timeouts = 0;
    client.on('timeout', () => timeouts++);
    for (let i = 0; i < 8; i++) read(err => {
      expect(err.message).to.equal('ERR_CLIENT_CLOSED');
      closed++;
    });
    client.close();
    client.close();
    expect(closed).to.equal(8);
    expect(client._segmentStore.size).to.equal(0);
    setTimeout(() => {
      expect(timeouts).to.equal(0);
      expect(closed).to.equal(8);
      done();
    }, 60);
  });

  it('rejects requests after close and invalid parallelism settings', () => {
    expect(() => new Client({transport: transport, maxParallelRequests: 0})).to.throw(RangeError);
    expect(() => new Client({transport: transport, maxParallelRequests: 257})).to.throw(RangeError);
    client.close();
    let error;
    read(err => error = err);
    expect(error.message).to.equal('ERR_CLIENT_CLOSED');
  });
});
