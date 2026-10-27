'use strict';

// Util Modules
const EventEmitter      = require('events').EventEmitter;
const isIP              = require('net').isIP;
const debug             = require('debug')('bacstack');

// Local Modules
const baTransport       = require('./transport');
const baServices        = require('./services');
const baAsn1            = require('./asn1');
const baApdu            = require('./apdu');
const baNpdu            = require('./npdu');
const baBvlc            = require('./bvlc');
const baEnum            = require('./enum');

const DEFAULT_HOP_COUNT = 0xFF;
const BVLC_HEADER_LENGTH = 4;

/**
 * To be able to communicate to BACNET devices, you have to initialize a new bacstack instance.
 * @class bacstack
 * @param {object=} this._settings - The options object used for parameterizing the bacstack.
 * @param {number=} [options.port=47808] - BACNET communication port for listening and sending.
 * @param {string=} options.interface - Specific BACNET communication interface if different from primary one.
 * @param {string=} [options.broadcastAddress=255.255.255.255] - The address used for broadcast messages.
 * @param {number=} [options.apduTimeout=3000] - The timeout in milliseconds until a transaction should be interpreted as error.
 * @param {number=} [options.maxParallelRequests=16] - Maximum active confirmed requests (1..256); additional requests wait in a FIFO queue.
 * @example
 * const bacnet = require('bacstack');
 *
 * const client = new bacnet({
 *   port: 47809,                          // Use BAC1 as communication port
 *   interface: '192.168.251.10',          // Listen on a specific interface
 *   broadcastAddress: '192.168.251.255',  // Use the subnet broadcast address
 *   apduTimeout: 6000                     // Wait twice as long for response
 * });
 */
class Client extends EventEmitter {
  constructor(options) {
    super();

    options = options || {};

    this._invokeCounter = 1;
    this._invokeStore = {};

    this._segmentStore = new Map();
    this._requestQueue = [];
    this._closed = false;
    this._processingQueue = false;
    this._bbmd = null;

    this._settings = {
      port: options.port || 47808,
      interface: options.interface,
      transport: options.transport,
      broadcastAddress: options.broadcastAddress || '255.255.255.255',
      apduTimeout: options.apduTimeout || 3000,
      maxParallelRequests: options.maxParallelRequests === undefined ? 16 : options.maxParallelRequests
    };
    if (!Number.isInteger(this._settings.maxParallelRequests) || this._settings.maxParallelRequests < 1 || this._settings.maxParallelRequests > 256) {
      throw new RangeError('maxParallelRequests must be between 1 and 256');
    }

    this._transport = this._settings.transport || new baTransport({
      port: this._settings.port,
      interface: this._settings.interface,
      broadcastAddress: this._settings.broadcastAddress
    });

    this.source = null;
    // Setup code
    this._transport.on('message', this._receiveData.bind(this));
    this._transport.on('error', this._receiveError.bind(this));
    this._transport.open();
  }

  // Helper utils
  _getInvokeId() {
    for (let i = 0; i < 256; i++) {
      const id = (this._invokeCounter++ - 1) % 256;
      if (!this._invokeStore[id] && !this._requestQueue.some(item => item.invokeId === id)) return id;
    }
    return undefined;
  }

  _invokeCallback(id, err, result) {
    const callback = this._invokeStore[id];
    if (callback) return callback(err, result);
    debug('InvokeId ', id, ' not found -> drop package');
  }

  _addCallback(id, callback, receiver, service) {
    let settled = false;
    const onTimeout = () => {
      const callback = this._invokeStore[id];
      this.emit('timeout', {invokeId: id, address: receiver});
      callback(new Error('ERR_TIMEOUT'));
    };
    let timeout = setTimeout(onTimeout, this._settings.apduTimeout);
    this._invokeStore[id] = (err, data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      delete this._invokeStore[id];
      this._segmentStore.forEach((state, key) => {
        if (!state.server && state.invokeId === id) {
          clearTimeout(state.timeout);
          this._segmentStore.delete(key);
        }
      });
      try {
        callback(err, data);
      } finally {
        this._processRequestQueue();
      }
    };
    this._invokeStore[id].receiver = receiver;
    this._invokeStore[id].service = service;
    this._invokeStore[id].refresh = () => {
      clearTimeout(timeout);
      timeout = setTimeout(onTimeout, this._settings.apduTimeout);
    };
  }

  _sendConfirmed(receiver, buffer, settings, callback) {
    if (this._closed) return callback(new Error('ERR_CLIENT_CLOSED'));
    const id = settings.invokeId;
    if (id !== undefined && (!Number.isInteger(id) || id < 0 || id > 255)) {
      return callback(new RangeError('invokeId must be between 0 and 255'));
    }
    if (id !== undefined && (this._invokeStore[id] || this._requestQueue.some(item => item.invokeId === id))) {
      return callback(new Error('ERR_INVOKE_ID_IN_USE'));
    }
    this._requestQueue.push({receiver: receiver, buffer: buffer, invokeId: id, callback: callback});
    this._processRequestQueue();
  }

  _processRequestQueue() {
    if (this._closed || this._processingQueue) return;
    this._processingQueue = true;
    try {
      while (this._requestQueue.length && Object.keys(this._invokeStore).length < this._settings.maxParallelRequests) {
        let item = this._requestQueue.shift();
        let id = item.invokeId;
        if (id === undefined) {
          id = this._getInvokeId();
          if (id === undefined) {
            const index = this._requestQueue.findIndex(request => request.invokeId !== undefined);
            this._requestQueue.unshift(item);
            item = this._requestQueue.splice(index + 1, 1)[0];
            id = item.invokeId;
          }
        }
        const offset = BVLC_HEADER_LENGTH + baNpdu.decode(item.buffer.buffer, BVLC_HEADER_LENGTH).len;
        item.buffer.buffer[offset + 2] = id;
        this._addCallback(id, item.callback, item.receiver, item.buffer.buffer[offset + 3]);
        const callback = this._invokeStore[id];
        this._transport.send(item.buffer.buffer, item.buffer.offset, item.receiver, (err) => {
          if (err && this._invokeStore[id] === callback) this._invokeCallback(id, err);
        });
      }
    } finally {
      this._processingQueue = false;
    }
  }

  _receiverMatches(receiver, address, source, port) {
    const target = typeof receiver === 'string' ? {address: receiver} : receiver;
    if (target.address !== address || (port !== undefined && (target.port || this._settings.port) !== port)) return false;
    if (!target.net) return !source;
    return source && target.net === source.net && JSON.stringify(target.adr) === JSON.stringify(source.adr);
  }

  _getBuffer() {
    return {
      buffer: Buffer.alloc(this._transport.getMaxPayload()),
      offset: BVLC_HEADER_LENGTH
    };
  }

  // Service Handlers
  _processError(invokeId, buffer, offset, length) {
    const result = baServices.error.decode(buffer, offset, length);
    if (!result) return debug('Couldn`t decode Error');
    this._invokeCallback(invokeId, new Error('BacnetError - Class:' + result.class + ' - Code:' + result.code));
  }

  _processAbort(invokeId, reason) {
    this._invokeCallback(invokeId, new Error('BacnetAbort - Reason:' + reason));
  }

  _segmentAckResponse(receiver, negative, server, originalInvokeId, sequencenumber, actualWindowSize) {
    const buffer = this._getBuffer();
    baNpdu.encode(buffer, baEnum.NpduControlPriority.NORMAL_MESSAGE, receiver, null, DEFAULT_HOP_COUNT, baEnum.NetworkLayerMessageType.WHO_IS_ROUTER_TO_NETWORK, 0);
    baApdu.encodeSegmentAck(buffer, baEnum.PduTypes.SEGMENT_ACK | (negative ? baEnum.PduSegAckBits.NEGATIVE_ACK : 0) | (server ? baEnum.PduSegAckBits.SERVER : 0), originalInvokeId, sequencenumber, actualWindowSize);
    baBvlc.encode(buffer.buffer, baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU, buffer.offset);
    this._transport.send(buffer.buffer, buffer.offset, receiver);
  }

  _processSegment(receiver, type, service, invokeId, maxSegments, maxApdu, server, sequencenumber, proposedWindowNumber, buffer, offset, length) {
    if (proposedWindowNumber < 1 || proposedWindowNumber > 127) return debug('Invalid segment window -> Drop package');
    const key = JSON.stringify([receiver, invokeId, server]);
    let state = this._segmentStore.get(key);
    if (!state) {
      if (sequencenumber !== 0) return this._segmentAckResponse(receiver, true, server, invokeId, 255, proposedWindowNumber);
      const header = this._getBuffer();
      header.offset = 0;
      const unsegmentedType = type & ~(baEnum.PduConReqBits.SEGMENTED_MESSAGE | baEnum.PduConReqBits.MORE_FOLLOWS);
      if (server) {
        baApdu.encodeConfirmedServiceRequest(header, unsegmentedType, service, maxSegments, maxApdu, invokeId, 0, 0);
      } else {
        baApdu.encodeComplexAck(header, unsegmentedType, service, invokeId, 0, 0);
      }
      state = {invokeId: invokeId, server: server, sequence: 255, count: 0, windowCount: 0, service: service, parts: [header.buffer.slice(0, header.offset)]};
      this._segmentStore.set(key, state);
    }
    if (state.service !== service) return debug('Segment service changed -> Drop package');
    if (sequencenumber !== (state.sequence + 1) % 256) {
      return this._segmentAckResponse(receiver, sequencenumber !== state.sequence, server, invokeId, state.sequence, proposedWindowNumber);
    }
    state.sequence = sequencenumber;
    state.count++;
    state.windowCount++;
    state.parts.push(Buffer.from(buffer.slice(offset, offset + length)));
    clearTimeout(state.timeout);
    state.timeout = setTimeout(() => {
      this._segmentStore.delete(key);
      if (server) debug('Segmented request timed out', receiver, invokeId);
    }, this._settings.apduTimeout);
    if (!server && this._invokeStore[invokeId]) this._invokeStore[invokeId].refresh();
    const moreFollows = type & baEnum.PduConReqBits.MORE_FOLLOWS;
    if (state.count === 1 || state.windowCount === proposedWindowNumber || !moreFollows) {
      state.windowCount = 0;
      this._segmentAckResponse(receiver, false, server, invokeId, sequencenumber, proposedWindowNumber);
    }
    if (!moreFollows) {
      clearTimeout(state.timeout);
      this._segmentStore.delete(key);
      const apduBuffer = Buffer.concat(state.parts);
      const source = receiver.net ? {net: receiver.net, adr: receiver.adr} : null;
      this._handlePdu(receiver.address, apduBuffer[0], apduBuffer, 0, apduBuffer.length, source, receiver.port);
    }
  }

