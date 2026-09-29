import net from "net";
import ipc from "node-ipc";
import { COV_EVENT_NAME, DEFAULT_PORT, IPC_RETRY_INTERVAL, MESSAGE_EVENT_NAME, REQUEST_RESPONSE_STATES, RESPONSE_EVENT_NAME, SERVICE_NAME } from "./constants";
import { IBacnetRequest, IBacnetResponse } from "../Interfaces/IBacnetRequest";
import BacnetUtilities from "./BacnetUtilities";
import { EventPayload, SpinalCov } from "./cov";
import { IValidValue } from "../Interfaces/IValidValue";

type NodeIpc = typeof ipc;

export async function launchBacnetService(port = DEFAULT_PORT, serviceName: string = SERVICE_NAME): Promise<boolean> {
	const isAlreadyRunning = await serverIsRunning(port);
	if (isAlreadyRunning) {
		throw new Error(`A Bacnet service is already running on port ${port}. use a different port, or connect your client to the existing service.`);
		// console.log(`Bacnet service is already running on port ${port}.`);
		// return false;
	}

	ipc.config.id = serviceName;
	ipc.config.retry = IPC_RETRY_INTERVAL;
	ipc.config.silent = true; // Disable IPC logging

	ipc.serveNet("127.0.0.1", port, () => {
		ipc.server.on(MESSAGE_EVENT_NAME, async (data, socket) => listenBacnetEvents(ipc, data, socket));
		ipc.server.on(COV_EVENT_NAME, async (data, socket) => listenBacnetCovEvents(ipc, data, socket));
		console.log(`Bacnet service is listening on port ${port}...`);
	});

	ipc.server.start();
	return true;
}

async function listenBacnetEvents(ipc: NodeIpc, data: IBacnetRequest, socket: net.Socket): Promise<void> {
	const socketId = data._clientId || `${socket.remoteAddress}:${socket.remotePort}`;
	console.log(`[RECEIVED] - Received "${data.name}" Bacnet request from ${socketId}`);
	const { id } = data;
	const result = await handleBacnetRequest(data);
	ipc.server.emit(socket, `${RESPONSE_EVENT_NAME}_${id}`, result);
	console.log(`[SENT] - Sent response for "${data.name}" Bacnet request to ${socketId} with status ${result.status}`);
}

async function listenBacnetCovEvents(ipc: NodeIpc, data: EventPayload, socket: net.Socket): Promise<void> {
	const socketId = data._clientId || `${socket.remoteAddress}:${socket.remotePort}`;
	console.log(`[RECEIVED] - Received COV event from ${socketId}`);
	socket["socketId"] = socketId; // Attach the socketId to the socket for later reference

	SpinalCov.getInstance().emit("message", { data, ipc, socket });
}

async function handleBacnetRequest(data: IBacnetRequest): Promise<IBacnetResponse> {
	try {
		const { name, parameters } = data;
		const functionExists = (BacnetUtilities as any)[name] && typeof (BacnetUtilities as any)[name] === "function";

		if (!functionExists) throw new Error(`Bacnet utility function ${name} not found.`);

		const res = await (BacnetUtilities as any)[name](...parameters);
		return { status: REQUEST_RESPONSE_STATES.success, data: res };
	} catch (error: any) {
		return { status: REQUEST_RESPONSE_STATES.error, error: error.message };
	}
}

function serverIsRunning(port: number): Promise<boolean> {
	return new Promise((resolve, reject) => {
		const socket = new net.Socket();

		const cleanup = () => {
			socket.removeAllListeners();
			socket.destroy();
		};

		socket.once("connect", () => {
			cleanup();
			resolve(true);
		});

		socket.once("error", () => {
			cleanup();
			resolve(false);
		});

		socket.once("timeout", () => {
			cleanup();
			resolve(false);
		});

		socket.connect(port, "127.0.0.1");
	});
}

export function isValidValue(value: any): value is IValidValue {
	return value && typeof value === "object" && "type" in value && "value" in value;
}

export function isValidValueArray(arr: any): arr is IValidValue[] {
	return Array.isArray(arr) && arr.every(isValidValue);
}
