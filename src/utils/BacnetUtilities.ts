/*
 * Copyright 2021 SpinalCom - www.spinalcom.com
 * 
 * This file is part of SpinalCore.
 * 
 * Please read all of the following terms and conditions
 * of the Free Software license Agreement ("Agreement")
 * carefully.
 * 
 * This Agreement is a legally binding contract between
 * the Licensee (as defined below) and SpinalCom that
 * sets forth the terms and conditions that govern your
 * use of the Program. By installing and/or using the
 * Program, you agree to abide by all the terms and
 * conditions stated or referenced herein.
 * 
 * If you do not agree to abide by these terms and
 * conditions, do not demonstrate your acceptance and do
 * not install or use the Program.
 * You should have received a copy of the license along
 * with this file. If not, see
 * <http://resources.spinalcom.com/licenses.pdf>.
 */

import * as lodash from "lodash";
import bacnet from "bacstack";
import { ObjectTypes, PropertyIds, PropertyNames, ObjectTypesCode, UNITS_TYPES, APPLICATION_TAGS } from "./GlobalVariables";
import { IDevice, IObjectId, IReadPropertyMultiple, IRequestArray, IReadProperty, ICovData, IWriteRequest } from "../Interfaces";
import { SEGMENTATIONS } from "./GlobalVariables";
import EventEmitter from "node:events";
import { CLIENT_RESET_EVENT } from "./constants";


class BacnetUtilitiesClass extends EventEmitter {

   private static instance: BacnetUtilitiesClass;
   private _client: bacnet = null;

   private constructor() {
      super();
   }

   private clientState = {
      // failed: { count: 0, time: null },
      // success: { count: 0, time: null },
      consecutiveFailures: 0
   }

   public static getInstance(): BacnetUtilitiesClass {
      if (!this.instance) this.instance = new BacnetUtilitiesClass();
      return this.instance;
   }

   public createNewBacnetClient(): bacnet {
      const client = new bacnet();
      this._listenClientErrorEvent(client);
      return client;
   }

   public getClient(): Promise<bacnet> {
      return new Promise((resolve) => {
         if (!this._client) this._client = this.createNewBacnetClient();

         return resolve(this._client);
      });

   }

   public incrementState(state: "failed" | "success") {
      if (state === "failed") {
         this.clientState.consecutiveFailures++;

         // reset client if consecutive failures
         if (this.clientState.consecutiveFailures >= 5) {

            this._client = null; // reset client after 5 consecutive failures;

            this.emit(CLIENT_RESET_EVENT);

            this.clientState.consecutiveFailures = 0;
         }

      } else {
         this.clientState.consecutiveFailures = 0;
      }
   }

   private _listenClientErrorEvent(client: bacnet): void {

      client.on('close', () => {
         console.log("client closed");
         // this._client = null;
      });

      client.on('timeout', () => {
         console.log("client timeout");
         // this._client = null;
      });

      client.on('error', () => {
         console.log("error client");
         // this._client = null;
      });
   }

   ////////////////////////////////////////////////////////////////
   ////                  READ BACNET DATA                        //
   ////////////////////////////////////////////////////////////////

   public readPropertyMultiple(address: string, sadr: any, requestArray: IRequestArray | IRequestArray[]): Promise<IReadPropertyMultiple> {
      return new Promise(async (resolve, reject) => {
         try {
            const client = await this.getClient();
            requestArray = Array.isArray(requestArray) ? requestArray : [requestArray];
            if (sadr && typeof sadr == "object") sadr = Object.keys(sadr).length === 0 ? null : sadr;

            client.readPropertyMultiple(address, sadr, requestArray, (err: Error, data: any) => {
               if (err) {
                  // this.incrementState("failed");
                  reject(err);
                  return;
               }

               this.incrementState("success");
               resolve(data);
            })
         } catch (error) {
            reject(error);
         }
      });
   }

   public async readProperty(address: string, sadr: any, objectId: IObjectId, propertyId: number | string, clientOptions?: any): Promise<IReadProperty> {

      const client = await this.getClient();
      const options = clientOptions || {};
      if (sadr && typeof sadr == "object") sadr = Object.keys(sadr).length === 0 ? null : sadr;

      return new Promise((resolve, reject) => {
         client.readProperty(address, sadr, objectId, propertyId, options, (err: Error, data: any) => {
            if (err) {
               // this.incrementState("failed");
               return reject(err);
            }

            this.incrementState("success");
            resolve(data);
         })
      });
   }