  _processConfirmedServiceRequest(address, type, service, maxSegments, maxApdu, invokeId, buffer, offset, length) {
    let result;
    debug('Handle this._processConfirmedServiceRequest');
    if (service === baEnum.ConfirmedServiceChoice.READ_PROPERTY) {
      result = baServices.readProperty.decode(buffer, offset, length);
      if (!result) return debug('Received invalid readProperty message');
      this.emit('readProperty', {address: address, invokeId: invokeId, request: result});
    } else if (service === baEnum.ConfirmedServiceChoice.WRITE_PROPERTY) {
      result = baServices.writeProperty.decode(buffer, offset, length);
      if (!result) return debug('Received invalid writeProperty message');
      this.emit('writeProperty', {address: address, invokeId: invokeId, request: result});
    } else if (service === baEnum.ConfirmedServiceChoice.READ_PROPERTY_MULTIPLE) {
      result = baServices.readPropertyMultiple.decode(buffer, offset, length);
      if (!result) return debug('Received invalid readPropertyMultiple message');
      this.emit('readPropertyMultiple', {address: address, invokeId: invokeId, request: result});
    } else if (service === baEnum.ConfirmedServiceChoice.WRITE_PROPERTY_MULTIPLE) {
      result = baServices.writePropertyMultiple.decode(buffer, offset, length);
      if (!result) return debug('Received invalid writePropertyMultiple message');
      this.emit('writePropertyMultiple', {address: address, invokeId: invokeId, request: result});
    } else if (service === baEnum.ConfirmedServiceChoice.CONFIRMED_COV_NOTIFICATION) {
      result = baServices.covNotify.decode(buffer, offset, length);
      if (!result) return debug('Received invalid covNotify message');
      this.emit('covNotify', {address: address, invokeId: invokeId, request: result});
    } else if (service === baEnum.ConfirmedServiceChoice.ATOMIC_WRITE_FILE) {
      result = baServices.atomicWriteFile.decode(buffer, offset, length);
      if (!result) return debug('Received invalid atomicWriteFile message');
      this.emit('atomicWriteFile', {address: address, invokeId: invokeId, request: result});
    } else if (service === baEnum.ConfirmedServiceChoice.ATOMIC_READ_FILE) {
      result = baServices.atomicReadFile.decode(buffer, offset, length);
      if (!result) return debug('Received invalid atomicReadFile message');
      this.emit('atomicReadFile', {address: address, invokeId: invokeId, request: result});
    } else if (service === baEnum.ConfirmedServiceChoice.SUBSCRIBE_COV) {
      result = baServices.subscribeCov.decode(buffer, offset, length);
      if (!result) return debug('Received invalid subscribeCOV message');
      this.emit('subscribeCOV', {address: address, invokeId: invokeId, request: result});
    } else if (service === baEnum.ConfirmedServiceChoice.SUBSCRIBE_COV_PROPERTY) {
      result = baServices.subscribeProperty.decode(buffer, offset, length);
      if (!result) return debug('Received invalid subscribeProperty message');
      this.emit('subscribeProperty', {address: address, invokeId: invokeId, request: result});
    } else if (service === baEnum.ConfirmedServiceChoice.DEVICE_COMMUNICATION_CONTROL) {
      result = baServices.deviceCommunicationControl.decode(buffer, offset, length);
      if (!result) return debug('Received invalid deviceCommunicationControl message');
      this.emit('deviceCommunicationControl', {address: address, invokeId: invokeId, request: result});
    } else if (service === baEnum.ConfirmedServiceChoice.REINITIALIZE_DEVICE) {
      result = baServices.reinitializeDevice.decode(buffer, offset, length);
      if (!result) return debug('Received invalid reinitializeDevice message');
      this.emit('reinitializeDevice', {address: address, invokeId: invokeId, request: result});
    } else if (service === baEnum.ConfirmedServiceChoice.CONFIRMED_EVENT_NOTIFICATION) {
      result = baServices.eventNotifyData.decode(buffer, offset, length);
      if (!result) return debug('Received invalid eventNotifyData message');
      this.emit('eventNotifyData', {address: address, invokeId: invokeId, request: result});
    } else if (service === baEnum.ConfirmedServiceChoice.READ_RANGE) {
      result = baServices.readRange.decode(buffer, offset, length);
      if (!result) return debug('Received invalid readRange message');
      this.emit('readRange', {address: address, invokeId: invokeId, request: result});
    } else if (service === baEnum.ConfirmedServiceChoice.CREATE_OBJECT) {
      result = baServices.createObject.decode(buffer, offset, length);
      if (!result) return debug('Received invalid createObject message');
      this.emit('createObject', {address: address, invokeId: invokeId, request: result});
    } else if (service === baEnum.ConfirmedServiceChoice.DELETE_OBJECT) {
      result = baServices.deleteObject.decode(buffer, offset, length);
      if (!result) return debug('Received invalid deleteObject message');
      this.emit('deleteObject', {address: address, invokeId: invokeId, request: result});
    } else if (service === baEnum.ConfirmedServiceChoice.ACKNOWLEDGE_ALARM) {
      result = baServices.alarmAcknowledge.decode(buffer, offset, length);
      if (!result) return debug('Received invalid alarmAcknowledge message');
      this.emit('alarmAcknowledge', {address: address, invokeId: invokeId, request: result});
    } else if (service === baEnum.ConfirmedServiceChoice.GET_ALARM_SUMMARY) {
      this.emit('getAlarmSummary', {address: address, invokeId: invokeId});
    } else if (service === baEnum.ConfirmedServiceChoice.GET_ENROLLMENT_SUMMARY) {
      result = baServices.getEnrollmentSummary.decode(buffer, offset, length);
      if (!result) return debug('Received invalid getEntrollmentSummary message');
      this.emit('getEntrollmentSummary', {address: address, invokeId: invokeId, request: result});
    } else if (service === baEnum.ConfirmedServiceChoice.GET_EVENT_INFORMATION) {
      result = baServices.getEventInformation.decode(buffer, offset, length);
      if (!result) return debug('Received invalid getEventInformation message');
      this.emit('getEventInformation', {address: address, invokeId: invokeId, request: result});
    } else if (service === baEnum.ConfirmedServiceChoice.LIFE_SAFETY_OPERATION) {
      result = baServices.lifeSafetyOperation.decode(buffer, offset, length);
      if (!result) return debug('Received invalid lifeSafetyOperation message');
      this.emit('lifeSafetyOperation', {address: address, invokeId: invokeId, request: result});
    } else if (service === baEnum.ConfirmedServiceChoice.ADD_LIST_ELEMENT) {
      result = baServices.addListElement.decode(buffer, offset, length);
      if (!result) return debug('Received invalid addListElement message');
      this.emit('addListElement', {address: address, invokeId: invokeId, request: result});
    } else if (service === baEnum.ConfirmedServiceChoice.REMOVE_LIST_ELEMENT) {
      result = baServices.addListElement.decode(buffer, offset, length);
      if (!result) return debug('Received invalid removeListElement message');
      this.emit('removeListElement', {address: address, invokeId: invokeId, request: result});
    } else if (service === baEnum.ConfirmedServiceChoice.CONFIRMED_PRIVATE_TRANSFER) {
      result = baServices.privateTransfer.decode(buffer, offset, length);
      if (!result) return debug('Received invalid privateTransfer message');
      this.emit('privateTransfer', {address: address, invokeId: invokeId, request: result});
    } else {
      debug('Received unsupported confirmed service request');
    }
  }

