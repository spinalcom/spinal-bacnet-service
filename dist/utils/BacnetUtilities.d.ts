import bacnet from "bacstack";
import { IDevice, IObjectId, IReadPropertyMultiple, IRequestArray, IReadProperty } from "../Interfaces";
import EventEmitter from "node:events";
declare class BacnetUtilitiesClass extends EventEmitter {
    private static instance;
    private _client;
    private constructor();
    private clientState;
    static getInstance(): BacnetUtilitiesClass;
    createNewBacnetClient(): bacnet;
    getClient(): Promise<bacnet>;
    incrementState(state: "failed" | "success"): void;
    private _listenClientErrorEvent;
    readPropertyMultiple(address: string, sadr: any, requestArray: IRequestArray | IRequestArray[]): Promise<IReadPropertyMultiple>;
    readProperty(address: string, sadr: any, objectId: IObjectId, propertyId: number | string, clientOptions?: any): Promise<IReadProperty>;
    _getDeviceObjectList(device: IDevice, SENSOR_TYPES: Array<number>, getListUsingFragment?: boolean): Promise<IObjectId[]>;
    getItemListByFragment(device: IDevice, objectId: IObjectId): Promise<IObjectId[]>;
    _getObjectDetail(device: IDevice, objects: IObjectId[]): Promise<{
        [key: string]: string | boolean | number;
    }[]>;
    private _retryGetObjectDetailWithReadProperty;
    _getObjectDetailWithReadPropertyMultiple(device: IDevice, objects: IObjectId[]): Promise<any[]>;
    _getObjectDetailWithReadProperty(device: IDevice, objectId: IObjectId): Promise<any>;
    _getChildrenNewValue(device: IDevice, children: Array<IObjectId>): Promise<Array<{
        id: string | number;
        type: string | number;
        currentValue: any;
    }> | undefined>;
    private getChildrenNewValueWithReadPropertyMultiple;
    private getChildrenNewValueWithReadProperty;
    _getPropertyValue(address: string, sadr: any, objectId: IObjectId, propertyId: number | string): Promise<any>;
    getDeviceId(address: string, sadr: any): Promise<number>;
    _formatProperty(propertyValue: any): {
        [key: string]: boolean | string | number;
    };
    _getObjValue(value: any): boolean | string | number;
    _formatCurrentValue(value: any, type: number | string): boolean | string | number;
    _getPropertyNameByCode(type: number): string | undefined;
    _getObjectTypeByCode(typeCode: number | string): string | undefined;
    _getUnitsByCode(typeCode: number): string | undefined;
}
declare const BacnetUtilities: BacnetUtilitiesClass;
export default BacnetUtilities;
export { BacnetUtilities };
