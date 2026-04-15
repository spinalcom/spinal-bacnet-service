import bacnet from "bacstack";
import BacnetUtilities from "./BacnetUtilities";
import { ICovSubscribeReq, IObjectId } from "../Interfaces";
import { BACNET_COV_EVENT_NAME, COV_EVENTS_NAMES } from "./constants";
import { EventEmitter } from "stream";


export type EventPayload = {
    error?: { message: string };
    key?: string;
    data?: any;
    eventName: string;
};


export class SpinalCov extends EventEmitter {

    private static instance: SpinalCov
    private ipc: any;
    private sockets: any[] = [];

    private constructor() {
        super();
        this._listenEventMessage();
    }

    public static getInstance(): SpinalCov {
        if (!this.instance) {
            this.instance = new SpinalCov();
        }
        return this.instance;
    }

    private _listenEventMessage() {
        this.on("message", async ({ data, ipc, socket }) => {
            if (!this.ipc) this.ipc = ipc;

            this.sockets.push(socket); // Store the socket for later use

            switch (data.eventName) {
                case COV_EVENTS_NAMES.subscribe:
                    await this._subscribeToList(data.data, socket);
                    break;

                case COV_EVENTS_NAMES.unsubscribe:
                    await this._unsubscribeFromList(data.data, socket);
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

        });
    }

    private async _subscribeToList(data: any, socket?: any) {
        for (const d of data) {
            await this._subscribe(d, socket);
        }
    }

    private async _unsubscribeFromList(data: any, socket?: any) {
        for (const d of data) {
            await this._unsubscribe(d, socket);
        }
    }

    private async _subscribe(data: ICovSubscribeReq, socket?: any) {

        const client = await BacnetUtilities.getClient();
        const key = `${data.ip}_${data.object.type}_${data.object.instance}`;

        this._listenChangeEvent(client);


        try {
            await this._subscribeProperty(client, data.ip, data.object);
            this._sendEvent({ key, eventName: COV_EVENTS_NAMES.subscribed }, socket);
        } catch (error) {
            this._sendEvent({ key, eventName: COV_EVENTS_NAMES.error, error: { message: (error as Error).message } }, socket);
        }
    }

    private async _unsubscribe(data: ICovSubscribeReq, socket?: any) {

        const client = await BacnetUtilities.getClient();
        const key = `${data.ip}_${data.object.type}_${data.object.instance}`;
        try {
            const cancel = true;
            await this._subscribeProperty(client, data.ip, data.object, cancel);
            this._sendEvent({ key, eventName: COV_EVENTS_NAMES.unsubscribed }, socket);
        } catch (error) {
            this._sendEvent({ key, eventName: COV_EVENTS_NAMES.error, error: { message: (error as Error).message } }, socket);
        }
    }


    private _subscribeProperty(client: bacnet, ip: string, object: IObjectId, cancel = false) {

        return new Promise((resolve, reject) => {
            try {
                const subscribe_id = `${ip}_${object.type}_${object.instance}`;

                client.subscribeCOV(ip, object, subscribe_id, cancel, false, 0, (err: Error, value: any) => {
                    if (err) return reject(err);
                    resolve(subscribe_id);
                });

            } catch (error) {
                return reject(error);
            }

        });

    }

    private _listenChangeEvent(client: bacnet) {
        if (client.listenerCount("covNotifyUnconfirmed") > 0) return; // already listening

        client.on("covNotifyUnconfirmed", (data: any) => {
            this._sendEvent({ key: data.address, eventName: COV_EVENTS_NAMES.changed, data });
        });

    }

    private _sendEvent(data: EventPayload, socket?: any) {
        // process.send(data);
        // eventEmitter.emit("message", data);
        const socketsToSend = socket ? [socket] : this.sockets;

        for (const socket of socketsToSend) {
            this.ipc.server.emit(socket, BACNET_COV_EVENT_NAME, data);
        }

    }
}

