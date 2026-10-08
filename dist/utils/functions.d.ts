import ipc from "node-ipc";
import { IValidValue } from "../Interfaces/IValidValue";
type NodeIpc = typeof ipc;
export declare function launchBacnetService(port?: number, serviceName?: string): Promise<boolean>;
export declare function isValidValue(value: any): value is IValidValue;
export declare function isValidValueArray(arr: any): arr is IValidValue[];
export declare function sendBroadcast(ipc: NodeIpc, eventName: string, data?: any): void;
export {};
