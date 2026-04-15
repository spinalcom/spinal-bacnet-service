"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpinalCov = void 0;
const BacnetUtilities_1 = __importDefault(require("./BacnetUtilities"));
const constants_1 = require("./constants");
const stream_1 = require("stream");
class SpinalCov extends stream_1.EventEmitter {
    constructor() {
        super();
        this.sockets = [];
        this._listenEventMessage();
    }
    static getInstance() {
        if (!this.instance) {
            this.instance = new SpinalCov();
        }
        return this.instance;
    }
    _listenEventMessage() {
        this.on("message", (_a) => __awaiter(this, [_a], void 0, function* ({ data, ipc, socket }) {
            if (!this.ipc)
                this.ipc = ipc;
            this.sockets.push(socket); // Store the socket for later use
            switch (data.eventName) {
                case constants_1.COV_EVENTS_NAMES.subscribe:
                    yield this._subscribeToList(data.data, socket);
                    break;
                case constants_1.COV_EVENTS_NAMES.unsubscribe:
                    yield this._unsubscribeFromList(data.data, socket);
                    break;
                // case COV_EVENTS_NAMES.subscribed:
                //     console.log("[COV] - Subscribed to", result.key);
                //     break;
                // case COV_EVENTS_NAMES.error:
                //     console.error(`[COV] - Failed  due to", "${result.error?.message}"`);
                //     break;
                // case COV_EVENTS_NAMES.changed:
                //     console.log("[COV] - Change detected for", result.key, "with data:", result.data);
                //     break;
            }
        }));
    }
    _subscribeToList(data, socket) {
        return __awaiter(this, void 0, void 0, function* () {
            for (const d of data) {
                yield this._subscribe(d, socket);
            }
        });
    }
    _unsubscribeFromList(data, socket) {
        return __awaiter(this, void 0, void 0, function* () {
            for (const d of data) {
                yield this._unsubscribe(d, socket);
            }
        });
    }
    _subscribe(data, socket) {
        return __awaiter(this, void 0, void 0, function* () {
            const client = yield BacnetUtilities_1.default.getClient();
            const key = `${data.ip}_${data.object.type}_${data.object.instance}`;
            this._listenChangeEvent(client);
            try {
                yield this._subscribeProperty(client, data.ip, data.object);
                this._sendEvent({ key, eventName: constants_1.COV_EVENTS_NAMES.subscribed }, socket);
            }
            catch (error) {
                this._sendEvent({ key, eventName: constants_1.COV_EVENTS_NAMES.error, error: { message: error.message } }, socket);
            }
        });
    }
    _unsubscribe(data, socket) {
        return __awaiter(this, void 0, void 0, function* () {
            const client = yield BacnetUtilities_1.default.getClient();
            const key = `${data.ip}_${data.object.type}_${data.object.instance}`;
            try {
                const cancel = true;
                yield this._subscribeProperty(client, data.ip, data.object, cancel);
                this._sendEvent({ key, eventName: constants_1.COV_EVENTS_NAMES.unsubscribed }, socket);
            }
            catch (error) {
                this._sendEvent({ key, eventName: constants_1.COV_EVENTS_NAMES.error, error: { message: error.message } }, socket);
            }
        });
    }
    _subscribeProperty(client, ip, object, cancel = false) {
        return new Promise((resolve, reject) => {
            try {
                const subscribe_id = `${ip}_${object.type}_${object.instance}`;
                client.subscribeCOV(ip, object, subscribe_id, cancel, false, 0, (err, value) => {
                    if (err)
                        return reject(err);
                    resolve(subscribe_id);
                });
            }
            catch (error) {
                return reject(error);
            }
        });
    }
    _listenChangeEvent(client) {
        if (client.listenerCount("covNotifyUnconfirmed") > 0)
            return; // already listening
        client.on("covNotifyUnconfirmed", (data) => {
            this._sendEvent({ key: data.address, eventName: constants_1.COV_EVENTS_NAMES.changed, data });
        });
    }
    _sendEvent(data, socket) {
        // process.send(data);
        // eventEmitter.emit("message", data);
        const socketsToSend = socket ? [socket] : this.sockets;
        for (const socket of socketsToSend) {
            this.ipc.server.emit(socket, constants_1.BACNET_COV_EVENT_NAME, data);
        }
    }
}
exports.SpinalCov = SpinalCov;
//# sourceMappingURL=cov.js.map