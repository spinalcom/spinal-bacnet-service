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
        this.monitoredToSocketMap = new Map();
        this.monitoredSubscriptions = new Map();
        this.sockets = [];
        this._listenEventMessage();
        this._listenClientReset();
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
            const client = BacnetUtilities_1.default.getClient();
            this._listenChangeEvent(client);
            const key = `${data.ip}_${data.object.type}_${data.object.instance}`;
            this._addSocketToMonitoredKey(key, socket); // add the socket to the monitored key map so that we can send events to it later
            this.monitoredSubscriptions.set(key, data);
            return this._sendSubscribeRequestToBacnet(client, data.ip, data.object)
                .then(() => {
                this._sendEvent({ key, eventName: constants_1.COV_EVENTS_NAMES.subscribed }, socket); // Notify the client that subscription was successful
            })
                .catch((error) => {
                // If subscription fails, prevent the socket from receiving further events
                this._sendEvent({ key, eventName: constants_1.COV_EVENTS_NAMES.error, error: { message: error.message } }, socket);
            });
        });
    }
    _addSocketToMonitoredKey(key, socket) {
        var _a;
        if (!this.monitoredToSocketMap.has(key)) {
            this.monitoredToSocketMap.set(key, []);
        }
        if (socket)
            (_a = this.monitoredToSocketMap.get(key)) === null || _a === void 0 ? void 0 : _a.push(socket);
    }
    _unsubscribe(data, socket) {
        return __awaiter(this, void 0, void 0, function* () {
            const client = BacnetUtilities_1.default.getClient();
            const key = `${data.ip}_${data.object.type}_${data.object.instance}`;
            this._removeSocketFromMonitoredKey(key, socket);
            return this._sendSubscribeRequestToBacnet(client, data.ip, data.object, true)
                .then(() => {
                if (!this.monitoredToSocketMap.has(key))
                    this.monitoredSubscriptions.delete(key);
                this._sendEvent({ key, eventName: constants_1.COV_EVENTS_NAMES.unsubscribed }, socket);
            })
                .catch((error) => {
                this._sendEvent({ key, eventName: constants_1.COV_EVENTS_NAMES.error, error: { message: error.message } }, socket);
            });
        });
    }
    _removeSocketFromMonitoredKey(key, socket) {
        const sockets = this.monitoredToSocketMap.get(key);
        if (!sockets || sockets.length === 0)
            return;
        if (!socket) {
            this.monitoredToSocketMap.delete(key);
            return;
        }
        const filtered = sockets.filter((s) => s !== socket);
        if (filtered.length === 0)
            this.monitoredToSocketMap.delete(key);
        else
            this.monitoredToSocketMap.set(key, filtered);
    }
    _listenClientReset() {
        BacnetUtilities_1.default.on(constants_1.CLIENT_RESET_EVENT, () => __awaiter(this, void 0, void 0, function* () {
            yield this._resubscribeToCovItems();
        }));
    }
    _resubscribeToCovItems() {
        return __awaiter(this, void 0, void 0, function* () {
            const subscriptions = Array.from(this.monitoredSubscriptions.entries());
            if (subscriptions.length === 0)
                return;
            const client = BacnetUtilities_1.default.getClient();
            this._listenChangeEvent(client);
            for (const [key, subscription] of subscriptions) {
                try {
                    yield this._sendSubscribeRequestToBacnet(client, subscription.ip, subscription.object);
                    this._sendEvent({ key, eventName: constants_1.COV_EVENTS_NAMES.subscribed });
                }
                catch (error) {
                    this._sendEvent({ key, eventName: constants_1.COV_EVENTS_NAMES.error, error: { message: error.message } });
                }
            }
        });
    }
    _sendSubscribeRequestToBacnet(client, ip, object, cancel = false) {
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
        const socketsToSend = socket ? [socket] : this.monitoredToSocketMap.get(data.key || "") || [];
        for (const socket of socketsToSend) {
            console.log(`[COV] - ${data.key} changed - sending event to ${socket["socketId"]}`);
            this.ipc.server.emit(socket, constants_1.BACNET_COV_EVENT_NAME, data);
        }
    }
}
exports.SpinalCov = SpinalCov;
//# sourceMappingURL=cov.js.map