  _processUnconfirmedServiceRequest(address, type, service, buffer, offset, length) {
    let result;
    debug('Handle this._processUnconfirmedServiceRequest');
    if (service === baEnum.UnconfirmedServiceChoice.I_AM) {
      result = baServices.iAmBroadcast.decode(buffer, offset);
      if (!result) return debug('Received invalid iAm message');

      /**
       * The iAm event represents the response to a whoIs request to detect all devices in a BACNET network.
       * @event bacstack.iAm
       * @param {object} device - An object representing the detected device.
       * @param {string} device.address - The IP address of the detected device, or its BACnet router.
       * @param {number} device.port - The UDP port of the device or BACnet router.
       * @param {object|null} device.SADR - The routed BACnet source {net, adr}, or null for direct IP devices.
       * @param {number} device.deviceId - The BACNET device-id of the detected device.
       * @param {number} device.maxApdu - The max APDU size the detected device is supporting.
       * @param {number} device.segmentation - The type of segmentation the detected device is supporting.
       * @param {number} device.vendorId - The BACNET vendor-id of the detected device.
       * @example
       * const bacnet = require('bacstack');
       * const client = new bacnet();
       *
       * client.on('iAm', (device) => {
       *   console.log('address: ', device.address, ' - deviceId: ', device.deviceId, ' - maxApdu: ', device.maxApdu, ' - segmentation: ', device.segmentation, ' - vendorId: ', device.vendorId);
       * });
       */
      this.emit('iAm', {address: address, port: this._remotePort, deviceId: result.deviceId, maxApdu: result.maxApdu, segmentation: result.segmentation, vendorId: result.vendorId, SADR: this.source});
    } else if (service === baEnum.UnconfirmedServiceChoice.WHO_IS) {
      result = baServices.whoIs.decode(buffer, offset, length);
      if (!result) return debug('Received invalid WhoIs message');

      /**
       * The whoIs event represents the request for an IAm reponse to detect all devices in a BACNET network.
       * @event bacstack.whoIs
       * @param {object} request - An object representing the received request.
       * @param {string} request.address - The IP address of the device sending the request.
       * @param {number=} request.lowLimit - The lower limit of the BACNET device-id.
       * @param {number=} request.highLimit - The higher limit of the BACNET device-id.
       * @example
       * const bacnet = require('bacstack');
       * const client = new bacnet();
       *
       * client.on('whoIs', (request) => {
       *   console.log('address: ', device.address, ' - lowLimit: ', device.lowLimit, ' - highLimit: ', device.highLimit);
       * });
       */
      this.emit('whoIs', {address: address, lowLimit: result.lowLimit, highLimit: result.highLimit});
    } else if (service === baEnum.UnconfirmedServiceChoice.WHO_HAS) {
      result = baServices.whoHas.decode(buffer, offset, length);
      if (!result) return debug('Received invalid WhoHas message');
      this.emit('whoHas', {address: address, lowLimit: result.lowLimit, highLimit: result.highLimit, objectId: result.objectId, objectName: result.objectName});
    } else if (service === baEnum.UnconfirmedServiceChoice.UNCONFIRMED_COV_NOTIFICATION) {
      result = baServices.covNotify.decode(buffer, offset, length);
      if (!result) return debug('Received invalid covNotifyUnconfirmed message');
      this.emit('covNotifyUnconfirmed', {address: address, request: result});
    } else if (service === baEnum.UnconfirmedServiceChoice.TIME_SYNCHRONIZATION) {
      result = baServices.timeSync.decode(buffer, offset, length);
      if (!result) return debug('Received invalid TimeSync message');

      /**
       * The timeSync event represents the request to synchronize the local time to the received time.
       * @event bacstack.timeSync
       * @param {object} request - An object representing the received request.
       * @param {string} request.address - The IP address of the device sending the request.
       * @param {date} request.dateTime - The time to be synchronized to.
       * @example
       * const bacnet = require('bacstack');
       * const client = new bacnet();
       *
       * client.on('timeSync', (request) => {
       *   console.log('address: ', device.address, ' - dateTime: ', device.dateTime);
       * });
       */
      this.emit('timeSync', {address: address, dateTime: result.dateTime});
    } else if (service === baEnum.UnconfirmedServiceChoice.UTC_TIME_SYNCHRONIZATION) {
      result = baServices.timeSync.decode(buffer, offset, length);
      if (!result) return debug('Received invalid TimeSyncUTC message');

      /**
       * The timeSyncUTC event represents the request to synchronize the local time to the received UTC time.
       * @event bacstack.timeSyncUTC
       * @param {object} request - An object representing the received request.
       * @param {string} request.address - The IP address of the device sending the request.
       * @param {date} request.dateTime - The time to be synchronized to.
       * @example
       * const bacnet = require('bacstack');
       * const client = new bacnet();
       *
       * client.on('timeSyncUTC', (request) => {
       *   console.log('address: ', device.address, ' - dateTime: ', device.dateTime);
       * });
       */
      this.emit('timeSyncUTC', {address: address, dateTime: result.dateTime});
    } else if (service === baEnum.UnconfirmedServiceChoice.UNCONFIRMED_EVENT_NOTIFICATION) {
      result = baServices.eventNotifyData.decode(buffer, offset, length);
      if (!result) return debug('Received invalid EventNotify message');
      this.emit('eventNotify', {address: address, eventData: result.eventData});
    } else if (service === baEnum.UnconfirmedServiceChoice.I_HAVE) {
      result = baServices.iHaveBroadcast.decode(buffer, offset, length);
      if (!result) return debug('Received invalid ihaveBroadcast message');
      this.emit('ihaveBroadcast', {address: address, eventData: result.eventData});
    } else if (service === baEnum.UnconfirmedServiceChoice.UNCONFIRMED_PRIVATE_TRANSFER) {
      result = baServices.privateTransfer.decode(buffer, offset, length);
      if (!result) return debug('Received invalid privateTransfer message');
      this.emit('privateTransfer', {address: address, eventData: result.eventData});
    } else {
      debug('Received unsupported unconfirmed service request');
    }
  }

  _handlePdu(address, type, buffer, offset, length, source, port) {
    let result;
    const receiver = Object.assign({address: address, port: port}, source);
    const pduType = type & baEnum.PDU_TYPE_MASK;
    if (pduType === baEnum.PduTypes.SIMPLE_ACK || pduType === baEnum.PduTypes.COMPLEX_ACK || pduType === baEnum.PduTypes.ERROR || pduType === baEnum.PduTypes.REJECT || pduType === baEnum.PduTypes.ABORT) {
      const callback = this._invokeStore[baApdu.getDecodedInvokeId(buffer, offset)];
      if (!callback || !this._receiverMatches(callback.receiver, address, source, port)) return debug('Unmatched response -> Drop package');
      if (pduType !== baEnum.PduTypes.REJECT && pduType !== baEnum.PduTypes.ABORT) {
        const serviceOffset = offset + 2 + (pduType === baEnum.PduTypes.COMPLEX_ACK && (type & baEnum.PduConReqBits.SEGMENTED_MESSAGE) ? 2 : 0);
        if (callback.service !== buffer[serviceOffset]) return debug('Unmatched response service -> Drop package');
      }
    }
    // Handle different PDU types
    switch (type & baEnum.PDU_TYPE_MASK) {
      case baEnum.PduTypes.UNCONFIRMED_REQUEST:
        result = baApdu.decodeUnconfirmedServiceRequest(buffer, offset);
        this._processUnconfirmedServiceRequest(address, result.type, result.service, buffer, offset + result.len, length - result.len);
        break;
      case baEnum.PduTypes.SIMPLE_ACK:
        result = baApdu.decodeSimpleAck(buffer, offset);
        offset += result.len;
        length -= result.len;
        this._invokeCallback(result.invokeId, null, {result: result, buffer: buffer, offset: offset + result.len, length: length - result.len});
        break;
      case baEnum.PduTypes.COMPLEX_ACK:
        result = baApdu.decodeComplexAck(buffer, offset);
        if ((type & baEnum.PduConReqBits.SEGMENTED_MESSAGE) === 0) {
          this._invokeCallback(result.invokeId, null, {result: result, buffer: buffer, offset: offset + result.len, length: length - result.len});
        } else {
          this._processSegment(receiver, result.type, result.service, result.invokeId, baEnum.MaxSegmentsAccepted.SEGMENTS_0, baEnum.MaxApduLengthAccepted.OCTETS_50, false, result.sequencenumber, result.proposedWindowNumber, buffer, offset + result.len, length - result.len);
        }
        break;
      case baEnum.PduTypes.SEGMENT_ACK:
        result = baApdu.decodeSegmentAck(buffer, offset);
        //m_last_segment_ack.Set(address, result.originalInvokeId, result.sequencenumber, result.actualWindowSize);
        //this._processSegmentAck(address, result.type, result.originalInvokeId, result.sequencenumber, result.actualWindowSize, buffer, offset + result.len, length - result.len);
        break;
      case baEnum.PduTypes.ERROR:
        result = baApdu.decodeError(buffer, offset);
        this._processError(result.invokeId, buffer, offset + result.len, length - result.len);
        break;
      case baEnum.PduTypes.REJECT:
      case baEnum.PduTypes.ABORT:
        result = baApdu.decodeAbort(buffer, offset);
        this._processAbort(result.invokeId, result.reason);
        break;
      case baEnum.PduTypes.CONFIRMED_REQUEST:
        result = baApdu.decodeConfirmedServiceRequest(buffer, offset);
        if ((type & baEnum.PduConReqBits.SEGMENTED_MESSAGE) === 0) {
          this._processConfirmedServiceRequest(address, result.type, result.service, result.maxSegments, result.maxApdu, result.invokeId, buffer, offset + result.len, length - result.len);
        } else {
          this._processSegment(receiver, result.type, result.service, result.invokeId, result.maxSegments, result.maxApdu, true, result.sequencenumber, result.proposedWindowNumber, buffer, offset + result.len, length - result.len);
        }
        break;
      default:
        debug('Received unknown PDU type -> Drop package');
        break;
    }
  }

  _handleNpdu(buffer, offset, msgLength, remoteAddress, remotePort) {
    // Check data length
    if (msgLength <= 0) return debug('No NPDU data -> Drop package');
    // Parse baNpdu header
    const result = baNpdu.decode(buffer, offset);
    if (!result) return debug('Received invalid NPDU header -> Drop package');
    this.source = result.source || null;
    this._remotePort = remotePort || this._settings.port;
    if (result.funct & baEnum.NpduControlBits.NETWORK_LAYER_MESSAGE) {
      return debug('Received network layer message -> Drop package');
    }
    offset += result.len;
    msgLength -= result.len;
    if (msgLength <= 0) return debug('No APDU data -> Drop package');
    const apduType = baApdu.getDecodedType(buffer, offset);
    this._handlePdu(remoteAddress, apduType, buffer, offset, msgLength, result.source, remotePort);
  }

