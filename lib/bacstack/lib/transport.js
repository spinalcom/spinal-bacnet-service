'use strict';

const createSocket      = require('dgram').createSocket;
const EventEmitter      = require('events').EventEmitter;

class Transport extends EventEmitter {
  constructor(settings) {
    super();
    this._settings = settings;
    this._ready = false;
    this._closed = false;
    this._pending = [];
    this._server = createSocket({type: 'udp4', reuseAddr: true});
    this._server.on('message', (msg, rinfo) => this.emit('message', msg, rinfo.address, rinfo.port));
    this._server.on('error', (err) => this.emit('error', err));
  }

  getBroadcastAddress() {
    return this._settings.broadcastAddress;
  }

  getMaxPayload() {
    return 1482;
  }

  send(buffer, offset, receiver, next) {
    if (this._closed) {
      const err = new Error('ERR_CLIENT_CLOSED');
      if (next) return next(err);
      this.emit('error', err);
      return;
    }
    if (!this._ready) {
      this._pending.push({buffer: Buffer.from(buffer.slice(0, offset)), offset: offset, receiver: receiver, next: next});
      return;
    }
    const address = typeof receiver === 'string' ? receiver : receiver.address;
    const port = typeof receiver === 'string' || receiver.port === undefined ? this._settings.port : receiver.port;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      const err = new RangeError('Receiver port must be between 1 and 65535');
      if (next) return next(err);
      this.emit('error', err);
      return;
    }
    this._server.send(buffer, 0, offset, port, address, (err) => {
      if (next) return next(err);
      if (err) this.emit('error', err);
    });
  }

  open() {
    this._server.bind(this._settings.port, this._settings.interface, () => {
      if (this._closed) return;
      this._server.setBroadcast(true);
      this._ready = true;
      const pending = this._pending;
      this._pending = [];
      pending.forEach(item => this.send(item.buffer, item.offset, item.receiver, item.next));
      this.emit('listening');
    });
  }

  close() {
    this._closed = true;
    this._ready = false;
    const pending = this._pending;
    this._pending = [];
    pending.forEach(item => {
      if (item.next) item.next(new Error('ERR_CLIENT_CLOSED'));
    });
    this._server.close();
  }
}
module.exports = Transport;
