"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BacnetUtilities = void 0;
const lodash = __importStar(require("lodash"));
const bacstack_1 = __importDefault(require("bacstack"));
const GlobalVariables_1 = require("./GlobalVariables");
const GlobalVariables_2 = require("./GlobalVariables");
const node_events_1 = __importDefault(require("node:events"));
const constants_1 = require("./constants");
class BacnetUtilitiesClass extends node_events_1.default {
    constructor() {
        super();
        this._client = null;
        this.clientState = {
            // failed: { count: 0, time: null },
            // success: { count: 0, time: null },
            consecutiveFailures: 0
        };
    }
    static getInstance() {
        if (!this.instance)
            this.instance = new BacnetUtilitiesClass();
        return this.instance;
    }
    createNewBacnetClient() {
        const client = new bacstack_1.default();
        this._listenClientErrorEvent(client);
        return client;
    }
    getClient() {
        return new Promise((resolve) => {
            if (!this._client)
                this._client = this.createNewBacnetClient();
            return resolve(this._client);
        });
    }
    incrementState(state) {
        if (state === "failed") {
            this.clientState.consecutiveFailures++;
            // reset client if consecutive failures
            if (this.clientState.consecutiveFailures >= 5) {
                this._client = null; // reset client after 5 consecutive failures;
                this.emit(constants_1.CLIENT_RESET_EVENT);
                this.clientState.consecutiveFailures = 0;
            }
        }
        else {
            this.clientState.consecutiveFailures = 0;
        }
    }
    _listenClientErrorEvent(client) {
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
    readPropertyMultiple(address, sadr, requestArray) {
        return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
            try {
                const client = yield this.getClient();
                requestArray = Array.isArray(requestArray) ? requestArray : [requestArray];
                if (sadr && typeof sadr == "object")
                    sadr = Object.keys(sadr).length === 0 ? null : sadr;
                client.readPropertyMultiple(address, sadr, requestArray, (err, data) => {
                    if (err) {
                        // this.incrementState("failed");
                        reject(err);
                        return;
                    }
                    this.incrementState("success");
                    resolve(data);
                });
            }
            catch (error) {
                reject(error);
            }
        }));
    }
    readProperty(address, sadr, objectId, propertyId, clientOptions) {
        return __awaiter(this, void 0, void 0, function* () {
            const client = yield this.getClient();
            const options = clientOptions || {};
            if (sadr && typeof sadr == "object")
                sadr = Object.keys(sadr).length === 0 ? null : sadr;
            return new Promise((resolve, reject) => {
                client.readProperty(address, sadr, objectId, propertyId, options, (err, data) => {
                    if (err) {
                        // this.incrementState("failed");
                        return reject(err);
                    }
                    this.incrementState("success");
                    resolve(data);
                });
            });
        });
    }
    ////////////////////////////////////////////////////////////////
    ////                  GET ALL BACNET OBJECT LIST              //
    ////////////////////////////////////////////////////////////////
    _getDeviceObjectList(device_1, SENSOR_TYPES_1) {
        return __awaiter(this, arguments, void 0, function* (device, SENSOR_TYPES, getListUsingFragment = false) {
            const objectId = { type: GlobalVariables_1.ObjectTypes.OBJECT_DEVICE, instance: device.deviceId };
            let values;
            const deviceAddress = device.address;
            if (!deviceAddress)
                throw new Error("Device address is required");
            try {
                if (getListUsingFragment)
                    throw new Error("reason:4"); // Force to use fragment method;
                const deviceAcceptSegmentation = [GlobalVariables_2.SEGMENTATIONS.SEGMENTATION_BOTH, GlobalVariables_2.SEGMENTATIONS.SEGMENTATION_TRANSMIT].indexOf(device.segmentation) != -1;
                if (deviceAcceptSegmentation) {
                    const params = [{ objectId: objectId, properties: [{ id: GlobalVariables_1.PropertyIds.PROP_OBJECT_LIST }] }];
                    let data = yield this.readPropertyMultiple(deviceAddress, device.SADR, params);
                    const dataFormatted = data.values.map(el => el.values.map(el2 => el2.value));
                    values = lodash.flattenDeep(dataFormatted);
                }
                else {
                    let data = yield this.readProperty(deviceAddress, device.SADR, objectId, GlobalVariables_1.PropertyIds.PROP_OBJECT_LIST);
                    values = data.values;
                }
            }
            catch (error) {
                // error reason:4 means that the device does not support segmentation or the response is too big, so we can retry with fragment method
                if (error.message.match(/reason:4/i) || error.message.match(/err_timeout/i))
                    values = yield this.getItemListByFragment(device, objectId);
            }
            // If values is still undefined or empty after trying both methods, throw an error
            if (typeof values === "undefined" || !(values === null || values === void 0 ? void 0 : values.length))
                throw new Error("No values found");
            return values.filter((item) => SENSOR_TYPES.indexOf(item.value.type) !== -1);
        });
    }
    getItemListByFragment(device, objectId) {
        return __awaiter(this, void 0, void 0, function* () {
            const bacnetItemsFound = [];
            let error;
            let index = 1;
            let finish = false;
            const deviceAddress = device.address;
            if (!deviceAddress)
                throw new Error("Device address is required");
            return new Promise((resolve) => __awaiter(this, void 0, void 0, function* () {
                while (!error && !finish) {
                    try {
                        const clientOptions = { arrayIndex: index };
                        const value = yield this.readProperty(deviceAddress, device.SADR, objectId, GlobalVariables_1.PropertyIds.PROP_OBJECT_LIST, clientOptions);
                        if (value) {
                            index++;
                            bacnetItemsFound.push(...value.values);
                        }
                        else {
                            finish = true;
                        }
                    }
                    catch (err) {
                        error = err;
                    }
                }
                resolve(bacnetItemsFound);
            }));
        });
    }
    ////////////////////////////////////////////////////////////////
    ////                  GET OBJECT DETAIL                       //
    ////////////////////////////////////////////////////////////////
    _getObjectDetail(device, objects) {
        return __awaiter(this, void 0, void 0, function* () {
            let objectLists = [...objects];
            let objectListDetails = [];
            const deviceAcceptSegmentation = [GlobalVariables_2.SEGMENTATIONS.SEGMENTATION_BOTH, GlobalVariables_2.SEGMENTATIONS.SEGMENTATION_TRANSMIT].indexOf(device.segmentation) !== -1;
            const callbackFunc = deviceAcceptSegmentation ? this._getObjectDetailWithReadPropertyMultiple : this._getObjectDetailWithReadProperty;
            if (deviceAcceptSegmentation) {
                objectLists = lodash.chunk(objects, 10);
            }
            while (objectLists.length > 0) {
                const object = objectLists.shift();
                if (object) {
                    try {
                        const res = yield callbackFunc.call(this, device, object);
                        objectListDetails.push(res);
                    }
                    catch (err) {
                        if (deviceAcceptSegmentation) {
                            const itemsFound = yield this._retryGetObjectDetailWithReadProperty(object, device);
                            if (itemsFound.length > 0)
                                objectListDetails.push(itemsFound);
                        }
                    }
                }
            }
            if (deviceAcceptSegmentation)
                objectListDetails = lodash.flattenDeep(objectListDetails);
            return objectListDetails;
        });
    }
    _retryGetObjectDetailWithReadProperty(items, device) {
        return __awaiter(this, void 0, void 0, function* () {
            const itemsFound = [];
            let failedCount = 0;
            for (const item of items) {
                try {
                    const res = yield this._getObjectDetailWithReadProperty(device, item);
                    if (res)
                        itemsFound.push(res);
                    failedCount = 0;
                }
                catch (error) {
                    if (failedCount >= 5)
                        throw error; // stop retrying after 5 consecutive failures
                }
            }
            if (failedCount == items.length)
                throw new Error("Failed to get details for all items");
            return itemsFound;
        });
    }
    _getObjectDetailWithReadPropertyMultiple(device, objects) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const deviceAddress = device.address;
                if (!deviceAddress)
                    throw new Error("Device address is required");
                const requestArray = objects.map(el => ({
                    objectId: JSON.parse(JSON.stringify(el)),
                    properties: [
                        { id: GlobalVariables_1.PropertyIds.PROP_OBJECT_NAME },
                        { id: GlobalVariables_1.PropertyIds.PROP_PRESENT_VALUE },
                        { id: GlobalVariables_1.PropertyIds.PROP_DESCRIPTION },
                        { id: GlobalVariables_1.PropertyIds.PROP_OBJECT_TYPE },
                        { id: GlobalVariables_1.PropertyIds.PROP_UNITS },
                        { id: GlobalVariables_1.PropertyIds.PROP_MAX_PRES_VALUE },
                        { id: GlobalVariables_1.PropertyIds.PROP_MIN_PRES_VALUE },
                    ]
                }));
                const data = yield this.readPropertyMultiple(deviceAddress, device.SADR, requestArray);
                return data.values.map(el => {
                    const { objectId } = el;
                    const itemInfo = {
                        objectId: objectId,
                        id: objectId.instance,
                        typeId: objectId.type,
                        type: this._getObjectTypeByCode(objectId.type),
                        instance: objectId.instance,
                        deviceId: device.deviceId
                    };
                    const formated = this._formatProperty(el);
                    for (let key in formated) {
                        itemInfo[key] = formated[key];
                    }
                    return itemInfo;
                });
            }
            catch (error) {
                throw error;
            }
        });
    }
    _getObjectDetailWithReadProperty(device, objectId) {
        return __awaiter(this, void 0, void 0, function* () {
            const properties = [
                GlobalVariables_1.PropertyIds.PROP_OBJECT_NAME, GlobalVariables_1.PropertyIds.PROP_PRESENT_VALUE, GlobalVariables_1.PropertyIds.PROP_DESCRIPTION,
                GlobalVariables_1.PropertyIds.PROP_OBJECT_TYPE, GlobalVariables_1.PropertyIds.PROP_UNITS,
                GlobalVariables_1.PropertyIds.PROP_MAX_PRES_VALUE, GlobalVariables_1.PropertyIds.PROP_MIN_PRES_VALUE
            ];
            const propertiesLength = properties.length;
            const itemInfo = {
                objectId: objectId,
                id: objectId.instance,
                typeId: objectId.type,
                type: this._getObjectTypeByCode(objectId.type),
                instance: objectId.instance,
                deviceId: device.deviceId
            };
            const deviceAddress = device.address;
            if (!deviceAddress)
                throw new Error("Device address is required");
            let failedCount = 0;
            while (properties.length > 0) {
                try {
                    const property = properties.shift();
                    if (typeof property !== "undefined") {
                        // console.log("property not undefined");
                        const formated = yield this._getPropertyValue(deviceAddress, device.SADR, objectId, property);
                        for (let key in formated) {
                            itemInfo[key] = formated[key];
                        }
                    }
                }
                catch (error) {
                    failedCount++;
                    // console.error(error);
                }
            }
            if (failedCount === propertiesLength)
                throw new Error("failed to get object details");
            return itemInfo;
        });
    }
    _getChildrenNewValue(device, children) {
        return __awaiter(this, void 0, void 0, function* () {
            const deviceAcceptSegmentation = [GlobalVariables_2.SEGMENTATIONS.SEGMENTATION_BOTH, GlobalVariables_2.SEGMENTATIONS.SEGMENTATION_TRANSMIT].indexOf(device.segmentation) !== -1;
            if (deviceAcceptSegmentation)
                return this.getChildrenNewValueWithReadPropertyMultiple(device, children);
            return this.getChildrenNewValueWithReadProperty(device, children);
        });
    }
    getChildrenNewValueWithReadPropertyMultiple(device, children) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const requestArray = children.map(el => ({ objectId: el, properties: [{ id: GlobalVariables_1.PropertyIds.PROP_PRESENT_VALUE }] }));
                const list_chunked = lodash.chunk(requestArray, 50);
                const deviceAddress = device.address;
                if (!deviceAddress)
                    throw new Error("Device address is required");
                const res = [];
                while (list_chunked.length > 0) {
                    const arr = list_chunked.pop();
                    if (!arr)
                        continue;
                    const data = yield this.readPropertyMultiple(deviceAddress, device.SADR, arr);
                    const dataFormated = data.values.map(el => {
                        const value = this._getObjValue(el.values[0].value);
                        return {
                            id: el.objectId.instance,
                            type: el.objectId.type,
                            currentValue: this._formatCurrentValue(value, el.objectId.type)
                        };
                    });
                    res.push(dataFormated);
                }
                return lodash.flattenDeep(res);
            }
            catch (error) {
                throw error;
            }
        });
    }
    getChildrenNewValueWithReadProperty(device, children) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const res = [];
            try {
                const deep_children = [...children];
                let rejectCount = 0;
                while (deep_children.length > 0) {
                    const child = deep_children.shift();
                    const deviceAddress = device.address;
                    if (!deviceAddress)
                        throw new Error("Device address is required");
                    if (child) {
                        try {
                            child.id = child.instance;
                            const data = yield this.readProperty(deviceAddress, device.SADR, child, GlobalVariables_1.PropertyIds.PROP_PRESENT_VALUE);
                            const value = (_a = data.values[0]) === null || _a === void 0 ? void 0 : _a.value;
                            child.currentValue = this._getObjValue(value);
                            res.push(child);
                        }
                        catch (error) {
                            rejectCount++;
                        }
                    }
                }
                if (rejectCount === children.length)
                    throw new Error("Failed to get values for all children");
                return res;
            }
            catch (error) {
                throw error;
            }
        });
    }
    //////////////////////////////////////////////////////////////////////
    ////                             OTHER UTILITIES                  ////
    //////////////////////////////////////////////////////////////////////
    _getPropertyValue(address, sadr, objectId, propertyId) {
        return __awaiter(this, void 0, void 0, function* () {
            const data = yield this.readProperty(address, sadr, objectId, propertyId);
            const formated = this._formatProperty(data);
            return formated;
        });
    }
    getDeviceId(address, sadr) {
        return __awaiter(this, void 0, void 0, function* () {
            const objectId = { type: GlobalVariables_1.ObjectTypes.OBJECT_DEVICE, instance: GlobalVariables_1.PropertyIds.MAX_BACNET_PROPERTY_ID };
            const data = yield this.readProperty(address, sadr, objectId, GlobalVariables_1.PropertyIds.PROP_OBJECT_IDENTIFIER);
            return data.values[0].value.instance;
        });
    }
    _formatProperty(propertyValue) {
        if (propertyValue) {
            const { values, property } = propertyValue;
            const obj = {};
            for (const { id, value } of values) {
                const argId = id || (property === null || property === void 0 ? void 0 : property.id);
                const propertyName = this._getPropertyNameByCode(argId);
                if (propertyName) {
                    obj[propertyName] = this._getObjValue(value);
                }
            }
            if (typeof obj.units !== "undefined") {
                if (typeof obj.units === "object")
                    obj.units = "";
                else
                    obj.units = this._getUnitsByCode(obj.units);
            }
            return obj;
        }
        return {};
    }
    _getObjValue(value) {
        var _a;
        if (typeof value !== "object")
            return value;
        let temp_value = Array.isArray(value) ? (_a = value[0]) === null || _a === void 0 ? void 0 : _a.value : value.value;
        return typeof temp_value === "object" ? "" : temp_value;
    }
    _formatCurrentValue(value, type) {
        if ([GlobalVariables_1.ObjectTypes.OBJECT_BINARY_INPUT, GlobalVariables_1.ObjectTypes.OBJECT_BINARY_VALUE].indexOf(type) !== -1) {
            return value ? true : false;
        }
        return value;
    }
    _getPropertyNameByCode(type) {
        const property = GlobalVariables_1.PropertyNames[type];
        if (property)
            return property.toLocaleLowerCase().replace('prop_', '');
        return;
    }
    _getObjectTypeByCode(typeCode) {
        const property = GlobalVariables_1.ObjectTypesCode[typeCode];
        if (property)
            return property.toLocaleLowerCase().replace('object_', '');
        return;
    }
    _getUnitsByCode(typeCode) {
        const property = GlobalVariables_1.UNITS_TYPES[typeCode];
        if (property)
            return property.toLocaleLowerCase().replace('units_', '').replace("_", " ");
        return;
    }
}
const BacnetUtilities = BacnetUtilitiesClass.getInstance();
exports.BacnetUtilities = BacnetUtilities;
exports.default = BacnetUtilities;
//# sourceMappingURL=BacnetUtilities.js.map