  _receiveData(buffer, remoteAddress, remotePort) {
    if (this._closed) return;
    // Check data length
    if (buffer.length < BVLC_HEADER_LENGTH) return debug('Received invalid data -> Drop package');
    // Parse BVLC header
    const result = baBvlc.decode(buffer, 0);
    if (!result) return debug('Received invalid BVLC header -> Drop package');
    if (result.func === baEnum.BvlcResultPurpose.BVLC_RESULT) {
      const bbmd = this._bbmd;
      if (!bbmd || !this._receiverMatches(bbmd.receiver, remoteAddress, null, remotePort)) return debug('Unexpected BVLC result');
      const code = buffer.readUInt16BE(4);
      if (!bbmd.pending) {
        if (code === baEnum.BvlcResultFormat.DISTRIBUTE_BROADCAST_TO_NETWORK_NAK) {
          bbmd.registered = false;
          clearTimeout(bbmd.renewal);
        }
        if (code !== 0) this.emit('error', new Error('BVLC_RESULT - Code:' + code));
        return;
      }
      const callback = bbmd.pending;
      bbmd.pending = null;
      clearTimeout(bbmd.timeout);
      bbmd.registered = code === 0;
      if (code === 0) {
        bbmd.expiresAt = Date.now() + bbmd.ttl * 1000;
        bbmd.renewal = setTimeout(() => this._registerForeignDevice(), bbmd.ttl * 750);
      }
      callback(code === 0 ? null : new Error('ERR_FOREIGN_DEVICE_REGISTRATION - Code:' + code));
      return;
    }
    // Check BVLC function
    if (result.func === baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU || result.func === baEnum.BvlcResultPurpose.ORIGINAL_BROADCAST_NPDU || result.func === baEnum.BvlcResultPurpose.FORWARDED_NPDU) {
      if (result.func === baEnum.BvlcResultPurpose.FORWARDED_NPDU) {
        remoteAddress = Array.from(buffer.slice(4, 8)).join('.');
        remotePort = buffer.readUInt16BE(8);
      }
      this._handleNpdu(buffer, result.len, buffer.length - result.len, remoteAddress, remotePort);
    } else {
      debug('Received unknown BVLC function -> Drop package');
    }
  }

  _receiveError(err) {

    /**
     * @event bacstack.error
     * @param {error} err - The error object thrown by the underlying transport layer.
     * @example
     * const bacnet = require('bacstack');
     * const client = new bacnet();
     *
     * client.on('error', (err) => {
     *   console.log('Error occurred: ', err);
     *   client.close();
     * });
     */
    this.emit('error', err);
  }

  /**
   * Register with a configured IPv4 BBMD. Renew automatically until close().
   * Wait for the callback before sending broadcast discovery through the BBMD.
   * @param {string|object} receiver - BBMD IP or {address, port}.
   * @param {number} ttl - Registration lifetime in seconds (1..65535).
   * @param {function} next - Called after the BBMD accepts or rejects registration.
   */
  registerForeignDevice(receiver, ttl, next) {
    const address = typeof receiver === 'string' ? receiver : receiver && receiver.address;
    if (isIP(address) !== 4 || !Number.isInteger(ttl) || ttl < 1 || ttl > 65535) {
      throw new RangeError('An IPv4 BBMD address and TTL between 1 and 65535 are required');
    }
    if (typeof next !== 'function') throw new TypeError('A registration callback is required');
    if (this._closed) return next(new Error('ERR_CLIENT_CLOSED'));
    if (this._bbmd && (this._bbmd.pending || this._bbmd.registered)) return next(new Error('ERR_FOREIGN_DEVICE_ALREADY_CONFIGURED'));
    this._bbmd = {receiver: receiver, ttl: ttl, registered: false, pending: null};
    this._registerForeignDevice(next);
  }

  _registerForeignDevice(next) {
    const bbmd = this._bbmd;
    bbmd.pending = next || ((err) => {
      if (err) this.emit('error', err);
    });
    const fail = (err) => {
      if (!bbmd.pending) return;
      const callback = bbmd.pending;
      bbmd.pending = null;
      bbmd.registered = false;
      clearTimeout(bbmd.timeout);
      callback(err);
    };
    bbmd.timeout = setTimeout(() => fail(new Error('ERR_FOREIGN_DEVICE_REGISTRATION_TIMEOUT')), this._settings.apduTimeout);
    const buffer = Buffer.alloc(6);
    baBvlc.encode(buffer, baEnum.BvlcResultPurpose.REGISTER_FOREIGN_DEVICE, 6);
    buffer.writeUInt16BE(bbmd.ttl, 4);
    this._transport.send(buffer, buffer.length, bbmd.receiver, (err) => {
      if (err) fail(err);
    });
  }

  _getReceiver(address, destination) {
    if (!destination) return address;
    return Object.assign({}, typeof address === 'string' ? {address: address} : address, destination);
  }

  /**
   * The whoIs command discovers all BACNET devices in a network.
   * @function bacstack.whoIs
   * @param {object=} options
   * @param {number=} options.lowLimit - Minimal device instance number to search for.
   * @param {number=} options.highLimit - Maximal device instance number to search for.
   * @param {string=} options.address - Unicast address if command should address a device directly.
   * @param {object=} options.dest - BACnet destination {net, adr}; use {net: 65535} for global discovery through a BACnet router.
   * @fires bacstack.iAm
   * @example
   * const bacnet = require('bacstack');
   * const client = new bacnet();
   *
   * client.whoIs();
   */
  whoIs(options) {
    if (this._closed) throw new Error('ERR_CLIENT_CLOSED');
    options = options || {};
    const settings = {
      lowLimit: options.lowLimit,
      highLimit: options.highLimit,
      address: options.address || this._transport.getBroadcastAddress(),
      dest: options.dest || (typeof options.address === 'object' ? options.address : undefined)
    };
    const buffer = this._getBuffer();
    baNpdu.encode(buffer, baEnum.NpduControlPriority.NORMAL_MESSAGE, settings.dest, null, DEFAULT_HOP_COUNT, baEnum.NetworkLayerMessageType.WHO_IS_ROUTER_TO_NETWORK, 0);
    baApdu.encodeUnconfirmedServiceRequest(buffer, baEnum.PduTypes.UNCONFIRMED_REQUEST, baEnum.UnconfirmedServiceChoice.WHO_IS);
    baServices.whoIs.encode(buffer, settings.lowLimit, settings.highLimit);
    const broadcast = (typeof settings.address === 'string' ? settings.address : settings.address.address) === this._transport.getBroadcastAddress();
    if (broadcast && this._bbmd && (!this._bbmd.registered || this._bbmd.expiresAt <= Date.now())) throw new Error('ERR_FOREIGN_DEVICE_NOT_REGISTERED');
    let npduType = broadcast ? baEnum.BvlcResultPurpose.ORIGINAL_BROADCAST_NPDU : baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU;
    if (broadcast && this._bbmd) npduType = baEnum.BvlcResultPurpose.DISTRIBUTE_BROADCAST_TO_NETWORK;
    baBvlc.encode(buffer.buffer, npduType, buffer.offset);
    this._transport.send(buffer.buffer, buffer.offset, broadcast && this._bbmd ? this._bbmd.receiver : settings.address);
  }

  /**
   * The timeSync command sets the time of a target device.
   * @function bacstack.timeSync
   * @param {string} address - IP address of the target device.
   * @param {date} dateTime - The date and time to set on the target device.
   * @example
   * const bacnet = require('bacstack');
   * const client = new bacnet();
   *
   * client.timeSync('192.168.1.43', new Date());
   */
  timeSync(address, dateTime) {
    const buffer = this._getBuffer();
    baNpdu.encode(buffer, baEnum.NpduControlPriority.NORMAL_MESSAGE, address);
    baApdu.encodeUnconfirmedServiceRequest(buffer, baEnum.PduTypes.UNCONFIRMED_REQUEST, baEnum.UnconfirmedServiceChoice.TIME_SYNCHRONIZATION);
    baServices.timeSync.encode(buffer, dateTime);
    const npduType = (address !== this._transport.getBroadcastAddress()) ? baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU : baEnum.BvlcResultPurpose.ORIGINAL_BROADCAST_NPDU;
    baBvlc.encode(buffer.buffer, npduType, buffer.offset);
    this._transport.send(buffer.buffer, buffer.offset, address);
  }

  /**
   * The timeSyncUTC command sets the UTC time of a target device.
   * @function bacstack.timeSyncUTC
   * @param {string} address - IP address of the target device.
   * @param {date} dateTime - The date and time to set on the target device.
   * @example
   * const bacnet = require('bacstack');
   * const client = new bacnet();
   *
   * client.timeSyncUTC('192.168.1.43', new Date());
   */
  timeSyncUTC(address, dateTime) {
    const buffer = this._getBuffer();
    baNpdu.encode(buffer, baEnum.NpduControlPriority.NORMAL_MESSAGE, address);
    baApdu.encodeUnconfirmedServiceRequest(buffer, baEnum.PduTypes.UNCONFIRMED_REQUEST, baEnum.UnconfirmedServiceChoice.UTC_TIME_SYNCHRONIZATION);
    baServices.timeSync.encode(buffer, dateTime);
    const npduType = (address !== this._transport.getBroadcastAddress()) ? baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU : baEnum.BvlcResultPurpose.ORIGINAL_BROADCAST_NPDU;
    baBvlc.encode(buffer.buffer, npduType, buffer.offset);
    this._transport.send(buffer.buffer, buffer.offset, address);
  }

