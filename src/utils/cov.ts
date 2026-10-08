import bacnet from "bacstack";
import BacnetUtilities from "./BacnetUtilities";
import { ICovSubscribeReq, IObjectId } from "../Interfaces";
import { BACNET_COV_EVENT_NAME, CLIENT_RESET_EVENT, COV_EVENTS_NAMES } from "./constants";
import { EventEmitter } from "stream";
import net from "net";

export type EventPayload = {
	error?: { message: string };
	key?: string;
	data?: any;
	eventName: string;
	_clientId?: string;
	timestamp?: number;
};

export class SpinalCov extends EventEmitter {
	private static instance: SpinalCov;
	private ipc: any;
	monitoredToSocketMap: Map<string, net.Socket[]> = new Map();
	private monitoredSubscriptions: Map<string, ICovSubscribeReq> = new Map();
	private sockets: any[] = [];

	private constructor() {
		super();
		this._listenEventMessage();
		this._listenClientReset();
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

	private async _subscribeToList(data: any, socket?: net.Socket) {
		for (const d of data) {
			await this._subscribe(d, socket);
		}
	}

	private async _unsubscribeFromList(data: any, socket?: net.Socket) {
		for (const d of data) {
			await this._unsubscribe(d, socket);
		}
	}

	private async _subscribe(data: ICovSubscribeReq, socket?: net.Socket) {
		const client = BacnetUtilities.getClient();
		this._listenChangeEvent(client);

		const key = `${data.ip}_${data.object.type}_${data.object.instance}`;
		this._addSocketToMonitoredKey(key, socket); // add the socket to the monitored key map so that we can send events to it later
		this.monitoredSubscriptions.set(key, data);

		return this._sendSubscribeRequestToBacnet(client, data.ip, data.object)
			.then(() => {
				this._sendEvent({ key, eventName: COV_EVENTS_NAMES.subscribed }, socket); // Notify the client that subscription was successful
			})
			.catch((error) => {
				// If subscription fails, prevent the socket from receiving further events
				this._sendEvent({ key, eventName: COV_EVENTS_NAMES.error, error: { message: (error as Error).message } }, socket);
			});
	}

	private _addSocketToMonitoredKey(key: string, socket?: net.Socket) {
		if (!this.monitoredToSocketMap.has(key)) {
			this.monitoredToSocketMap.set(key, []);
		}

		if (socket) this.monitoredToSocketMap.get(key)?.push(socket);
	}

	private async _unsubscribe(data: ICovSubscribeReq, socket?: net.Socket) {
		const client = BacnetUtilities.getClient();
		const key = `${data.ip}_${data.object.type}_${data.object.instance}`;
		this._removeSocketFromMonitoredKey(key, socket);

		return this._sendSubscribeRequestToBacnet(client, data.ip, data.object, true)
			.then(() => {
				if (!this.monitoredToSocketMap.has(key)) this.monitoredSubscriptions.delete(key);
				this._sendEvent({ key, eventName: COV_EVENTS_NAMES.unsubscribed }, socket);
			})
			.catch((error) => {
				this._sendEvent({ key, eventName: COV_EVENTS_NAMES.error, error: { message: (error as Error).message } }, socket);
			});
	}

	private _removeSocketFromMonitoredKey(key: string, socket?: net.Socket) {
		const sockets = this.monitoredToSocketMap.get(key);
		if (!sockets || sockets.length === 0) return;

		if (!socket) {
			this.monitoredToSocketMap.delete(key);
			return;
		}

		const filtered = sockets.filter((s) => s !== socket);
		if (filtered.length === 0) this.monitoredToSocketMap.delete(key);
		else this.monitoredToSocketMap.set(key, filtered);
	}

	private _listenClientReset() {
		BacnetUtilities.on(CLIENT_RESET_EVENT, async () => {
			await this._resubscribeToCovItems();
		});
	}

	private async _resubscribeToCovItems() {
		const subscriptions = Array.from(this.monitoredSubscriptions.entries());
		if (subscriptions.length === 0) return;

		const client = BacnetUtilities.getClient();
		this._listenChangeEvent(client);

		for (const [key, subscription] of subscriptions) {
			try {
				await this._sendSubscribeRequestToBacnet(client, subscription.ip, subscription.object);
				this._sendEvent({ key, eventName: COV_EVENTS_NAMES.subscribed });
			} catch (error) {
				this._sendEvent({ key, eventName: COV_EVENTS_NAMES.error, error: { message: (error as Error).message } });
			}
		}
	}

	private _sendSubscribeRequestToBacnet(client: bacnet, ip: string, object: IObjectId, cancel = false) {
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

	private _sendEvent(data: EventPayload, socket?: net.Socket) {
		// process.send(data);
		// eventEmitter.emit("message", data);
		const socketsToSend = socket ? [socket] : this.monitoredToSocketMap.get(data.key || "") || [];

		for (const socket of socketsToSend) {
			console.log(`[COV] - ${data.key} changed - sending event to ${socket["socketId"]}`);
			this.ipc.server.emit(socket, BACNET_COV_EVENT_NAME, data);
		}
	}
}
