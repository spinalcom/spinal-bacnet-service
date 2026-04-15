import net from "net";
import ipc from "node-ipc";
import { COV_EVENT_NAME, DEFAULT_PORT, IPC_RETRY_INTERVAL, MESSAGE_EVENT_NAME, REQUEST_RESPONSE_STATES, RESPONSE_EVENT_NAME, SERVICE_NAME } from "./constants";
import { IBacnetRequest, IBacnetResponse } from "../Interfaces/IBacnetRequest";
import BacnetUtilities from "./BacnetUtilities";
import { EventPayload, SpinalCov } from "./cov";


export async function launchBacnetService(port = DEFAULT_PORT): Promise<void> {
    const isAlreadyRunning = await serverIsRunning(port);
    if (isAlreadyRunning) return console.log(`Bacnet service is already running on port ${port}.`);

    ipc.config.id = SERVICE_NAME;
    ipc.config.retry = IPC_RETRY_INTERVAL;
    ipc.config.silent = true; // Disable IPC logging

    ipc.serveNet("127.0.0.1", port, () => {
        ipc.server.on(MESSAGE_EVENT_NAME, async (data, socket) => listenBacnetEvents(ipc, data, socket));
        ipc.server.on(COV_EVENT_NAME, async (data, socket) => listenBacnetCovEvents(ipc, data, socket));

    });


    ipc.server.start();
}

async function listenBacnetEvents(ipc, data, socket): Promise<void> {
    const { id } = data;
    const result = await handleBacnetRequest(data);
    console.log(result);
    ipc.server.emit(socket, `${RESPONSE_EVENT_NAME}_${id}`, result);
}

async function listenBacnetCovEvents(ipc, data: EventPayload, socket): Promise<void> {
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
        socket.once("connect", () => {
            socket.destroy();
            resolve(true);
        });

        socket.once("error", () => {
            socket.destroy();

            resolve(false);
        });

        socket.connect(port, "127.0.0.1");
    });
}