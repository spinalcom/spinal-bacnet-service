import { IValidValue } from "../Interfaces/IValidValue";
export declare function launchBacnetService(port?: number, serviceName?: string): Promise<boolean>;
export declare function isValidValue(value: any): value is IValidValue;
export declare function isValidValueArray(arr: any): arr is IValidValue[];
