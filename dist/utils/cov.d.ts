import { EventEmitter } from "stream";
import net from "net";
export type EventPayload = {
    error?: {
        message: string;
    };
    key?: string;
    data?: any;
    eventName: string;
    _clientId?: string;
    timestamp?: number;
};
export declare class SpinalCov extends EventEmitter {
    private static instance;
    private ipc;
    monitoredToSocketMap: Map<string, net.Socket[]>;
    private monitoredSubscriptions;
    private sockets;
    private constructor();
    static getInstance(): SpinalCov;
    private _listenEventMessage;
    private _subscribeToList;
    private _unsubscribeFromList;
    private _subscribe;
    private _addSocketToMonitoredKey;
    private _unsubscribe;
    private _removeSocketFromMonitoredKey;
    private _listenClientReset;
    private _resubscribeToCovItems;
    private _sendSubscribeRequestToBacnet;
    private _listenChangeEvent;
    private _sendEvent;
}
