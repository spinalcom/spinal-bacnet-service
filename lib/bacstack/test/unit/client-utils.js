'use strict';

const EventEmitter = require('events').EventEmitter;
const bvlc = require('../../lib/bvlc');
const npdu = require('../../lib/npdu');
const apdu = require('../../lib/apdu');
const services = require('../../lib/services');
const enums = require('../../lib/enum');

class Transport extends EventEmitter {
  constructor() {
    super();
    this.sent = [];
  }
  getBroadcastAddress() {
    return '192.168.1.255';
  }
  getMaxPayload() {
    return 1482;
  }
  open() {}
  close() {}
  send(buffer, length, receiver, next) {
    const item = {buffer: Buffer.from(buffer.slice(0, length)), receiver: receiver, next: next};
    this.sent.push(item);
    if (this.onSend) this.onSend(item);
  }
}

const packet = (encode, source, forwarded) => {
  const result = {buffer: Buffer.alloc(1482), offset: forwarded ? 10 : 4};
  npdu.encode(result, 0, null, source);
  encode(result);
  bvlc.encode(result.buffer, forwarded ? enums.BvlcResultPurpose.FORWARDED_NPDU : enums.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU, result.offset);
  if (forwarded) {
    forwarded.address.split('.').forEach((part, index) => result.buffer[4 + index] = Number(part));
    result.buffer.writeUInt16BE(forwarded.port || 47808, 8);
  }
  return result.buffer.slice(0, result.offset);
};

module.exports = {
  Transport: Transport,
  packet: packet,
  request: (item) => {
    const offset = 4 + npdu.decode(item.buffer, 4).len;
    return apdu.decodeConfirmedServiceRequest(item.buffer, offset);
  },
  simpleAck: (id, service, source) => packet(buffer => apdu.encodeSimpleAck(buffer, enums.PduTypes.SIMPLE_ACK, service || enums.ConfirmedServiceChoice.WRITE_PROPERTY, id), source),
  readAck: (id, value, source) => packet(buffer => {
    apdu.encodeComplexAck(buffer, enums.PduTypes.COMPLEX_ACK, enums.ConfirmedServiceChoice.READ_PROPERTY, id);
    services.readProperty.encodeAcknowledge(buffer, {type: 8, instance: 42}, 77, enums.ASN1_ARRAY_ALL, [{type: enums.ApplicationTags.CHARACTER_STRING, value: value}]);
  }, source),
  iAm: (source, forwarded) => packet(buffer => {
    apdu.encodeUnconfirmedServiceRequest(buffer, enums.PduTypes.UNCONFIRMED_REQUEST, enums.UnconfirmedServiceChoice.I_AM);
    services.iAmBroadcast.encode(buffer, 42, 1476, enums.Segmentation.NO_SEGMENTATION, 7);
  }, source, forwarded)
};