  /**
   * The readProperty command reads a single property of an object from a device.
   * @function bacstack.readProperty
   * @param {string} address - IP address of the target device.
   * @param {object} objectId - The BACNET object ID to read.
   * @param {number} objectId.type - The BACNET object type to read.
   * @param {number} objectId.instance - The BACNET object instance to read.
   * @param {number} propertyId - The BACNET property id in the specified object to read.
   * @param {object=} options
   * @param {MaxSegmentsAccepted=} options.maxSegments - The maximimal allowed number of segments.
   * @param {MaxApduLengthAccepted=} options.maxApdu - The maximal allowed APDU size.
   * @param {number=} options.invokeId - The invoke ID of the confirmed service telegram.
   * @param {number=} options.arrayIndex - The array index of the property to be read.
   * @param {function} next - The callback containing an error, in case of a failure and value object in case of success.
   * @example
   * const bacnet = require('bacstack');
   * const client = new bacnet();
   *
   * client.readProperty('192.168.1.43', {type: 8, instance: 44301}, 28, (err, value) => {
   *   console.log('value: ', value);
   * });
   */
  readProperty(address, destination, objectId, propertyId, options, next) {
    if (destination && destination.type !== undefined) {
      next = options;
      options = propertyId;
      propertyId = objectId;
      objectId = destination;
      destination = null;
    }
    next = next || options;
    options = typeof options === 'function' ? {} : options || {};
    const settings = {
      maxSegments: options.maxSegments === undefined ? baEnum.MaxSegmentsAccepted.SEGMENTS_65 : options.maxSegments,
      maxApdu: options.maxApdu === undefined ? baEnum.MaxApduLengthAccepted.OCTETS_1476 : options.maxApdu,
      invokeId: options.invokeId,
      arrayIndex: options.arrayIndex === undefined ? baEnum.ASN1_ARRAY_ALL : options.arrayIndex
    };

    const addr = this._getReceiver(address, destination);
    const buffer = this._getBuffer();
    baNpdu.encode(buffer, baEnum.NpduControlPriority.NORMAL_MESSAGE | baEnum.NpduControlBits.EXPECTING_REPLY, addr, null, DEFAULT_HOP_COUNT, baEnum.NetworkLayerMessageType.WHO_IS_ROUTER_TO_NETWORK, 0);
    const type = baEnum.PduTypes.CONFIRMED_REQUEST | (settings.maxSegments !== baEnum.MaxSegmentsAccepted.SEGMENTS_0 ? baEnum.PduConReqBits.SEGMENTED_RESPONSE_ACCEPTED : 0);
    baApdu.encodeConfirmedServiceRequest(buffer, type, baEnum.ConfirmedServiceChoice.READ_PROPERTY, settings.maxSegments, settings.maxApdu, settings.invokeId, 0, 0);
    baServices.readProperty.encode(buffer, objectId.type, objectId.instance, propertyId, settings.arrayIndex);
    baBvlc.encode(buffer.buffer, baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU, buffer.offset);
    this._sendConfirmed(addr, buffer, settings, (err, data) => {
      if (err) return next(err);
      const result = baServices.readProperty.decodeAcknowledge(data.buffer, data.offset, data.length);
      if (!result) return next(new Error('INVALID_DECODING'));
      next(null, result);
    });
  }

  /**
   * The writeProperty command writes a single property of an object to a device.
   * @function bacstack.writeProperty
   * @param {string} address - IP address of the target device.
   * @param {object} objectId - The BACNET object ID to write.
   * @param {number} objectId.type - The BACNET object type to write.
   * @param {number} objectId.instance - The BACNET object instance to write.
   * @param {number} propertyId - The BACNET property id in the specified object to write.
   * @param {object[]} values - A list of values to be written to the specified property.
   * @param {ApplicationTags} values.tag - The data-type of the value to be written.
   * @param {number} values.value - The actual value to be written.
   * @param {object=} options
   * @param {MaxSegmentsAccepted=} options.maxSegments - The maximimal allowed number of segments.
   * @param {MaxApduLengthAccepted=} options.maxApdu - The maximal allowed APDU size.
   * @param {number=} options.invokeId - The invoke ID of the confirmed service telegram.
   * @param {number=} options.arrayIndex - The array index of the property to be read.
   * @param {number=} options.priority - The priority of the value to be written.
   * @param {function} next - The callback containing an error, in case of a failure and value object in case of success.
   * @example
   * const bacnet = require('bacstack');
   * const client = new bacnet();
   *
   * client.writeProperty('192.168.1.43', {type: 8, instance: 44301}, 28, [
   *   {type: bacnet.enum.ApplicationTags.REAL, value: 100}
   * ], (err, value) => {
   *   console.log('value: ', value);
   * });
   */
  writeProperty(address, destination, objectId, propertyId, values, options, next) {
    if (destination && destination.type !== undefined) {
      next = options;
      options = values;
      values = propertyId;
      propertyId = objectId;
      objectId = destination;
      destination = null;
    }
    next = next || options;
    options = typeof options === 'function' ? {} : options || {};
    const settings = {
      maxSegments: options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
      maxApdu: options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
      invokeId: options.invokeId,
      arrayIndex: options.arrayIndex === undefined ? baEnum.ASN1_ARRAY_ALL : options.arrayIndex,
      priority: options.priority
    };

    const addr = this._getReceiver(address, destination);

    const buffer = this._getBuffer();
    baNpdu.encode(buffer, baEnum.NpduControlPriority.NORMAL_MESSAGE | baEnum.NpduControlBits.EXPECTING_REPLY, addr, null, DEFAULT_HOP_COUNT, baEnum.NetworkLayerMessageType.WHO_IS_ROUTER_TO_NETWORK, 0);
    baApdu.encodeConfirmedServiceRequest(buffer, baEnum.PduTypes.CONFIRMED_REQUEST, baEnum.ConfirmedServiceChoice.WRITE_PROPERTY, settings.maxSegments, settings.maxApdu, settings.invokeId, 0, 0);
    baServices.writeProperty.encode(buffer, objectId.type, objectId.instance, propertyId, settings.arrayIndex, settings.priority, values);
    baBvlc.encode(buffer.buffer, baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU, buffer.offset);
    this._sendConfirmed(addr, buffer, settings, (err, data) => {
      next(err);
    });
  }

  /**
   * The readPropertyMultiple command reads multiple properties in multiple objects from a device.
   * @function bacstack.readPropertyMultiple
   * @param {string} address - IP address of the target device.
   * @param {object[]} requestArray - List of object and property specifications to be read.
   * @param {object} requestArray.objectId - Specifies which object to read.
   * @param {number} requestArray.objectId.type - The BACNET object type to read.
   * @param {number} requestArray.objectId.instance - The BACNET object instance to read.
   * @param {object[]} requestArray.properties - List of properties to be read.
   * @param {number} requestArray.properties.id - The BACNET property id in the specified object to read. Also supports 8 for all properties.
   * @param {object=} options
   * @param {MaxSegmentsAccepted=} options.maxSegments - The maximimal allowed number of segments.
   * @param {MaxApduLengthAccepted=} options.maxApdu - The maximal allowed APDU size.
   * @param {number=} options.invokeId - The invoke ID of the confirmed service telegram.
   * @param {function} next - The callback containing an error, in case of a failure and value object in case of success.
   * @example
   * const bacnet = require('bacstack');
   * const client = new bacnet();
   *
   * const requestArray = [
   *   {objectId: {type: 8, instance: 4194303}, properties: [{id: 8}]}
   * ];
   * client.readPropertyMultiple('192.168.1.43', requestArray, (err, value) => {
   *   console.log('value: ', value);
   * });
   */
  readPropertyMultiple(address, destination, propertiesArray, options, next) {
    if (Array.isArray(destination)) {
      next = options;
      options = propertiesArray;
      propertiesArray = destination;
      destination = null;
    }
    next = next || options;
    options = typeof options === 'function' ? {} : options || {};
    const settings = {
      maxSegments: options.maxSegments === undefined ? baEnum.MaxSegmentsAccepted.SEGMENTS_65 : options.maxSegments,
      maxApdu: options.maxApdu === undefined ? baEnum.MaxApduLengthAccepted.OCTETS_1476 : options.maxApdu,
      invokeId: options.invokeId
    };

    const buffer = this._getBuffer();
    const receiver = this._getReceiver(address, destination);
    baNpdu.encode(buffer, baEnum.NpduControlPriority.NORMAL_MESSAGE | baEnum.NpduControlBits.EXPECTING_REPLY, receiver, null, DEFAULT_HOP_COUNT, baEnum.NetworkLayerMessageType.WHO_IS_ROUTER_TO_NETWORK, 0);
    const type = baEnum.PduTypes.CONFIRMED_REQUEST | (settings.maxSegments !== baEnum.MaxSegmentsAccepted.SEGMENTS_0 ? baEnum.PduConReqBits.SEGMENTED_RESPONSE_ACCEPTED : 0);
    baApdu.encodeConfirmedServiceRequest(buffer, type, baEnum.ConfirmedServiceChoice.READ_PROPERTY_MULTIPLE, settings.maxSegments, settings.maxApdu, settings.invokeId, 0, 0);
    baServices.readPropertyMultiple.encode(buffer, propertiesArray);
    baBvlc.encode(buffer.buffer, baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU, buffer.offset);
    this._sendConfirmed(receiver, buffer, settings, (err, data) => {
      if (err) return next(err);
      const result = baServices.readPropertyMultiple.decodeAcknowledge(data.buffer, data.offset, data.length);
      if (!result) return next(new Error('INVALID_DECODING'));
      next(null, result);
    });
  }