   ////////////////////////////////////////////////////////////////
   ////                  GET ALL BACNET OBJECT LIST              //
   ////////////////////////////////////////////////////////////////

   public async _getDeviceObjectList(device: IDevice, SENSOR_TYPES: Array<number>, getListUsingFragment: boolean = false): Promise<IObjectId[]> {
      const objectId = { type: ObjectTypes.OBJECT_DEVICE, instance: device.deviceId };
      let values;
      const deviceAddress = device.address;
      if (!deviceAddress) throw new Error("Device address is required");

      try {
         if (getListUsingFragment) throw new Error("reason:4") // Force to use fragment method;

         const deviceAcceptSegmentation = [SEGMENTATIONS.SEGMENTATION_BOTH, SEGMENTATIONS.SEGMENTATION_TRANSMIT].indexOf(device.segmentation) != -1;

         if (deviceAcceptSegmentation) {
            const params = [{ objectId: objectId, properties: [{ id: PropertyIds.PROP_OBJECT_LIST }] }]
            let data = await this.readPropertyMultiple(deviceAddress, device.SADR, params);
            const dataFormatted = data.values.map(el => el.values.map(el2 => el2.value));
            values = lodash.flattenDeep(dataFormatted);
         } else {
            let data = await this.readProperty(deviceAddress, device.SADR, objectId, PropertyIds.PROP_OBJECT_LIST);
            values = data.values;
         }

      } catch (error: any) {
         // error reason:4 means that the device does not support segmentation or the response is too big, so we can retry with fragment method
         if (error.message.match(/reason:4/i) || error.message.match(/err_timeout/i)) values = await this.getItemListByFragment(device, objectId);
      }

      // If values is still undefined or empty after trying both methods, throw an error
      if (typeof values === "undefined" || !values?.length) throw new Error("No values found");

      return values.filter((item: any) => SENSOR_TYPES.indexOf(item.value.type) !== -1);
   }

   public async getItemListByFragment(device: IDevice, objectId: IObjectId): Promise<IObjectId[]> {
      const bacnetItemsFound: IObjectId[] = [];
      let error: Error;
      let index = 1;
      let finish = false;

      const deviceAddress = device.address;
      if (!deviceAddress) throw new Error("Device address is required");

      return new Promise(async (resolve) => {

         while (!error && !finish) {
            try {
               const clientOptions = { arrayIndex: index }
               const value = await this.readProperty(deviceAddress, device.SADR, objectId, PropertyIds.PROP_OBJECT_LIST, clientOptions);
               if (value) {
                  index++;
                  bacnetItemsFound.push(...(value.values as any[]));
               } else {
                  finish = true;
               }

            } catch (err: any) {
               error = err;
            }
         }

         resolve(bacnetItemsFound);
      });
   }

   ////////////////////////////////////////////////////////////////
   ////                  GET OBJECT DETAIL                       //
   ////////////////////////////////////////////////////////////////

   public async _getObjectDetail(device: IDevice, objects: IObjectId[]): Promise<{ [key: string]: string | boolean | number }[]> {

      let objectLists: (IObjectId | IObjectId[])[] = [...objects];

      let objectListDetails: ({ [key: string]: string | boolean | number })[] = [];
      const deviceAcceptSegmentation = [SEGMENTATIONS.SEGMENTATION_BOTH, SEGMENTATIONS.SEGMENTATION_TRANSMIT].indexOf(device.segmentation) !== -1;

      const callbackFunc = deviceAcceptSegmentation ? this._getObjectDetailWithReadPropertyMultiple : this._getObjectDetailWithReadProperty;


      if (deviceAcceptSegmentation) {
         objectLists = lodash.chunk(objects, 10) as IObjectId[][];
      }

      while (objectLists.length > 0) {
         const object: any = objectLists.shift();
         if (object) {
            try {
               const res = await callbackFunc.call(this, device, object);
               objectListDetails.push(res);
            } catch (err) {
               if (deviceAcceptSegmentation) {
                  const itemsFound = await this._retryGetObjectDetailWithReadProperty(object, device);
                  if (itemsFound.length > 0) objectListDetails.push(itemsFound);
               }
            }
         }
      }

      if (deviceAcceptSegmentation) objectListDetails = lodash.flattenDeep(objectListDetails as any[]);

      return objectListDetails;

   }

