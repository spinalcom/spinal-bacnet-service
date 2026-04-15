import { EventEmitter } from "stream";
export type EventPayload = {
    error?: {
        message: string;
    };
    key?: string;
    data?: any;
    eventName: string;
};
export declare class SpinalCov extends EventEmitter {
    private static instance;
    private ipc;
    private sockets;
    private constructor();
    static getInstance(): SpinalCov;
    private _listenEventMessage;
    private _subscribeToList;
    private _unsubscribeFromList;
    private _subscribe;
    private _unsubscribe;
    private _subscribeProperty;
    private _listenChangeEvent;
    private _sendEvent;
}
