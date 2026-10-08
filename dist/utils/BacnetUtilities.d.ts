import bacnet from "bacstack";
import { IDevice, IObjectId, IReadPropertyMultiple, IRequestArray, IReadProperty, IWriteRequest } from "../Interfaces";
import { EventEmitter } from "node:events";
import { CLIENT_RESET_EVENT } from "./constants";
declare class BacnetUtilitiesClass extends EventEmitter {
    private static instance;
    private _client;
    private constructor();
    static getInstance(): BacnetUtilitiesClass;
    createNewBacnetClient(): bacnet;
    getClient(): bacnet;
    private _listenClientErrorEvent;
    [CLIENT_RESET_EVENT](): bacnet;
    readPropertyMultiple(address: string, sadr: any, requestArray: IRequestArray | IRequestArray[]): Promise<IReadPropertyMultiple>;
    readProperty(address: string, sadr: any, objectId: IObjectId, propertyId: number | string, clientOptions?: any): Promise<IReadProperty>;
    _getDeviceObjectList(device: IDevice, SENSOR_TYPES: Array<number>, getListUsingFragment?: boolean): Promise<IObjectId[]>;
    getItemListByFragment(device: IDevice, objectId: IObjectId): Promise<IObjectId[]>;
    _getObjectDetail(device: IDevice, objects: IObjectId[]): Promise<{
        [key: string]: string | boolean | number;
    }[]>;
    deviceIsAvailable(device: IDevice): Promise<boolean>;
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
    writeProperty(request: IWriteRequest, releasePriority?: boolean): Promise<any>;
    private _writePropertyWithType;
    private _convertValueToBoolean;
    private _releasePriority;
    _getPropertyValue(address: string, sadr: any, objectId: IObjectId, propertyId: number | string): Promise<any>;
    getDeviceId(address: string, sadr: any): Promise<number>;
    _formatProperty(propertyValue: any): {
        [key: string]: boolean | string | number;
    };
    _getObjValue(value: any): boolean | string | number | any;
    _formatCurrentValue(value: any, type: number | string): boolean | string | number;
    _getPropertyNameByCode(type: number): string | undefined;
    _getObjectTypeByCode(typeCode: number | string): string | undefined;
    _getUnitsByCode(typeCode: number): string | undefined;
    private _getPossibleDataTypes;
    private _getBacnetPriority;
}
declare const BacnetUtilities: BacnetUtilitiesClass;
export default BacnetUtilities;
export { BacnetUtilities };
