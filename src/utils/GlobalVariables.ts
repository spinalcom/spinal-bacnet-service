/*
 * Copyright 2022 SpinalCom - www.spinalcom.com
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

import BacnetEnum from './bacnetEnum';


export const ObjectTypes = BacnetEnum.ObjectTypes;
export const PropertyIds = BacnetEnum.PropertyIds;
export const ENUM_DISABLE = BacnetEnum.EnableDisable;
export const APPLICATION_TAGS = BacnetEnum.ApplicationTags;
export const SEGMENTATIONS = BacnetEnum.Segmentations;
export const PropertyNames: { [key: number]: string } = swapObject(BacnetEnum.PropertyIds);
export const ObjectTypesCode: { [key: string]: string } = swapObject(BacnetEnum.ObjectTypes);
export const UNITS_TYPES: { [key: number]: string } = swapObject(BacnetEnum.UnitsId);

/*
* TYPE of item retrieved to devices
*/
export const SENSOR_TYPES: number[] = [
   // ANALOG
   ObjectTypes.OBJECT_ANALOG_INPUT,
   ObjectTypes.OBJECT_ANALOG_OUTPUT,
   ObjectTypes.OBJECT_ANALOG_VALUE,

   // BINARY
   ObjectTypes.OBJECT_BINARY_INPUT,
   ObjectTypes.OBJECT_BINARY_OUTPUT,
   ObjectTypes.OBJECT_BINARY_VALUE,
   ObjectTypes.OBJECT_BINARY_LIGHTING_OUTPUT,

   // MULTI_STATE
   ObjectTypes.OBJECT_MULTI_STATE_INPUT,
   ObjectTypes.OBJECT_MULTI_STATE_OUTPUT,
   ObjectTypes.OBJECT_MULTI_STATE_VALUE,

   ObjectTypes.OBJECT_BITSTRING_VALUE

   //NETWORK
]



function swapObject(json: { [key: string]: number }): { [key: number]: string } {
   const swapped: { [key: number]: string } = {};
   for (const key in json) {
      const value = json[key];
      swapped[value] = key;
   }
   return swapped;
}