  /**
   * The writePropertyMultiple command writes multiple properties in multiple objects to a device.
   * @function bacstack.writePropertyMultiple
   * @param {string} address - IP address of the target device.
   * @param {object[]} values - List of object and property specifications to be written.
   * @param {object} values.objectId - Specifies which object to read.
   * @param {number} values.objectId.type - The BACNET object type to read.
   * @param {number} values.objectId.instance - The BACNET object instance to read.
   * @param {object[]} values.values - List of properties to be written.
   * @param {object} values.values.property - Property specifications to be written.
   * @param {number} values.values.property.id - The BACNET property id in the specified object to write.
   * @param {number} values.values.property.index - The array index of the property to be written.
   * @param {object[]} values.values.value - A list of values to be written to the specified property.
   * @param {ApplicationTags} values.values.value.tag - The data-type of the value to be written.
   * @param {object} values.values.value.value - The actual value to be written.
   * @param {number} values.values.priority - The priority to be used for writing to the property.
   * @param {object=} options
   * @param {MaxSegmentsAccepted=} options.maxSegments - The maximimal allowed number of segments.
   * @param {MaxApduLengthAccepted=} options.maxApdu - The maximal allowed APDU size.
   * @param {number=} options.invokeId - The invoke ID of the confirmed service telegram.
   * @param {function} next - The callback containing an error, in case of a failure and value object in case of success.
   * @example
   * const bacnet = require('bacstack');
   * const client = new bacnet();
   *
   * const values = [
   *   {objectId: {type: 8, instance: 44301}, values: [
   *     {property: {id: 28, index: 12}, value: [{type: bacnet.enum.ApplicationTags.BOOLEAN, value: true}], priority: 8}
   *   ]}
   * ];
   * client.writePropertyMultiple('192.168.1.43', values, (err, value) => {
   *   console.log('value: ', value);
   * });
   */
  writePropertyMultiple(address, values, options, next) {
    next = next || options;
    options = typeof options === 'function' ? {} : options || {};
    const settings = {
      maxSegments: options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
      maxApdu: options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
      invokeId: options.invokeId
    };
    const buffer = this._getBuffer();
    baNpdu.encode(buffer, baEnum.NpduControlPriority.NORMAL_MESSAGE | baEnum.NpduControlBits.EXPECTING_REPLY, address);
    baApdu.encodeConfirmedServiceRequest(buffer, baEnum.PduTypes.CONFIRMED_REQUEST, baEnum.ConfirmedServiceChoice.WRITE_PROPERTY_MULTIPLE, settings.maxSegments, settings.maxApdu, settings.invokeId);
    baServices.writePropertyMultiple.encodeObject(buffer, values);
    baBvlc.encode(buffer.buffer, baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU, buffer.offset);
    this._sendConfirmed(address, buffer, settings, (err, data) => {
      next(err);
    });
  }

  /**
   * The deviceCommunicationControl command enables or disables network communication of the target device.
   * @function bacstack.deviceCommunicationControl
   * @param {string} address - IP address of the target device.
   * @param {number} timeDuration - The time to hold the network communication state in seconds. 0 for infinite.
   * @param {EnableDisable} enableDisable - The network communication state to set.
   * @param {object=} options
   * @param {MaxSegmentsAccepted=} options.maxSegments - The maximimal allowed number of segments.
   * @param {MaxApduLengthAccepted=} options.maxApdu - The maximal allowed APDU size.
   * @param {number=} options.invokeId - The invoke ID of the confirmed service telegram.
   * @param {string=} options.password - The optional password used to set the network communication state.
   * @param {function} next - The callback containing an error, in case of a failure and value object in case of success.
   * @example
   * const bacnet = require('bacstack');
   * const client = new bacnet();
   *
   * client.deviceCommunicationControl('192.168.1.43', 0, bacnet.enum.EnableDisable.DISABLE, (err) => {
   *   console.log('error: ', err);
   * });
   */
  deviceCommunicationControl(address, timeDuration, enableDisable, options, next) {
    next = next || options;
    options = typeof options === 'function' ? {} : options || {};
    const settings = {
      maxSegments: options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
      maxApdu: options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
      invokeId: options.invokeId,
      password: options.password
    };
    const buffer = this._getBuffer();
    baNpdu.encode(buffer, baEnum.NpduControlPriority.NORMAL_MESSAGE | baEnum.NpduControlBits.EXPECTING_REPLY, address);
    baApdu.encodeConfirmedServiceRequest(buffer, baEnum.PduTypes.CONFIRMED_REQUEST, baEnum.ConfirmedServiceChoice.DEVICE_COMMUNICATION_CONTROL, settings.maxSegments, settings.maxApdu, settings.invokeId, 0, 0);
    baServices.deviceCommunicationControl.encode(buffer, timeDuration, enableDisable, settings.password);
    baBvlc.encode(buffer.buffer, baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU, buffer.offset);
    this._sendConfirmed(address, buffer, settings, (err, data) => {
      next(err);
    });
  }

  /**
   * The reinitializeDevice command initiates a restart of the target device.
   * @function bacstack.reinitializeDevice
   * @param {string} address - IP address of the target device.
   * @param {ReinitializedState} state - The type of restart to be initiated.
   * @param {object=} options
   * @param {MaxSegmentsAccepted=} options.maxSegments - The maximimal allowed number of segments.
   * @param {MaxApduLengthAccepted=} options.maxApdu - The maximal allowed APDU size.
   * @param {number=} options.invokeId - The invoke ID of the confirmed service telegram.
   * @param {string=} options.password - The optional password used to restart the device.
   * @param {function} next - The callback containing an error, in case of a failure and value object in case of success.
   * @example
   * const bacnet = require('bacstack');
   * const client = new bacnet();
   *
   * client.reinitializeDevice('192.168.1.43', bacnet.enum.ReinitializedState.COLDSTART, (err, value) => {
   *   console.log('value: ', value);
   * });
   */
  reinitializeDevice(address, state, options, next) {
    next = next || options;
    options = typeof options === 'function' ? {} : options || {};
    const settings = {
      maxSegments: options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
      maxApdu: options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
      invokeId: options.invokeId,
      password: options.password
    };
    const buffer = this._getBuffer();
    baNpdu.encode(buffer, baEnum.NpduControlPriority.NORMAL_MESSAGE | baEnum.NpduControlBits.EXPECTING_REPLY, address);
    baApdu.encodeConfirmedServiceRequest(buffer, baEnum.PduTypes.CONFIRMED_REQUEST, baEnum.ConfirmedServiceChoice.REINITIALIZE_DEVICE, settings.maxSegments, settings.maxApdu, settings.invokeId, 0, 0);
    baServices.reinitializeDevice.encode(buffer, state, settings.password);
    baBvlc.encode(buffer.buffer, baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU, buffer.offset);
    this._sendConfirmed(address, buffer, settings, (err, data) => {
      next(err);
    });
  }

  writeFile(address, objectId, position, fileBuffer, options, next) {
    next = next || options;
    options = typeof options === 'function' ? {} : options || {};
    const settings = {
      maxSegments: options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
      maxApdu: options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
      invokeId: options.invokeId
    };
    const buffer = this._getBuffer();
    baNpdu.encode(buffer, baEnum.NpduControlPriority.NORMAL_MESSAGE | baEnum.NpduControlBits.EXPECTING_REPLY, address);
    baApdu.encodeConfirmedServiceRequest(buffer, baEnum.PduTypes.CONFIRMED_REQUEST, baEnum.ConfirmedServiceChoice.ATOMIC_WRITE_FILE, settings.maxSegments, settings.maxApdu, settings.invokeId, 0, 0);
    baServices.atomicWriteFile.encode(buffer, false, objectId, position, fileBuffer);
    baBvlc.encode(buffer.buffer, baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU, buffer.offset);
    this._sendConfirmed(address, buffer, settings, (err, data) => {
      if (err) return next(err);
      const result = baServices.atomicWriteFile.decodeAcknowledge(data.buffer, data.offset, data.length);
      if (!result) return next(new Error('INVALID_DECODING'));
      next(null, result);
    });
  }

  readFile(address, objectId, position, count, options, next) {
    next = next || options;
    options = typeof options === 'function' ? {} : options || {};
    const settings = {
      maxSegments: options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
      maxApdu: options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
      invokeId: options.invokeId
    };
    const buffer = this._getBuffer();
    baNpdu.encode(buffer, baEnum.NpduControlPriority.NORMAL_MESSAGE | baEnum.NpduControlBits.EXPECTING_REPLY, address);
    baApdu.encodeConfirmedServiceRequest(buffer, baEnum.PduTypes.CONFIRMED_REQUEST, baEnum.ConfirmedServiceChoice.ATOMIC_READ_FILE, settings.maxSegments, settings.maxApdu, settings.invokeId, 0, 0);
    baServices.atomicReadFile.encode(buffer, true, objectId, position, count);
    baBvlc.encode(buffer.buffer, baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU, buffer.offset);
    this._sendConfirmed(address, buffer, settings, (err, data) => {
      if (err) return next(err);
      const result = baServices.atomicReadFile.decodeAcknowledge(data.buffer, data.offset, data.length);
      if (!result) return next(new Error('INVALID_DECODING'));
      next(null, result);
    });
  }

  readRange(address, objectId, idxBegin, quantity, options, next) {
    next = next || options;
    options = typeof options === 'function' ? {} : options || {};
    const settings = {
      maxSegments: options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
      maxApdu: options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
      invokeId: options.invokeId
    };
    const buffer = this._getBuffer();
    baNpdu.encode(buffer, baEnum.NpduControlPriority.NORMAL_MESSAGE | baEnum.NpduControlBits.EXPECTING_REPLY, address);
    baApdu.encodeConfirmedServiceRequest(buffer, baEnum.PduTypes.CONFIRMED_REQUEST, baEnum.ConfirmedServiceChoice.READ_RANGE, settings.maxSegments, settings.maxApdu, settings.invokeId, 0, 0);
    baServices.readRange.encode(buffer, objectId, baEnum.PropertyIdentifier.LOG_BUFFER, baEnum.ASN1_ARRAY_ALL, baEnum.ReadRangeType.BY_POSITION, idxBegin, new Date(), quantity);
    baBvlc.encode(buffer.buffer, baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU, buffer.offset);
    this._sendConfirmed(address, buffer, settings, (err, data) => {
      if (err) return next(err);
      const result = baServices.readRange.decodeAcknowledge(data.buffer, data.offset, data.length);
      if (!result) return next(new Error('INVALID_DECODING'));
      next(null, result);
    });
  }

