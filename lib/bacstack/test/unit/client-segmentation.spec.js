'use strict';

const expect = require('chai').expect;
const Client = require('../../lib/client');
const apdu = require('../../lib/apdu');
const npdu = require('../../lib/npdu');
const services = require('../../lib/services');
const enums = require('../../lib/enum');
const utils = require('./client-utils');

describe('bacstack - isolated segmented responses', () => {
  let client;
  let transport;
  const address = '192.168.1.10';
  beforeEach(() => {
    transport = new utils.Transport();
    client = new Client({transport: transport, apduTimeout: 100});
  });
  afterEach(() => client.close());

  const read = (callback, destination) => client.readProperty(address, destination, {type: 8, instance: 42}, 77, {}, callback);
  const payload = value => utils.readAck(0, value).slice(9);
  const segment = (id, sequence, more, data, source, window) => {
    const packet = utils.packet(buffer => {
      apdu.encodeComplexAck(buffer, enums.PduTypes.COMPLEX_ACK | enums.PduConReqBits.SEGMENTED_MESSAGE | (more ? enums.PduConReqBits.MORE_FOLLOWS : 0), enums.ConfirmedServiceChoice.READ_PROPERTY, id, sequence, window === undefined ? 2 : window);
      data.copy(buffer.buffer, buffer.offset);
      buffer.offset += data.length;
    }, source);
    transport.emit('message', packet, address, 47808);
  };
  const acknowledgements = () => transport.sent.filter(item => (item.buffer[4 + npdu.decode(item.buffer, 4).len] & 240) === enums.PduTypes.SEGMENT_ACK);

  it('reassembles interleaved responses independently by transaction', () => {
    const results = [];
    read((err, value) => {
      expect(err).to.equal(null);
      results.push(value.values[0].value);
    });
    read((err, value) => {
      expect(err).to.equal(null);
      results.push(value.values[0].value);
    });
    const first = utils.request(transport.sent[0]).invokeId;
    const second = utils.request(transport.sent[1]).invokeId;
    const a = payload('first');
    const b = payload('second');
    segment(first, 0, true, a.slice(0, 5));
    segment(second, 0, true, b.slice(0, 5));
    segment(second, 1, false, b.slice(5));
    segment(first, 1, false, a.slice(5));
    expect(results).to.deep.equal(['second', 'first']);
    expect(client._segmentStore.size).to.equal(0);
  });

  it('routes segment acknowledgements back to the BACnet source', () => {
    const source = {net: 20, adr: [7]};
    let result;
    read((err, value) => {
      expect(err).to.equal(null);
      result = value;
    }, source);
    const id = utils.request(transport.sent[0]).invokeId;
    const data = payload('routed');
    segment(id, 0, true, data.slice(0, 5), source);
    const ack = acknowledgements()[0];
    expect(ack.receiver.net).to.equal(20);
    expect(npdu.decode(ack.buffer, 4).destination.adr).to.deep.equal([7]);
    expect(npdu.decode(ack.buffer, 4).hopCount).to.equal(255);
    segment(id, 1, false, data.slice(5), source);
    expect(result.values[0].value).to.equal('routed');
  });

  it('acknowledges the initial segment, full windows and the final segment', () => {
    read(() => {});
    const id = utils.request(transport.sent[0]).invokeId;
    const data = payload('window');
    segment(id, 0, true, data.slice(0, 2));
    expect(acknowledgements().length).to.equal(1);
    segment(id, 1, true, data.slice(2, 4));
    expect(acknowledgements().length).to.equal(1);
    segment(id, 2, true, data.slice(4, 6));
    expect(acknowledgements().length).to.equal(2);
    segment(id, 3, false, data.slice(6));
    expect(acknowledgements().length).to.equal(3);
  });

  it('rejects gaps and acknowledges duplicates without appending duplicate payloads', () => {
    let value;
    read((err, result) => {
      expect(err).to.equal(null);
      value = result.values[0].value;
    });
    const id = utils.request(transport.sent[0]).invokeId;
    const data = payload('duplicates');
    segment(id, 0, true, data.slice(0, 5));
    segment(id, 0, true, data.slice(0, 5));
    segment(id, 2, false, data.slice(5));
    const ack = acknowledgements()[2].buffer;
    const offset = 4 + npdu.decode(ack, 4).len;
    expect(ack[offset] & enums.PduSegAckBits.NEGATIVE_ACK).not.to.equal(0);
    segment(id, 1, false, data.slice(5));
    expect(value).to.equal('duplicates');
  });

  it('handles sequence-number wraparound without restarting reassembly', () => {
    const expected = Array.from({length: 300}, () => ({type: enums.ApplicationTags.UNSIGNED_INTEGER, value: 42}));
    let actual;
    read((err, result) => {
      expect(err).to.equal(null);
      actual = result.values;
    });
    const id = utils.request(transport.sent[0]).invokeId;
    const data = utils.packet(buffer => {
      apdu.encodeComplexAck(buffer, enums.PduTypes.COMPLEX_ACK, enums.ConfirmedServiceChoice.READ_PROPERTY, id);
      services.readProperty.encodeAcknowledge(buffer, {type: 8, instance: 42}, 77, enums.ASN1_ARRAY_ALL, expected);
    }).slice(9);
    for (let i = 0; i < data.length; i++) {
      segment(id, i % 256, i !== data.length - 1, data.slice(i, i + 1));
    }
    expect(actual).to.deep.equal(expected);
  });

  it('ignores invalid window sizes without corrupting a valid transaction', () => {
    let actual;
    read((err, result) => {
      expect(err).to.equal(null);
      actual = result.values[0].value;
    });
    const id = utils.request(transport.sent[0]).invokeId;
    const data = payload('valid');
    segment(id, 0, true, data.slice(0, 5), null, 0);
    expect(client._segmentStore.size).to.equal(0);
    segment(id, 0, true, data.slice(0, 5));
    segment(id, 1, false, data.slice(5));
    expect(actual).to.equal('valid');
  });

  it('refreshes the segmented-response timeout without clearing another transaction', (done) => {
    client.close();
    client = new Client({transport: transport, apduTimeout: 70});
    let timedOut = false;
    read(err => {
      expect(err.message).to.equal('ERR_TIMEOUT');
      timedOut = true;
    });
    read((err, result) => {
      expect(err).to.equal(null);
      expect(timedOut).to.equal(true);
      expect(result.values[0].value).to.equal('slow');
      done();
    });
    const id = utils.request(transport.sent[1]).invokeId;
    const data = payload('slow');
    segment(id, 0, true, data.slice(0, 3));
    setTimeout(() => segment(id, 1, true, data.slice(3, 6)), 45);
    setTimeout(() => segment(id, 2, false, data.slice(6)), 95);
  });
});