   private async _retryGetObjectDetailWithReadProperty(items: any, device: IDevice): Promise<any> {
      const itemsFound: any[] = [];
      let failedCount = 0;

      for (const item of items) {
         try {
            const res = await this._getObjectDetailWithReadProperty(device, item);
            if (res) itemsFound.push(res);
            failedCount = 0;
         } catch (error) {
            if (failedCount >= 5) throw error; // stop retrying after 5 consecutive failures
         }
      }


      if (failedCount == items.length) throw new Error("Failed to get details for all items");

      return itemsFound;
   }

   public async _getObjectDetailWithReadPropertyMultiple(device: IDevice, objects: IObjectId[]): Promise<any[]> {

      try {
         const deviceAddress = device.address;
         if (!deviceAddress) throw new Error("Device address is required");

         const requestArray: IRequestArray[] = objects.map(el => ({
            objectId: JSON.parse(JSON.stringify(el)),
            properties: [
               { id: PropertyIds.PROP_OBJECT_NAME },
               { id: PropertyIds.PROP_PRESENT_VALUE },
               { id: PropertyIds.PROP_DESCRIPTION },
               { id: PropertyIds.PROP_OBJECT_TYPE },
               { id: PropertyIds.PROP_UNITS },
               { id: PropertyIds.PROP_MAX_PRES_VALUE },
               { id: PropertyIds.PROP_MIN_PRES_VALUE },
               { id: PropertyIds.PROP_BIT_TEXT },
            ]
         }))
         const data = await this.readPropertyMultiple(deviceAddress, device.SADR, requestArray);

         return data.values.map(el => {
            const { objectId } = el;

            const itemInfo: any = {
               objectId: objectId,
               id: objectId.instance,
               typeId: objectId.type,
               type: this._getObjectTypeByCode(objectId.type),
               instance: objectId.instance,
               deviceId: device.deviceId
            }

            const formated: any = this._formatProperty(el);

            for (let key in formated) {
               itemInfo[key] = formated[key];
            }

            return itemInfo;
         });

      } catch (error) {
         throw error;
      }
   }

   public async _getObjectDetailWithReadProperty(device: IDevice, objectId: IObjectId): Promise<any> {

      const properties = [
         PropertyIds.PROP_OBJECT_NAME, PropertyIds.PROP_PRESENT_VALUE, PropertyIds.PROP_DESCRIPTION,
         PropertyIds.PROP_OBJECT_TYPE, PropertyIds.PROP_UNITS,
         PropertyIds.PROP_MAX_PRES_VALUE, PropertyIds.PROP_MIN_PRES_VALUE, PropertyIds.PROP_BIT_TEXT
      ]

      const propertiesLength = properties.length;

      const itemInfo: any = {
         objectId: objectId,
         id: objectId.instance,
         typeId: objectId.type,
         type: this._getObjectTypeByCode(objectId.type),
         instance: objectId.instance,
         deviceId: device.deviceId
      };

      const deviceAddress = device.address;
      if (!deviceAddress) throw new Error("Device address is required");
      let failedCount = 0;

      while (properties.length > 0) {
         try {
            const property = properties.shift();
            if (typeof property !== "undefined") {
               // console.log("property not undefined");
               const formated = await this._getPropertyValue(deviceAddress, device.SADR, objectId, property);

               for (let key in formated) {
                  itemInfo[key] = formated[key];
               }
            }

         } catch (error) {
            failedCount++;
            // console.error(error);
         }
      }

      if (failedCount === propertiesLength) throw new Error("failed to get object details");

      return itemInfo;
   }

   public async _getChildrenNewValue(device: IDevice, children: Array<IObjectId>): Promise<Array<{ id: string | number; type: string | number; currentValue: any }> | undefined> {
      const deviceAcceptSegmentation = [SEGMENTATIONS.SEGMENTATION_BOTH, SEGMENTATIONS.SEGMENTATION_TRANSMIT].indexOf(device.segmentation) !== -1;

      if (deviceAcceptSegmentation) return this.getChildrenNewValueWithReadPropertyMultiple(device, children);

      return this.getChildrenNewValueWithReadProperty(device, children);
   }