  subscribeCOV(address, objectId, subscribeId, cancel, issueConfirmedNotifications, lifetime, options, next) {
    next = next || options;
    options = typeof options === 'function' ? {} : options || {};
    const settings = {
      maxSegments: options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
      maxApdu: options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
      invokeId: options.invokeId
    };
    const buffer = this._getBuffer();
    baNpdu.encode(buffer, baEnum.NpduControlPriority.NORMAL_MESSAGE | baEnum.NpduControlBits.EXPECTING_REPLY, address);
    baApdu.encodeConfirmedServiceRequest(buffer, baEnum.PduTypes.CONFIRMED_REQUEST, baEnum.ConfirmedServiceChoice.SUBSCRIBE_COV, settings.maxSegments, settings.maxApdu, settings.invokeId, 0, 0);
    baServices.subscribeCov.encode(buffer, subscribeId, objectId, cancel, issueConfirmedNotifications, lifetime);
    baBvlc.encode(buffer.buffer, baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU, buffer.offset);
    this._sendConfirmed(address, buffer, settings, (err, data) => {
      if (err) return next(err);
      next();
    });
  }

  subscribeProperty(address, objectId, monitoredProperty, subscribeId, cancel, issueConfirmedNotifications, options, next) {
    next = next || options;
    options = typeof options === 'function' ? {} : options || {};
    const settings = {
      maxSegments: options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
      maxApdu: options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
      invokeId: options.invokeId
    };
    const buffer = this._getBuffer();
    baNpdu.encode(buffer, baEnum.NpduControlPriority.NORMAL_MESSAGE | baEnum.NpduControlBits.EXPECTING_REPLY, address);
    baApdu.encodeConfirmedServiceRequest(buffer, baEnum.PduTypes.CONFIRMED_REQUEST, baEnum.ConfirmedServiceChoice.SUBSCRIBE_COV_PROPERTY, settings.maxSegments, settings.maxApdu, settings.invokeId, 0, 0);
    baServices.subscribeProperty.encode(buffer, subscribeId, objectId, cancel, issueConfirmedNotifications, 0, monitoredProperty, false, 0x0f);
    baBvlc.encode(buffer.buffer, baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU, buffer.offset);
    this._sendConfirmed(address, buffer, settings, (err, data) => {
      if (err) return next(err);
      next();
    });
  }

  createObject(address, objectId, values, options, next) {
    next = next || options;
    options = typeof options === 'function' ? {} : options || {};
    const settings = {
      maxSegments: options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
      maxApdu: options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
      invokeId: options.invokeId
    };
    const buffer = this._getBuffer();
    baNpdu.encode(buffer, baEnum.NpduControlPriority.NORMAL_MESSAGE | baEnum.NpduControlBits.EXPECTING_REPLY, address);
    baApdu.encodeConfirmedServiceRequest(buffer, baEnum.PduTypes.CONFIRMED_REQUEST, baEnum.ConfirmedServiceChoice.CREATE_OBJECT, settings.maxSegments, settings.maxApdu, settings.invokeId, 0, 0);
    baServices.createObject.encode(buffer, objectId, values);
    baBvlc.encode(buffer.buffer, baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU, buffer.offset);
    this._sendConfirmed(address, buffer, settings, (err, data) => {
      if (err) return next(err);
      next();
    });
  }

  deleteObject(address, objectId, options, next) {
    next = next || options;
    options = typeof options === 'function' ? {} : options || {};
    const settings = {
      maxSegments: options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
      maxApdu: options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
      invokeId: options.invokeId
    };
    const buffer = this._getBuffer();
    baNpdu.encode(buffer, baEnum.NpduControlPriority.NORMAL_MESSAGE | baEnum.NpduControlBits.EXPECTING_REPLY, address);
    baApdu.encodeConfirmedServiceRequest(buffer, baEnum.PduTypes.CONFIRMED_REQUEST, baEnum.ConfirmedServiceChoice.DELETE_OBJECT, settings.maxSegments, settings.maxApdu, settings.invokeId, 0, 0);
    baServices.deleteObject.encode(buffer, objectId);
    baBvlc.encode(buffer.buffer, baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU, buffer.offset);
    this._sendConfirmed(address, buffer, settings, (err, data) => {
      if (err) return next(err);
      next();
    });
  }

  removeListElement(address, objectId, reference, values, options, next) {
    next = next || options;
    options = typeof options === 'function' ? {} : options || {};
    const settings = {
      maxSegments: options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
      maxApdu: options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
      invokeId: options.invokeId
    };
    const buffer = this._getBuffer();
    baNpdu.encode(buffer, baEnum.NpduControlPriority.NORMAL_MESSAGE | baEnum.NpduControlBits.EXPECTING_REPLY, address);
    baApdu.encodeConfirmedServiceRequest(buffer, baEnum.PduTypes.CONFIRMED_REQUEST, baEnum.ConfirmedServiceChoice.REMOVE_LIST_ELEMENT, settings.maxSegments, settings.maxApdu, settings.invokeId, 0, 0);
    baServices.addListElement.encode(buffer, objectId, reference.id, reference.index, values);
    baBvlc.encode(buffer.buffer, baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU, buffer.offset);
    this._sendConfirmed(address, buffer, settings, (err, data) => {
      if (err) return next(err);
      next();
    });
  }

  addListElement(address, objectId, reference, values, options, next) {
    next = next || options;
    options = typeof options === 'function' ? {} : options || {};
    const settings = {
      maxSegments: options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
      maxApdu: options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
      invokeId: options.invokeId
    };
    const buffer = this._getBuffer();
    baNpdu.encode(buffer, baEnum.NpduControlPriority.NORMAL_MESSAGE | baEnum.NpduControlBits.EXPECTING_REPLY, address);
    baApdu.encodeConfirmedServiceRequest(buffer, baEnum.PduTypes.CONFIRMED_REQUEST, baEnum.ConfirmedServiceChoice.ADD_LIST_ELEMENT, settings.maxSegments, settings.maxApdu, settings.invokeId, 0, 0);
    baServices.addListElement.encode(buffer, objectId, reference.id, reference.index, values);
    baBvlc.encode(buffer.buffer, baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU, buffer.offset);
    this._sendConfirmed(address, buffer, settings, (err, data) => {
      if (err) return next(err);
      next();
    });
  }

  getAlarmSummary(address, options, next) {
    next = next || options;
    options = typeof options === 'function' ? {} : options || {};
    const settings = {
      maxSegments: options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
      maxApdu: options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
      invokeId: options.invokeId
    };
    const buffer = this._getBuffer();
    baNpdu.encode(buffer, baEnum.NpduControlPriority.NORMAL_MESSAGE | baEnum.NpduControlBits.EXPECTING_REPLY, address);
    baApdu.encodeConfirmedServiceRequest(buffer, baEnum.PduTypes.CONFIRMED_REQUEST, baEnum.ConfirmedServiceChoice.GET_ALARM_SUMMARY, settings.maxSegments, settings.maxApdu, settings.invokeId, 0, 0);
    baBvlc.encode(buffer.buffer, baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU, buffer.offset);
    this._sendConfirmed(address, buffer, settings, (err, data) => {
      if (err) return next(err);
      const result = baServices.alarmSummary.decode(data.buffer, data.offset, data.length);
      if (!result) return next(new Error('INVALID_DECODING'));
      next(null, result);
    });
  }

  getEventInformation(address, objectId, options, next) {
    next = next || options;
    options = typeof options === 'function' ? {} : options || {};
    const settings = {
      maxSegments: options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
      maxApdu: options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
      invokeId: options.invokeId
    };
    const buffer = this._getBuffer();
    baNpdu.encode(buffer, baEnum.NpduControlPriority.NORMAL_MESSAGE | baEnum.NpduControlBits.EXPECTING_REPLY, address);
    baApdu.encodeConfirmedServiceRequest(buffer, baEnum.PduTypes.CONFIRMED_REQUEST, baEnum.ConfirmedServiceChoice.GET_EVENT_INFORMATION, settings.maxSegments, settings.maxApdu, settings.invokeId, 0, 0);
    baAsn1.encodeContextObjectId(buffer, 0, objectId.type, objectId.instance);
    baBvlc.encode(buffer.buffer, baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU, buffer.offset);
    this._sendConfirmed(address, buffer, settings, (err, data) => {
      if (err) return next(err);
      const result = baServices.eventInformation.decode(data.buffer, data.offset, data.length);
      if (!result) return next(new Error('INVALID_DECODING'));
      next(null, result);
    });
  }

  acknowledgeAlarm(address, objectId, eventState, ackText, evTimeStamp, ackTimeStamp, options, next) {
    next = next || options;
    options = typeof options === 'function' ? {} : options || {};
    const settings = {
      maxSegments: options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
      maxApdu: options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
      invokeId: options.invokeId
    };
    const buffer = this._getBuffer();
    baNpdu.encode(buffer, baEnum.NpduControlPriority.NORMAL_MESSAGE | baEnum.NpduControlBits.EXPECTING_REPLY, address);
    baApdu.encodeConfirmedServiceRequest(buffer, baEnum.PduTypes.CONFIRMED_REQUEST, baEnum.ConfirmedServiceChoice.ACKNOWLEDGE_ALARM, settings.maxSegments, settings.maxApdu, settings.invokeId, 0, 0);
    baServices.alarmAcknowledge.encode(buffer, 57, objectId, eventState, ackText, evTimeStamp, ackTimeStamp);
    baBvlc.encode(buffer.buffer, baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU, buffer.offset);
    this._sendConfirmed(address, buffer, settings, (err, data) => {
      if (err) return next(err);
      next();
    });
  }

  confirmedPrivateTransfer(address, vendorId, serviceNumber, data, options, next) {
    next = next || options;
    options = typeof options === 'function' ? {} : options || {};
    const settings = {
      maxSegments: options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
      maxApdu: options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
      invokeId: options.invokeId
    };
    const buffer = this._getBuffer();
    baNpdu.encode(buffer, baEnum.NpduControlPriority.NORMAL_MESSAGE | baEnum.NpduControlBits.EXPECTING_REPLY, address);
    baApdu.encodeConfirmedServiceRequest(buffer, baEnum.PduTypes.CONFIRMED_REQUEST, baEnum.ConfirmedServiceChoice.CONFIRMED_PRIVATE_TRANSFER, settings.maxSegments, settings.maxApdu, settings.invokeId, 0, 0);
    baServices.privateTransfer.encode(buffer, vendorId, serviceNumber, data);
    baBvlc.encode(buffer.buffer, baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU, buffer.offset);
    this._sendConfirmed(address, buffer, settings, (err, data) => {
      if (err) return next(err);
      next();
    });
  }

  unconfirmedPrivateTransfer(address, vendorId, serviceNumber, data) {
    const buffer = this._getBuffer();
    baNpdu.encode(buffer, baEnum.NpduControlPriority.NORMAL_MESSAGE, address);
    baApdu.encodeUnconfirmedServiceRequest(buffer, baEnum.PduTypes.UNCONFIRMED_REQUEST, baEnum.UnconfirmedServiceChoice.UNCONFIRMED_PRIVATE_TRANSFER);
    baServices.privateTransfer.encode(buffer, vendorId, serviceNumber, data);
    baBvlc.encode(buffer.buffer, baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU, buffer.offset);
    this._transport.send(buffer.buffer, buffer.offset, address);
  }

  getEnrollmentSummary(address, acknowledgmentFilter, options, next) {
    next = next || options;
    options = typeof options === 'function' ? {} : options || {};
    const settings = {
      maxSegments: options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
      maxApdu: options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
      invokeId: options.invokeId
    };
    const buffer = this._getBuffer();
    baNpdu.encode(buffer, baEnum.NpduControlPriority.NORMAL_MESSAGE | baEnum.NpduControlBits.EXPECTING_REPLY, address);
    baApdu.encodeConfirmedServiceRequest(buffer, baEnum.PduTypes.CONFIRMED_REQUEST, baEnum.ConfirmedServiceChoice.GET_ENROLLMENT_SUMMARY, settings.maxSegments, settings.maxApdu, settings.invokeId, 0, 0);
    baServices.getEnrollmentSummary.encode(buffer, acknowledgmentFilter, options.enrollmentFilter, options.eventStateFilter, options.eventTypeFilter, options.priorityFilter, options.notificationClassFilter);
    baBvlc.encode(buffer.buffer, baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU, buffer.offset);
    this._sendConfirmed(address, buffer, settings, (err, data) => {
      if (err) return next(err);
      const result = baServices.getEnrollmentSummary.decodeAcknowledge(data.buffer, data.offset, data.length);
      if (!result) return next(new Error('INVALID_DECODING'));
      next(null, result);
    });
  }

  unconfirmedEventNotification(address, eventNotification) {
    const buffer = this._getBuffer();
    baNpdu.encode(buffer, baEnum.NpduControlPriority.NORMAL_MESSAGE, address);
    baApdu.encodeUnconfirmedServiceRequest(buffer, baEnum.PduTypes.UNCONFIRMED_REQUEST, baEnum.UnconfirmedServiceChoice.UNCONFIRMED_EVENT_NOTIFICATION);
    baServices.eventNotifyData.encode(buffer, eventNotification);
    baBvlc.encode(buffer.buffer, baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU, buffer.offset);
    this._transport.send(buffer.buffer, buffer.offset, address);
  }

  confirmedEventNotification(address, eventNotification, options, next) {
    next = next || options;
    options = typeof options === 'function' ? {} : options || {};
    const settings = {
      maxSegments: options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
      maxApdu: options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
      invokeId: options.invokeId
    };
    const buffer = this._getBuffer();
    baNpdu.encode(buffer, baEnum.NpduControlPriority.NORMAL_MESSAGE | baEnum.NpduControlBits.EXPECTING_REPLY, address);
    baApdu.encodeConfirmedServiceRequest(buffer, baEnum.PduTypes.CONFIRMED_REQUEST, baEnum.ConfirmedServiceChoice.CONFIRMED_EVENT_NOTIFICATION, settings.maxSegments, settings.maxApdu, settings.invokeId, 0, 0);
    baServices.eventNotifyData.encode(buffer, eventNotification);
    baBvlc.encode(buffer.buffer, baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU, buffer.offset);
    this._sendConfirmed(address, buffer, settings, (err, data) => {
      if (err) return next(err);
      next();
    });
  }

  // Public Device Functions
  readPropertyResponse(receiver, invokeId, objectId, property, value) {
    const buffer = this._getBuffer();
    baNpdu.encode(buffer, baEnum.NpduControlPriority.NORMAL_MESSAGE, receiver);
    baApdu.encodeComplexAck(buffer, baEnum.PduTypes.COMPLEX_ACK, baEnum.ConfirmedServiceChoice.READ_PROPERTY, invokeId);
    baServices.readProperty.encodeAcknowledge(buffer, objectId, property.id, property.index, value);
    baBvlc.encode(buffer.buffer, baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU, buffer.offset);
    this._transport.send(buffer.buffer, buffer.offset, receiver);
  }

  readPropertyMultipleResponse(receiver, invokeId, values) {
    const buffer = this._getBuffer();
    baNpdu.encode(buffer, baEnum.NpduControlPriority.NORMAL_MESSAGE, receiver);
    baApdu.encodeComplexAck(buffer, baEnum.PduTypes.COMPLEX_ACK, baEnum.ConfirmedServiceChoice.READ_PROPERTY_MULTIPLE, invokeId);
    baServices.readPropertyMultiple.encodeAcknowledge(buffer, values);
    baBvlc.encode(buffer.buffer, baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU, buffer.offset);
    this._transport.send(buffer.buffer, buffer.offset, receiver);
  }

  iAmResponse(deviceId, segmentation, vendorId) {
    const buffer = this._getBuffer();
    baNpdu.encode(buffer, baEnum.NpduControlPriority.NORMAL_MESSAGE, this._transport.getBroadcastAddress());
    baApdu.encodeUnconfirmedServiceRequest(buffer, baEnum.PduTypes.UNCONFIRMED_REQUEST, baEnum.UnconfirmedServiceChoice.I_AM);
    baServices.iAmBroadcast.encode(buffer, deviceId, this._transport.getMaxPayload(), segmentation, vendorId);
    baBvlc.encode(buffer.buffer, baEnum.BvlcResultPurpose.ORIGINAL_BROADCAST_NPDU, buffer.offset);
    this._transport.send(buffer.buffer, buffer.offset, this._transport.getBroadcastAddress());
  }

  iHaveResponse(deviceId, objectId, objectName) {
    const buffer = this._getBuffer();
    baNpdu.encode(buffer, baEnum.NpduControlPriority.NORMAL_MESSAGE, this._transport.getBroadcastAddress());
    baApdu.EecodeUnconfirmedServiceRequest(buffer, baEnum.PduTypes.UNCONFIRMED_REQUEST, baEnum.UnconfirmedServiceChoice.I_HAVE);
    baServices.EncodeIhaveBroadcast(buffer, deviceId, objectId, objectName);
    baBvlc.encode(buffer.buffer, baEnum.BvlcResultPurpose.ORIGINAL_BROADCAST_NPDU, buffer.offset);
    this._transport.send(buffer.buffer, buffer.offset, this._transport.getBroadcastAddress());
  }

  simpleAckResponse(receiver, service, invokeId) {
    const buffer = this._getBuffer();
    baNpdu.encode(buffer, baEnum.NpduControlPriority.NORMAL_MESSAGE, receiver);
    baApdu.encodeSimpleAck(buffer, baEnum.PduTypes.SIMPLE_ACK, service, invokeId);
    baBvlc.encode(buffer.buffer, baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU, buffer.offset);
    this._transport.send(buffer.buffer, buffer.offset, receiver);
  }

  errorResponse(receiver, service, invokeId, errorClass, errorCode) {
    const buffer = this._getBuffer();
    baNpdu.encode(buffer, baEnum.NpduControlPriority.NORMAL_MESSAGE, receiver);
    baApdu.encodeError(buffer, baEnum.PduTypes.ERROR, service, invokeId);
    baServices.error.encode(buffer, errorClass, errorCode);
    baBvlc.encode(buffer.buffer, baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU, buffer.offset);
    this._transport.send(buffer.buffer, buffer.offset, receiver);
  }

  /**
   * Unloads the current BACstack instance and closes the underlying UDP socket.
   * @function bacstack.close
   * @example
   * const bacnet = require('bacstack');
   * const client = new bacnet();
   *
   * client.close();
   */
  close() {
    if (this._closed) return;
    this._closed = true;
    if (this._bbmd) {
      clearTimeout(this._bbmd.timeout);
      clearTimeout(this._bbmd.renewal);
      const pending = this._bbmd.pending;
      this._bbmd.pending = null;
      this._bbmd.registered = false;
      if (pending) pending(new Error('ERR_CLIENT_CLOSED'));
    }
    this._segmentStore.forEach(state => clearTimeout(state.timeout));
    this._segmentStore.clear();
    const queued = this._requestQueue;
    this._requestQueue = [];
    const active = Object.keys(this._invokeStore).map(id => this._invokeStore[id]);
    this._transport.close();
    queued.forEach(item => item.callback(new Error('ERR_CLIENT_CLOSED')));
    active.forEach(callback => callback(new Error('ERR_CLIENT_CLOSED')));
    this.emit('close');
  }
}
module.exports = Client;