   private async getChildrenNewValueWithReadPropertyMultiple(device: IDevice, children: Array<IObjectId>): Promise<Array<{ id: string | number; type: string | number; currentValue: any }> | undefined> {

      try {
         const requestArray = children.map(el => ({ objectId: el, properties: [{ id: PropertyIds.PROP_PRESENT_VALUE }] }));

         const list_chunked = lodash.chunk(requestArray, 50);
         const deviceAddress = device.address;
         if (!deviceAddress) throw new Error("Device address is required");

         const res: any[] = [];

         while (list_chunked.length > 0) {
            const arr = list_chunked.pop();
            if (!arr) continue;

            const data = await this.readPropertyMultiple(deviceAddress, device.SADR, arr);

            const dataFormated = data.values.map(el => {
               const value = this._getObjValue(el.values[0].value);
               return {
                  id: el.objectId.instance,
                  type: el.objectId.type,
                  currentValue: this._formatCurrentValue(value, el.objectId.type)
               }
            })

            res.push(dataFormated);
         }

         return lodash.flattenDeep(res);

      } catch (error) {
         throw error;
      }
   }

   private async getChildrenNewValueWithReadProperty(device: IDevice, children: Array<IObjectId>): Promise<Array<{ id: string | number; type: string | number; currentValue: any }> | undefined> {
      const res: any[] = [];

      try {
         const deep_children = [...children];
         let rejectCount = 0;

         while (deep_children.length > 0) {
            const child: any = deep_children.shift();
            const deviceAddress = device.address;
            if (!deviceAddress) throw new Error("Device address is required");

            if (child) {
               try {
                  child.id = child.instance;
                  const data = await this.readProperty(deviceAddress, device.SADR, child, PropertyIds.PROP_PRESENT_VALUE);
                  const value = data.values[0]?.value;
                  child.currentValue = this._getObjValue(value);
                  res.push(child);
               } catch (error) {
                  rejectCount++;
               }
            }
         }

         if (rejectCount === children.length) throw new Error("Failed to get values for all children");
         return res;

      } catch (error) {
         throw error;
      }
   }


   /////////////////////////////////////////////////////////////////////
   ////                  PILOT BACNET                               ////
   /////////////////////////////////////////////////////////////////////

   public async writeProperty(request: IWriteRequest, releasePriority: boolean = false): Promise<any> {
      const types = this._getPossibleDataTypes(request.objectId.type);
      let success = false;
      let data = null;

      while (types.length > 0 && !success) {
         const type = types.shift();
         try {
            if (typeof type === "undefined") throw new Error("No more data types to try");
            data = await this._writePropertyWithType(request, type);
            success = true;
            if (releasePriority) await this._releasePriority(request, type);
         } catch (error) { }
      }

      if (!success) throw new Error("Failed to write property with all possible data types");
      console.log("success")
      return data;
   }


   private async _writePropertyWithType(request: IWriteRequest, dataType: number): Promise<any> {
      return new Promise(async (resolve, reject) => {
         const client = await BacnetUtilities.getClient();
         const value = dataType === APPLICATION_TAGS.BACNET_APPLICATION_TAG_ENUMERATED ? (request.value ? 1 : 0) : request.value;

         const priority = this._getBacnetPriority(request);

         if (!request.SADR || typeof request.SADR === "object" && Object.keys(request.SADR).length === 0) request.SADR = null;

         client.writeProperty(request.address, request.SADR, request.objectId, PropertyIds.PROP_PRESENT_VALUE, [{ type: dataType, value: value }], { priority }, (err: Error, value: any) => {
            if (err) {
               reject(err);
               return;
            }

            resolve(value);
         })
      });

   }

   private async _releasePriority(request: IWriteRequest, type: number): Promise<void> {
      const requestCopy = JSON.parse(JSON.stringify(request));
      requestCopy.value = null;
      return this._writePropertyWithType(requestCopy, type);
   }



   //////////////////////////////////////////////////////////////////////
   ////                             OTHER UTILITIES                  ////
   //////////////////////////////////////////////////////////////////////


   public async _getPropertyValue(address: string, sadr: any, objectId: IObjectId, propertyId: number | string): Promise<any> {
      const data = await this.readProperty(address, sadr, objectId, propertyId);
      const formated: any = this._formatProperty(data);
      return formated;
   }

   public async getDeviceId(address: string, sadr: any): Promise<number> {
      const objectId = { type: ObjectTypes.OBJECT_DEVICE, instance: PropertyIds.MAX_BACNET_PROPERTY_ID };
      const data = await this.readProperty(address, sadr, objectId, PropertyIds.PROP_OBJECT_IDENTIFIER);
      return data.values[0].value.instance;
   }


   public _formatProperty(propertyValue: any): { [key: string]: boolean | string | number } {
      if (propertyValue) {
         const { values, property } = propertyValue;

         const obj: any = {};

         for (const { id, value } of values) {
            const argId = id || property?.id;
            const propertyName = this._getPropertyNameByCode(argId);

            if (propertyName) {
               obj[propertyName] = this._getObjValue(value);
            }
         }

         if (typeof obj.units !== "undefined") {
            if (typeof obj.units === "object") obj.units = "";
            else obj.units = this._getUnitsByCode(obj.units);
         }


         return obj;
      }

      return {}

   }

   public _getObjValue(value: any): boolean | string | number {
      if (typeof value !== "object") return value;

      let temp_value = Array.isArray(value) ? value[0]?.value : value.value;
      return typeof temp_value === "object" ? "" : temp_value;
   }

   public _formatCurrentValue(value: any, type: number | string): boolean | string | number {
      if ([ObjectTypes.OBJECT_BINARY_INPUT, ObjectTypes.OBJECT_BINARY_VALUE].indexOf(type) !== -1) {
         return value ? true : false;
      }

      return value;
   }

   public _getPropertyNameByCode(type: number): string | undefined {
      const property = PropertyNames[type];
      if (property) return property.toLocaleLowerCase().replace('prop_', '');
      return;
   }

   public _getObjectTypeByCode(typeCode: number | string): string | undefined {
      const property = ObjectTypesCode[typeCode];
      if (property) return property.toLocaleLowerCase().replace('object_', '');
      return;
   }

   public _getUnitsByCode(typeCode: number): string | undefined {
      const property = UNITS_TYPES[typeCode];
      if (property) return property.toLocaleLowerCase().replace('units_', '').replace("_", " ");
      return;
   }

   private _getPossibleDataTypes(type: number | string): number[] {
      const analogTypes = new Set([
         ObjectTypes.OBJECT_ANALOG_INPUT,
         ObjectTypes.OBJECT_ANALOG_OUTPUT,
         ObjectTypes.OBJECT_ANALOG_VALUE,
         ObjectTypes.OBJECT_MULTI_STATE_INPUT,
         ObjectTypes.OBJECT_MULTI_STATE_OUTPUT,
         ObjectTypes.OBJECT_MULTI_STATE_VALUE
      ]);

      const binaryTypes = new Set([
         ObjectTypes.OBJECT_BINARY_INPUT,
         ObjectTypes.OBJECT_BINARY_OUTPUT,
         ObjectTypes.OBJECT_BINARY_VALUE,
         ObjectTypes.OBJECT_BINARY_LIGHTING_OUTPUT
      ]);

      if (analogTypes.has(type)) {
         return [
            APPLICATION_TAGS.BACNET_APPLICATION_TAG_UNSIGNED_INT, APPLICATION_TAGS.BACNET_APPLICATION_TAG_SIGNED_INT,
            APPLICATION_TAGS.BACNET_APPLICATION_TAG_REAL, APPLICATION_TAGS.BACNET_APPLICATION_TAG_DOUBLE
         ];
      }

      if (binaryTypes.has(type)) return [APPLICATION_TAGS.BACNET_APPLICATION_TAG_ENUMERATED, APPLICATION_TAGS.BACNET_APPLICATION_TAG_BOOLEAN];

      return [
         APPLICATION_TAGS.BACNET_APPLICATION_TAG_OCTET_STRING,
         APPLICATION_TAGS.BACNET_APPLICATION_TAG_CHARACTER_STRING,
         APPLICATION_TAGS.BACNET_APPLICATION_TAG_BIT_STRING
      ];
   }

   private _getBacnetPriority(req: any | IWriteRequest): number {
      // if priority is defined in REQ
      if (req.priority && !isNaN(parseInt(req.priority)))
         return parseInt(req.priority);

      // else if priority is defined in .env
      if (process.env.BACNET_PRIORITY && !isNaN(parseInt(process.env.BACNET_PRIORITY)))
         return parseInt(process.env.BACNET_PRIORITY)

      // else use low priority
      return 16;
   }

}


const BacnetUtilities = BacnetUtilitiesClass.getInstance();
export default BacnetUtilities;
export { BacnetUtilities };