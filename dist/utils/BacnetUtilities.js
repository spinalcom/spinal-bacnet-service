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
const node_events_1 = require("node:events");
const constants_1 = require("./constants");
const functions_1 = require("./functions");
const debug_logs_1 = require("./debug_logs");
const node_perf_hooks_1 = require("node:perf_hooks");
class BacnetUtilitiesClass extends node_events_1.EventEmitter {
    _debug(scope, message, data) {
        if (typeof data === "undefined") {
            (0, debug_logs_1.printDebugLog)(`[BacnetUtilities] ==> [${scope}] ${message}`);
            return;
        }
        (0, debug_logs_1.printDebugLog)(`[BacnetUtilities] ==> [${scope}] ${message}`, data);
    }
    _getApplicationTagName(typeCode) {
        var _a;
        if (typeof typeCode !== "number")
            return;
        return (_a = Object.entries(GlobalVariables_1.APPLICATION_TAGS).find(([, code]) => code === typeCode)) === null || _a === void 0 ? void 0 : _a[0];
    }
    _summarizeBacnetValue(value) {
        if (Array.isArray(value)) {
            const limit = 20;
            const summary = value.slice(0, limit).map((item) => this._summarizeBacnetValue(item));
            if (value.length > limit)
                summary.push({ truncatedItems: value.length - limit });
            return summary;
        }
        if (!value || typeof value !== "object")
            return value;
        if (typeof value.type === "number" && "value" in value) {
            return {
                typeCode: value.type,
                typeName: this._getApplicationTagName(value.type),
                value: this._summarizeBacnetValue(value.value),
            };
        }
        return Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => [key, this._summarizeBacnetValue(nestedValue)]));
    }
    _summarizeReadPropertyResponse(data) {
        return ((data === null || data === void 0 ? void 0 : data.values) || []).map((property) => {
            var _a, _b;
            return ({
                propertyId: (_a = property.id) !== null && _a !== void 0 ? _a : (_b = data.property) === null || _b === void 0 ? void 0 : _b.id,
                arrayIndex: property.index,
                value: this._summarizeBacnetValue(property.value),
            });
        });
    }
    _summarizeReadPropertyMultipleResponse(data) {
        const objects = (data === null || data === void 0 ? void 0 : data.values) || [];
        const summary = objects.slice(0, 50).map((object) => ({
            objectId: object.objectId,
            properties: (object.values || []).slice(0, 50).map((property) => ({
                propertyId: property.id,
                arrayIndex: property.index,
                value: this._summarizeBacnetValue(property.value),
            })),
        }));
        if (objects.length > 50)
            summary.push({ truncatedObjects: objects.length - 50 });
        return summary;
    }
    _toValidPort(value) {
        if (!value)
            return;
        const port = Number.parseInt(String(value), 10);
        if (!Number.isInteger(port) || port < 1 || port > 65535)
            return;
        return port;
    }
    _toValidTimeout(value) {
        if (!value)
            return;
        const timeout = Number.parseInt(String(value), 10);
        if (!Number.isInteger(timeout) || timeout < 1)
            return;
        return timeout;
    }
    _toValidTtl(value) {
        if (!value)
            return;
        const ttl = Number.parseInt(String(value), 10);
        if (!Number.isInteger(ttl) || ttl < 1 || ttl > 65535)
            return;
        return ttl;
    }
    _toValidDeviceId(value) {
        if (typeof value === "undefined" || value === null)
            return;
        const deviceId = Number.parseInt(String(value), 10);
        if (!Number.isInteger(deviceId) || deviceId < 0 || deviceId > 4194303)
            return;
        return deviceId;
    }
    _configureForeignDeviceRegistration(client) {
        const bbmdAddress = process.env.BACNET_BBMD_ADDRESS;
        if (!bbmdAddress)
            return;
        this._debug("_configureForeignDeviceRegistration", "Attempting foreign device registration", { bbmdAddress });
        const bbmdPort = this._toValidPort(process.env.BACNET_BBMD_PORT) || 47808;
        const bbmdTtl = this._toValidTtl(process.env.BACNET_BBMD_TTL) || 60;
        const bacnetClient = client;
        if (typeof bacnetClient.registerForeignDevice !== "function") {
            this._debug("_configureForeignDeviceRegistration", "registerForeignDevice is not available on this bacstack version");
            return;
        }
        bacnetClient.registerForeignDevice({ address: bbmdAddress, port: bbmdPort }, bbmdTtl, (err) => {
            if (err) {
                this._debug("_configureForeignDeviceRegistration", "Foreign Device Registration failed", err.message || err);
                return;
            }
            this._debug("_configureForeignDeviceRegistration", `Foreign Device Registration active on ${bbmdAddress}:${bbmdPort} (ttl=${bbmdTtl}s)`);
        });
    }
    _resolveDiscoverClientOptions(options) {
        const apduTimeout = this._toValidTimeout(options === null || options === void 0 ? void 0 : options.apduTimeout) || this._toValidTimeout(process.env.BACNET_APDU_TIMEOUT) || 6000;
        const port = this._toValidPort(options === null || options === void 0 ? void 0 : options.port) || this._toValidPort(process.env.BACNET_PORT);
        const iface = (options === null || options === void 0 ? void 0 : options.interface) || process.env.BACNET_INTERFACE;
        const broadcastAddress = (options === null || options === void 0 ? void 0 : options.broadcastAddress) || process.env.BACNET_BROADCAST_ADDRESS;
        const clientOptions = { apduTimeout };
        if (port)
            clientOptions.port = port;
        if (iface)
            clientOptions.interface = iface;
        if (broadcastAddress)
            clientOptions.broadcastAddress = broadcastAddress;
        return clientOptions;
    }
    _toDiscoveryMapKey(address, deviceId, sadr) {
        return `${address || ""}_${deviceId || ""}_${JSON.stringify(sadr || "")}`;
    }
    _mapIAmDevice(device) {
        return {
            address: device.address,
            deviceId: device.deviceId,
            maxApdu: device.maxApdu,
            segmentation: device.segmentation,
            vendorId: device.vendorId,
            SADR: device.SADR,
        };
    }
    _getDiscoverTargets(options) {
        return Array.isArray(options === null || options === void 0 ? void 0 : options.ips) ? options.ips : [];
    }
    _getUnicastTargets(targets) {
        return targets.filter((target) => target.process === "unicast").map((target) => ({ address: target.address, deviceId: target.deviceId }));
    }
    _runTargetedDiscovery(client, targets, fail) {
        this._debug("discoverDevices", "Launching targeted discovery", { targets: targets.length });
        for (const target of targets) {
            if (target.process === "unicast") {
                this._debug("discoverDevices", "Sending unicast whoIs", target.address);
                client.whoIs({ address: target.address });
                continue;
            }
            if (target.process === "bbmd") {
                this._debug("discoverDevices", "Registering BBMD target", target.address);
                this._registerForeignForDiscovery(client, target.address, (err) => {
                    if (err) {
                        fail(err);
                        return;
                    }
                    this._debug("discoverDevices", "Sending whoIs through BBMD", target.address);
                    client.whoIs();
                });
            }
        }
    }
    _registerForeignForDiscovery(client, bbmdAddress, next) {
        const bbmdPort = this._toValidPort(process.env.BACNET_BBMD_PORT) || 47808;
        const bbmdTtl = this._toValidTtl(process.env.BACNET_BBMD_TTL) || 60;
        const currentClient = client;
        this._debug("_registerForeignForDiscovery", "Registering foreign device for discovery", { bbmdAddress, bbmdPort, bbmdTtl });
        if (!bbmdAddress) {
            next(new Error("discoverDevicesDynamic: bbmdAddress is required in bbmd mode"));
            return;
        }
        if (typeof currentClient.registerForeignDevice !== "function") {
            next(new Error("discoverDevicesDynamic: registerForeignDevice is not available on this bacstack version"));
            return;
        }
        currentClient.registerForeignDevice({ address: bbmdAddress, port: bbmdPort }, bbmdTtl, (err) => {
            if (err)
                return next(err);
            this._debug("_registerForeignForDiscovery", "Foreign registration successful");
            next();
        });
    }
    _readPropertyWithClient(client, address, objectId, propertyId, options = {}) {
        this._debug("_readPropertyWithClient", "Request start", { status: "pending", address, objectId, propertyId, options });
        return new Promise((resolve, reject) => {
            client.readProperty(address, null, objectId, propertyId, options, (err, data) => {
                if (err) {
                    this._debug("_readPropertyWithClient", "Request complete", { status: "error", address, objectId, propertyId, error: err.message || err });
                    reject(err);
                    return;
                }
                this._debug("_readPropertyWithClient", "Request complete", {
                    status: "success",
                    address,
                    objectId,
                    propertyId,
                    values: this._summarizeReadPropertyResponse(data),
                });
                resolve(data);
            });
        });
    }
    _extractFirstReadPropertyValue(data) {
        var _a, _b;
        return this._getObjValue((_b = (_a = data === null || data === void 0 ? void 0 : data.values) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.value);
    }
    _isValidDeviceName(name) {
        return typeof name === "string" && name.trim().length > 0;
    }
    _ensureDiscoveredDeviceName(client, device) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!device.address)
                return;
            if (this._isValidDeviceName(device.name))
                return device.name;
            const resolvedDeviceId = this._toValidDeviceId(device.deviceId);
            if (typeof resolvedDeviceId === "undefined")
                return;
            try {
                const data = yield this._readPropertyWithClient(client, device.address, { type: GlobalVariables_1.ObjectTypes.OBJECT_DEVICE, instance: resolvedDeviceId }, GlobalVariables_1.PropertyIds.PROP_OBJECT_NAME);
                const name = this._extractFirstReadPropertyValue(data);
                if (!this._isValidDeviceName(name))
                    return;
                return name;
            }
            catch (error) {
                this._debug("_ensureDiscoveredDeviceName", "Failed to read PROP_OBJECT_NAME", { address: device.address, deviceId: device.deviceId, error });
                return;
            }
        });
    }
    _filterUnresponsiveDiscoveredDevices(client, devicesMap) {
        return __awaiter(this, void 0, void 0, function* () {
            for (const [key, device] of Array.from(devicesMap.entries())) {
                const name = yield this._ensureDiscoveredDeviceName(client, device);
                if (!this._isValidDeviceName(name)) {
                    this._debug("_filterUnresponsiveDiscoveredDevices", "Dropping device with empty name", { address: device.address, deviceId: device.deviceId });
                    devicesMap.delete(key);
                    continue;
                }
                device.name = name;
                devicesMap.set(key, device);
            }
        });
    }
    _discoverDeviceByReadProperty(client, target) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            this._debug("_discoverDeviceByReadProperty", "Start fallback discovery", target);
            const preferredDeviceId = this._toValidDeviceId(target.deviceId);
            let resolvedDeviceId = preferredDeviceId;
            if (typeof resolvedDeviceId === "undefined") {
                const objectIdentifier = yield this._readPropertyWithClient(client, target.address, { type: GlobalVariables_1.ObjectTypes.OBJECT_DEVICE, instance: GlobalVariables_1.PropertyIds.MAX_BACNET_PROPERTY_ID }, GlobalVariables_1.PropertyIds.PROP_OBJECT_IDENTIFIER);
                const discoveredDeviceId = (_c = (_b = (_a = objectIdentifier === null || objectIdentifier === void 0 ? void 0 : objectIdentifier.values) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.value) === null || _c === void 0 ? void 0 : _c.instance;
                resolvedDeviceId = this._toValidDeviceId(discoveredDeviceId);
                this._debug("_discoverDeviceByReadProperty", "Resolved deviceId from PROP_OBJECT_IDENTIFIER", resolvedDeviceId);
            }
            if (typeof resolvedDeviceId === "undefined") {
                this._debug("_discoverDeviceByReadProperty", "Unable to resolve deviceId from fallback read");
                return;
            }
            const deviceObjectId = { type: GlobalVariables_1.ObjectTypes.OBJECT_DEVICE, instance: resolvedDeviceId };
            const readOptionalValue = (propertyId) => __awaiter(this, void 0, void 0, function* () {
                try {
                    const data = yield this._readPropertyWithClient(client, target.address, deviceObjectId, propertyId);
                    return this._extractFirstReadPropertyValue(data);
                }
                catch (error) {
                    return undefined;
                }
            });
            const [name, description, segmentation, vendorId, maxApdu, objectType] = yield Promise.all([readOptionalValue(GlobalVariables_1.PropertyIds.PROP_OBJECT_NAME), readOptionalValue(GlobalVariables_1.PropertyIds.PROP_DESCRIPTION), readOptionalValue(GlobalVariables_1.PropertyIds.PROP_SEGMENTATION_SUPPORTED), readOptionalValue(GlobalVariables_1.PropertyIds.PROP_VENDOR_IDENTIFIER), readOptionalValue(GlobalVariables_1.PropertyIds.PROP_MAX_APDU_LENGTH_ACCEPTED), readOptionalValue(GlobalVariables_1.PropertyIds.PROP_OBJECT_TYPE)]);
            if (!this._isValidDeviceName(name)) {
                this._debug("_discoverDeviceByReadProperty", "Empty device name, considered unresponsive", { address: target.address, deviceId: resolvedDeviceId });
                return;
            }
            const typeId = typeof objectType === "number" ? objectType : GlobalVariables_1.ObjectTypes.OBJECT_DEVICE;
            const device = {
                id: resolvedDeviceId,
                SADR: "",
                deviceId: resolvedDeviceId,
                name,
                address: target.address,
                typeId: String(typeId),
                type: this._getObjectTypeByCode(typeId),
                description: typeof description === "string" ? description : undefined,
                segmentation: typeof segmentation === "number" ? segmentation : undefined,
                vendorId: typeof vendorId === "number" ? vendorId : undefined,
                maxApdu: typeof maxApdu === "number" ? maxApdu : undefined,
            };
            this._debug("_discoverDeviceByReadProperty", "Fallback discovery succeeded", device);
            return device;
        });
    }
    _fallbackUnicastDiscoveryWithReadProperty(client, targets, devicesMap) {
        return __awaiter(this, void 0, void 0, function* () {
            this._debug("_fallbackUnicastDiscoveryWithReadProperty", "Starting unicast fallback for targets", targets.length);
            for (const target of targets) {
                if (!target.address)
                    continue;
                const foundByWhoIs = Array.from(devicesMap.values()).some((device) => device.address === target.address);
                if (foundByWhoIs)
                    continue;
                try {
                    const discovered = yield this._discoverDeviceByReadProperty(client, target);
                    if (!discovered)
                        continue;
                    const key = `${discovered.address || ""}_${discovered.deviceId || ""}_`;
                    devicesMap.set(key, discovered);
                    this._debug("_fallbackUnicastDiscoveryWithReadProperty", "Discovered by readProperty", { target: target.address, deviceId: discovered.deviceId });
                }
                catch (error) {
                    this._debug("_fallbackUnicastDiscoveryWithReadProperty", `Fallback failed for ${target.address}`, error);
                }
            }
        });
    }
    _getRequiredDeviceAddress(device) {
        const deviceAddress = device.address;
        if (!deviceAddress)
            throw new Error("Device address is required");
        return deviceAddress;
    }
    _buildObjectDetailBaseInfo(device, objectId) {
        return {
            objectId,
            id: objectId.instance,
            typeId: objectId.type,
            type: this._getObjectTypeByCode(objectId.type),
            instance: objectId.instance,
            deviceId: device.deviceId,
        };
    }
    _readDeviceObjectList(device, objectId, deviceAddress, deviceAcceptSegmentation) {
        return __awaiter(this, void 0, void 0, function* () {
            if (deviceAcceptSegmentation) {
                const params = [{ objectId, properties: [{ id: GlobalVariables_1.PropertyIds.PROP_OBJECT_LIST }] }];
                const data = yield this.readPropertyMultiple(deviceAddress, device.SADR, params);
                const dataFormatted = data.values.map((el) => el.values.map((el2) => this._formatCurrentValue(el2.value, el.objectId.type)));
                return lodash.flattenDeep(dataFormatted);
            }
            const data = yield this.readProperty(deviceAddress, device.SADR, objectId, GlobalVariables_1.PropertyIds.PROP_OBJECT_LIST);
            return data.values;
        });
    }
    _recoverDeviceObjectListFromError(error, device, objectId, deviceAddress, deviceAcceptSegmentation) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            if (((_a = error === null || error === void 0 ? void 0 : error.message) === null || _a === void 0 ? void 0 : _a.match(/reason:4/i)) || ((_b = error === null || error === void 0 ? void 0 : error.message) === null || _b === void 0 ? void 0 : _b.match(/err_timeout/i))) {
                return this.getItemListByFragment(device, objectId);
            }
            if (deviceAcceptSegmentation) {
                const data = yield this.readProperty(deviceAddress, device.SADR, objectId, GlobalVariables_1.PropertyIds.PROP_OBJECT_LIST);
                return data.values;
            }
            throw error;
        });
    }
    _readObjectPropertiesSequentially(deviceAddress, sadr, objectId, properties, itemInfo) {
        return __awaiter(this, void 0, void 0, function* () {
            let failedCount = 0;
            while (properties.length > 0) {
                try {
                    const property = properties.shift();
                    if (typeof property === "undefined")
                        continue;
                    const formated = yield this._getPropertyValue(deviceAddress, sadr, objectId, property);
                    for (const key in formated) {
                        itemInfo[key] = formated[key];
                    }
                }
                catch (error) {
                    failedCount++;
                }
            }
            return failedCount;
        });
    }
    constructor() {
        super();
        this._client = null;
        this._DISCOVERY_WAIT_MS = 15 * 1000;
    }
    static getInstance() {
        if (!this.instance)
            this.instance = new BacnetUtilitiesClass();
        return this.instance;
    }
    createNewBacnetClient(timeout = 3000) {
        const apduTimeout = this._toValidTimeout(process.env.BACNET_APDU_TIMEOUT) || timeout;
        const port = this._toValidPort(process.env.BACNET_PORT);
        const interfaceAddress = process.env.BACNET_INTERFACE;
        const broadcastAddress = process.env.BACNET_BROADCAST_ADDRESS;
        const options = { apduTimeout };
        if (port)
            options.port = port;
        if (interfaceAddress)
            options.interface = interfaceAddress;
        if (broadcastAddress)
            options.broadcastAddress = broadcastAddress;
        this._debug("createNewBacnetClient", "Creating BACnet client", options);
        const client = new bacstack_1.default(options);
        this._listenClientErrorEvent(client);
        this._configureForeignDeviceRegistration(client);
        this._debug("createNewBacnetClient", "BACnet client created");
        return client;
    }
    getClient() {
        if (!this._client) {
            this._debug("getClient", "No shared client found, creating one");
            this._client = this.createNewBacnetClient();
        }
        return this._client;
    }
    discoverDevices(options) {
        var _a;
        const waitMs = this._DISCOVERY_WAIT_MS;
        this._debug("discoverDevices", "Discovery requested", { mode: options === null || options === void 0 ? void 0 : options.mode, ips: ((_a = options === null || options === void 0 ? void 0 : options.ips) === null || _a === void 0 ? void 0 : _a.length) || 0 });
        return new Promise((resolve, reject) => {
            const mode = (options === null || options === void 0 ? void 0 : options.mode) || "broadcast";
            const targets = this._getDiscoverTargets(options);
            const unicastTargets = this._getUnicastTargets(targets);
            const clientOptions = this._resolveDiscoverClientOptions(options);
            const tempClient = new bacstack_1.default(clientOptions);
            const devicesMap = new Map();
            let settled = false;
            // Cleanup and finalize functions for the discovery process
            const cleanup = () => {
                this._debug("discoverDevices", "Cleanup discovery client listeners and socket");
                tempClient.removeAllListeners("iAm");
                tempClient.removeAllListeners("error");
                try {
                    tempClient.close();
                }
                catch (error) {
                    this._debug("discoverDevices", "Close error", error);
                }
            };
            // Finalize the discovery process by cleaning up and resolving the promise with discovered devices
            const finalize = () => __awaiter(this, void 0, void 0, function* () {
                if (settled)
                    return;
                settled = true;
                this._debug("discoverDevices", "Finalize discovery", { devicesFound: devicesMap.size });
                if (devicesMap.size === 0 && unicastTargets.length > 0) {
                    yield this._fallbackUnicastDiscoveryWithReadProperty(tempClient, unicastTargets, devicesMap);
                }
                if (devicesMap.size > 0) {
                    yield this._filterUnresponsiveDiscoveredDevices(tempClient, devicesMap);
                }
                cleanup();
                this._debug("discoverDevices", "Discovery finished", { devicesFound: devicesMap.size });
                resolve(Array.from(devicesMap.values()));
            });
            // Handle discovery failure by cleaning up and rejecting the promise
            const fail = (err) => {
                if (settled)
                    return;
                settled = true;
                this._debug("discoverDevices", "Discovery failed", err.message || err);
                cleanup();
                reject(err);
            };
            tempClient.on("iAm", (device) => {
                const key = this._toDiscoveryMapKey(device.address, device.deviceId, device.SADR);
                this._debug("discoverDevices", "Received iAm", { address: device.address, deviceId: device.deviceId });
                devicesMap.set(key, this._mapIAmDevice(device));
            });
            tempClient.on("error", (err) => {
                this._debug("discoverDevices", "Discovery client error", (err === null || err === void 0 ? void 0 : err.message) || err);
            });
            setTimeout(() => {
                this._debug("discoverDevices", "Discovery timeout reached", waitMs);
                void finalize();
            }, waitMs);
            try {
                if (targets.length > 0) {
                    this._runTargetedDiscovery(tempClient, targets, fail);
                    return;
                }
                if (mode === "unicast") {
                    fail(new Error("discoverDevices: ips is required in unicast mode"));
                    return;
                }
                tempClient.whoIs();
                this._debug("discoverDevices", "Sending broadcast whoIs");
            }
            catch (error) {
                fail(error);
            }
        });
    }
    _listenClientErrorEvent(client) {
        client.on("close", () => {
            // printDebugLog("client closed");
            // this._client = null;
        });
        client.on("timeout", (payload) => {
            (0, debug_logs_1.printDebugLog)("client timeout", payload || "");
        });
        client.on("error", (err) => {
            (0, debug_logs_1.printDebugLog)("error client", err.message);
        });
    }
    [constants_1.CLIENT_RESET_EVENT]() {
        this._debug("CLIENT_RESET_EVENT", "Resetting shared BACnet client");
        if (this._client) {
            try {
                this._client.close();
            }
            catch (error) {
                this._debug("CLIENT_RESET_EVENT", "Error while closing BACnet client", error);
            }
        }
        this._client = null;
        this._client = this.createNewBacnetClient();
        this.emit(constants_1.CLIENT_RESET_EVENT, this._client);
        this._debug("CLIENT_RESET_EVENT", "Shared BACnet client reset complete");
        return this._client;
    }
    ////////////////////////////////////////////////////////////////
    ////                  READ BACNET DATA                        //
    ////////////////////////////////////////////////////////////////
    readPropertyMultiple(address, sadr, requestArray) {
        const requests = Array.isArray(requestArray) ? requestArray : [requestArray];
        this._debug("readPropertyMultiple", "Request start", {
            status: "pending",
            address,
            SADR: sadr,
            requestCount: requests.length,
            requests: requests.map(({ objectId, properties }) => ({ objectId, propertyIds: properties.map(({ id }) => id) })),
        });
        return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
            try {
                const client = this.getClient();
                requestArray = requests;
                if (sadr && typeof sadr == "object")
                    sadr = Object.keys(sadr).length === 0 ? null : sadr;
                client.readPropertyMultiple(address, sadr, requestArray, (err, data) => {
                    var _a;
                    if (err) {
                        this._debug("readPropertyMultiple", "Request complete", { status: "error", address, error: err.message || err });
                        reject(err);
                        return;
                    }
                    this._debug("readPropertyMultiple", "Request complete", {
                        status: "success",
                        address,
                        objectsRetrieved: ((_a = data === null || data === void 0 ? void 0 : data.values) === null || _a === void 0 ? void 0 : _a.length) || 0,
                        values: this._summarizeReadPropertyMultipleResponse(data),
                    });
                    resolve(data);
                });
            }
            catch (error) {
                this._debug("readPropertyMultiple", "Request complete", { status: "error", address, error });
                reject(error);
            }
        }));
    }
    readProperty(address, sadr, objectId, propertyId, clientOptions) {
        return __awaiter(this, void 0, void 0, function* () {
            this._debug("readProperty", "Request start", { status: "pending", address, SADR: sadr, objectId, propertyId, options: clientOptions });
            const client = this.getClient();
            const options = clientOptions || {};
            if (sadr && typeof sadr == "object")
                sadr = Object.keys(sadr).length === 0 ? null : sadr;
            return new Promise((resolve, reject) => {
                client.readProperty(address, sadr, objectId, propertyId, options, (err, data) => {
                    if (err) {
                        this._debug("readProperty", "Request complete", { status: "error", address, objectId, propertyId, error: err.message || err });
                        return reject(err);
                    }
                    this._debug("readProperty", "Request complete", {
                        status: "success",
                        address,
                        objectId,
                        propertyId,
                        values: this._summarizeReadPropertyResponse(data),
                    });
                    resolve(data);
                });
            });
        });
    }
    deviceIsAvailable(device) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                yield this.readProperty(device.address, device.SADR, { instance: device.deviceId, type: 8 }, GlobalVariables_1.PropertyIds.PROP_OBJECT_NAME);
                this._debug("deviceIsAvailable", "Device is available", { address: device.address, deviceId: device.deviceId });
                return true;
            }
            catch (error) {
                this._debug("deviceIsAvailable", "Device is unavailable", { address: device.address, deviceId: device.deviceId, error });
                return false;
            }
        });
    }
    ////////////////////////////////////////////////////////////////
    ////                  GET ALL BACNET OBJECT LIST              //
    ////////////////////////////////////////////////////////////////
    _getDeviceObjectList(device_1, SENSOR_TYPES_1) {
        return __awaiter(this, arguments, void 0, function* (device, SENSOR_TYPES, getListUsingFragment = false) {
            const deviceIsAvailable = yield this.deviceIsAvailable(device);
            if (!deviceIsAvailable)
                throw new Error("Device is not available");
            const objectId = { type: GlobalVariables_1.ObjectTypes.OBJECT_DEVICE, instance: device.deviceId };
            let values;
            const deviceAddress = this._getRequiredDeviceAddress(device);
            const deviceAcceptSegmentation = yield this.deviceAcceptSegmentation(device);
            try {
                if (getListUsingFragment)
                    throw new Error("reason:4"); // Force to use fragment method;
                values = yield this._readDeviceObjectList(device, objectId, deviceAddress, deviceAcceptSegmentation);
            }
            catch (error) {
                values = yield this._recoverDeviceObjectListFromError(error, device, objectId, deviceAddress, deviceAcceptSegmentation);
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
            let index = 1;
            let finish = false;
            const deviceAddress = this._getRequiredDeviceAddress(device);
            while (!finish) {
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
                    if (bacnetItemsFound.length === 0) {
                        throw err;
                    }
                    // Some devices end indexed reads with an error once the last element is reached.
                    finish = true;
                }
            }
            return bacnetItemsFound;
        });
    }
    ////////////////////////////////////////////////////////////////
    ////                  GET OBJECT DETAIL                       //
    ////////////////////////////////////////////////////////////////
    _getObjectDetail(device, objects) {
        return __awaiter(this, void 0, void 0, function* () {
            const deviceIsAvailable = yield this.deviceIsAvailable(device);
            if (!deviceIsAvailable)
                throw new Error("Device is not available");
            let objectLists = [...objects];
            let objectListDetails = [];
            const deviceAcceptSegmentation = yield this.deviceAcceptSegmentation(device);
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
                        if (deviceAcceptSegmentation && deviceIsAvailable) {
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
            let totalFailedCount = 0;
            for (const item of items) {
                try {
                    const res = yield this._getObjectDetailWithReadProperty(device, item);
                    if (res)
                        itemsFound.push(res);
                }
                catch (error) {
                    totalFailedCount++;
                }
            }
            if (totalFailedCount === items.length)
                throw new Error("Failed to get details for all items");
            return itemsFound;
        });
    }
    _getObjectDetailWithReadPropertyMultiple(device, objects) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const deviceAddress = this._getRequiredDeviceAddress(device);
                const deviceIsAvailable = yield this.deviceIsAvailable(device);
                if (!deviceIsAvailable)
                    throw new Error("Device is not available");
                const requestArray = objects.map((el) => ({
                    objectId: JSON.parse(JSON.stringify(el)),
                    properties: [{ id: GlobalVariables_1.PropertyIds.PROP_OBJECT_NAME }, { id: GlobalVariables_1.PropertyIds.PROP_PRESENT_VALUE }, { id: GlobalVariables_1.PropertyIds.PROP_DESCRIPTION }, { id: GlobalVariables_1.PropertyIds.PROP_OBJECT_TYPE }, { id: GlobalVariables_1.PropertyIds.PROP_UNITS }, { id: GlobalVariables_1.PropertyIds.PROP_MAX_PRES_VALUE }, { id: GlobalVariables_1.PropertyIds.PROP_MIN_PRES_VALUE }, { id: GlobalVariables_1.PropertyIds.PROP_BIT_TEXT }],
                }));
                const data = yield this.readPropertyMultiple(deviceAddress, device.SADR, requestArray);
                return data.values.map((el) => {
                    const { objectId } = el;
                    const itemInfo = this._buildObjectDetailBaseInfo(device, objectId);
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
            const deviceAddress = this._getRequiredDeviceAddress(device);
            const deviceIsAvailable = yield this.deviceIsAvailable(device);
            if (!deviceIsAvailable)
                throw new Error("Device is not available");
            const properties = [GlobalVariables_1.PropertyIds.PROP_OBJECT_NAME, GlobalVariables_1.PropertyIds.PROP_PRESENT_VALUE, GlobalVariables_1.PropertyIds.PROP_DESCRIPTION, GlobalVariables_1.PropertyIds.PROP_OBJECT_TYPE, GlobalVariables_1.PropertyIds.PROP_UNITS, GlobalVariables_1.PropertyIds.PROP_MAX_PRES_VALUE, GlobalVariables_1.PropertyIds.PROP_MIN_PRES_VALUE, GlobalVariables_1.PropertyIds.PROP_BIT_TEXT];
            const propertiesLength = properties.length;
            const itemInfo = this._buildObjectDetailBaseInfo(device, objectId);
            const failedCount = yield this._readObjectPropertiesSequentially(deviceAddress, device.SADR, objectId, properties, itemInfo);
            if (failedCount === propertiesLength)
                throw new Error("failed to get object details");
            return itemInfo;
        });
    }
    deviceAcceptSegmentation(device) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                if (!isNaN(device.segmentation)) {
                    return [GlobalVariables_2.SEGMENTATIONS.SEGMENTATION_BOTH, GlobalVariables_2.SEGMENTATIONS.SEGMENTATION_TRANSMIT].indexOf(device.segmentation) !== -1;
                }
                const objectId = { type: GlobalVariables_1.ObjectTypes.OBJECT_DEVICE, instance: device.deviceId };
                const propertyId = GlobalVariables_1.PropertyIds.PROP_SEGMENTATION_SUPPORTED;
                const formated = yield this._getPropertyValue(device.address, device.SADR, objectId, propertyId);
                const propertyName = this._getPropertyNameByCode(propertyId);
                if (formated && propertyName) {
                    const value = formated[propertyName];
                    return [GlobalVariables_2.SEGMENTATIONS.SEGMENTATION_BOTH, GlobalVariables_2.SEGMENTATIONS.SEGMENTATION_TRANSMIT].indexOf(value) !== -1;
                }
                return false;
            }
            catch (error) {
                return false;
            }
        });
    }
    _getChildrenNewValue(device, children) {
        return __awaiter(this, void 0, void 0, function* () {
            const deviceAcceptSegmentation = yield this.deviceAcceptSegmentation(device);
            if (deviceAcceptSegmentation)
                return this.getChildrenNewValueWithReadPropertyMultiple(device, children);
            return this.getChildrenNewValueWithReadProperty(device, children);
        });
    }
    _getChildrenNewValueWithMetrics(device, children) {
        return __awaiter(this, void 0, void 0, function* () {
            const tracker = {
                requestedKeys: new Set(children.map((child) => this._readObjectKey(child))),
                firstAttemptSuccessKeys: new Set(),
                finalSuccessKeys: new Set(),
                finalErrorByKey: new Map(),
                retries: 0,
                errorsByCategory: { bacnetError: 0, reject: 0, abort: 0, timeout: 0, localError: 0 },
                successfulRequestDurationsMs: [],
            };
            let values;
            let errorMessage;
            try {
                const deviceAcceptSegmentation = yield this.deviceAcceptSegmentation(device);
                values = deviceAcceptSegmentation
                    ? yield this.getChildrenNewValueWithReadPropertyMultiple(device, children, tracker)
                    : yield this.getChildrenNewValueWithReadProperty(device, children, tracker);
            }
            catch (error) {
                errorMessage = error instanceof Error ? error.message : String(error);
            }
            for (const key of tracker.requestedKeys) {
                if (tracker.finalSuccessKeys.has(key)) {
                    tracker.finalErrorByKey.delete(key);
                }
                else if (!tracker.finalErrorByKey.has(key)) {
                    tracker.finalErrorByKey.set(key, "localError");
                    tracker.errorsByCategory.localError++;
                }
            }
            return Object.assign({ values, telemetry: {
                    requestedPoints: children.length,
                    firstAttemptSuccesses: tracker.firstAttemptSuccessKeys.size,
                    finalSuccesses: tracker.finalSuccessKeys.size,
                    retries: tracker.retries,
                    timedOutPoints: Array.from(tracker.finalErrorByKey.values()).filter((category) => category === "timeout").length,
                    errorsByCategory: tracker.errorsByCategory,
                    successfulRequestDurationsMs: tracker.successfulRequestDurationsMs,
                } }, (errorMessage && { error: errorMessage }));
        });
    }
    _readObjectKey(object) {
        return `${object.type}_${object.instance}`;
    }
    _classifyReadError(error) {
        const value = error;
        const message = [value === null || value === void 0 ? void 0 : value.name, value === null || value === void 0 ? void 0 : value.message, value === null || value === void 0 ? void 0 : value.code, value === null || value === void 0 ? void 0 : value.errorClass, value === null || value === void 0 ? void 0 : value.errorCode, value === null || value === void 0 ? void 0 : value.errClass, value === null || value === void 0 ? void 0 : value.errCode]
            .filter((part) => typeof part !== "undefined" && part !== null)
            .join(" ")
            .toLowerCase();
        if (/err_?timeout|timeout/.test(message))
            return "timeout";
        if (/\breject\b|reject[-_ ]?pdu/.test(message))
            return "reject";
        if (/\babort\b|abort[-_ ]?pdu/.test(message))
            return "abort";
        if ((value === null || value === void 0 ? void 0 : value.errorClass) || (value === null || value === void 0 ? void 0 : value.errorCode) || (value === null || value === void 0 ? void 0 : value.errClass) || (value === null || value === void 0 ? void 0 : value.errCode) || /bacnet error|error class|error code/.test(message))
            return "bacnetError";
        return "localError";
    }
    _recordReadSuccess(tracker, objects, startedAt, firstAttempt) {
        if (!tracker || objects.length === 0)
            return;
        tracker.successfulRequestDurationsMs.push(Math.max(0, node_perf_hooks_1.performance.now() - startedAt));
        for (const object of objects) {
            const key = this._readObjectKey(object);
            tracker.finalSuccessKeys.add(key);
            tracker.finalErrorByKey.delete(key);
            if (firstAttempt)
                tracker.firstAttemptSuccessKeys.add(key);
        }
    }
    _isBacnetErrorValue(value) {
        if (Array.isArray(value))
            return value.some((entry) => this._isBacnetErrorValue(entry));
        return !!value && typeof value === "object" && typeof value.errorClass !== "undefined" && typeof value.errorCode !== "undefined";
    }
    _recordReadError(tracker, objects, error) {
        if (!tracker)
            return;
        const category = this._classifyReadError(error);
        tracker.errorsByCategory[category]++;
        for (const object of objects)
            tracker.finalErrorByKey.set(this._readObjectKey(object), category);
    }
    getChildrenNewValueWithReadPropertyMultiple(device, children, tracker) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            try {
                const requestArray = children.map((el) => ({ objectId: el, properties: [{ id: GlobalVariables_1.PropertyIds.PROP_PRESENT_VALUE }] }));
                const list_chunked = lodash.chunk(requestArray, 50);
                const deviceAddress = this._getRequiredDeviceAddress(device);
                const res = [];
                while (list_chunked.length > 0) {
                    const arr = list_chunked.pop();
                    if (!arr)
                        continue;
                    const startedAt = node_perf_hooks_1.performance.now();
                    let data;
                    let dataFormated;
                    try {
                        data = yield this.readPropertyMultiple(deviceAddress, device.SADR, arr);
                        dataFormated = data.values.map((el) => {
                            const value = this._getObjValue(el.values[0].value);
                            return {
                                id: el.objectId.instance,
                                type: el.objectId.type,
                                currentValue: this._formatCurrentValue(value, el.objectId.type),
                            };
                        });
                        const successfulObjects = data.values.filter((el) => { var _a; return !this._isBacnetErrorValue((_a = el.values[0]) === null || _a === void 0 ? void 0 : _a.value); }).map((el) => el.objectId);
                        for (const el of data.values) {
                            if (this._isBacnetErrorValue((_a = el.values[0]) === null || _a === void 0 ? void 0 : _a.value))
                                this._recordReadError(tracker, [el.objectId], el.values[0].value);
                        }
                        this._recordReadSuccess(tracker, successfulObjects, startedAt, true);
                    }
                    catch (error) {
                        this._recordReadError(tracker, arr.map(({ objectId }) => objectId), error);
                        throw error;
                    }
                    res.push(dataFormated);
                }
                return lodash.flattenDeep(res);
            }
            catch (error) {
                const deviceIdAvailable = yield this.deviceIsAvailable(device);
                if (deviceIdAvailable) {
                    return this.getChildrenNewValueWithReadProperty(device, children, tracker, true);
                }
                throw error;
            }
        });
    }
    getChildrenNewValueWithReadProperty(device_1, children_1, tracker_1) {
        return __awaiter(this, arguments, void 0, function* (device, children, tracker, isRetry = false) {
            var _a;
            const res = [];
            try {
                const deep_children = [...children];
                let rejectCount = 0;
                const deviceAddress = this._getRequiredDeviceAddress(device);
                while (deep_children.length > 0) {
                    const child = deep_children.shift();
                    if (child) {
                        if (isRetry && tracker)
                            tracker.retries++;
                        const startedAt = node_perf_hooks_1.performance.now();
                        try {
                            child.id = child.instance;
                            const data = yield this.readProperty(deviceAddress, device.SADR, child, GlobalVariables_1.PropertyIds.PROP_PRESENT_VALUE);
                            const value = (_a = data.values[0]) === null || _a === void 0 ? void 0 : _a.value;
                            child.currentValue = this._formatCurrentValue(this._getObjValue(value), child.type);
                            res.push(child);
                            if (this._isBacnetErrorValue(value))
                                this._recordReadError(tracker, [child], value);
                            else
                                this._recordReadSuccess(tracker, [child], startedAt, !isRetry);
                        }
                        catch (error) {
                            this._recordReadError(tracker, [child], error);
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
    /////////////////////////////////////////////////////////////////////
    ////                  PILOT BACNET                               ////
    /////////////////////////////////////////////////////////////////////
    writeProperty(request_1) {
        return __awaiter(this, arguments, void 0, function* (request, releasePriority = false) {
            this._debug("writeProperty", "Write request start", {
                status: "pending",
                address: request.address,
                deviceId: request.deviceId,
                requestId: request.id,
                objectId: request.objectId,
                propertyId: GlobalVariables_1.PropertyIds.PROP_PRESENT_VALUE,
                requestedValue: request.value,
                releasePriority,
            });
            const types = this._getPossibleDataTypes(request.objectId.type);
            let success = false;
            let data = null;
            let lastError = null;
            while (types.length > 0 && !success) {
                const type = types.shift();
                try {
                    if (typeof type === "undefined")
                        throw new Error("No more data types to try");
                    this._debug("writeProperty", "Trying BACnet application type", { typeCode: type, typeName: this._getApplicationTagName(type) });
                    data = yield this._writePropertyWithType(request, type);
                    success = true;
                    if (releasePriority)
                        yield this._releasePriority(request, type);
                }
                catch (error) {
                    this._debug("writeProperty", "Type attempt failed", error);
                    lastError = error;
                }
            }
            if (!success) {
                const reason = lastError instanceof Error ? lastError.message : "unknown error";
                this._debug("writeProperty", "Write request complete", {
                    status: "error",
                    address: request.address,
                    deviceId: request.deviceId,
                    requestId: request.id,
                    objectId: request.objectId,
                    propertyId: GlobalVariables_1.PropertyIds.PROP_PRESENT_VALUE,
                    requestedValue: request.value,
                    error: reason,
                });
                throw new Error(`Failed to write property with all possible data types: ${reason}`);
            }
            this._debug("writeProperty", "Write request complete", {
                status: "success",
                address: request.address,
                deviceId: request.deviceId,
                requestId: request.id,
                objectId: request.objectId,
                propertyId: GlobalVariables_1.PropertyIds.PROP_PRESENT_VALUE,
                acknowledgement: data,
            });
            return data;
        });
    }
    _writePropertyWithType(request, dataType) {
        return __awaiter(this, void 0, void 0, function* () {
            return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
                const client = this.getClient();
                const valueConverted = this._convertValueToBoolean(request.value) ? 1 : 0;
                const value = dataType === GlobalVariables_1.APPLICATION_TAGS.BACNET_APPLICATION_TAG_ENUMERATED ? valueConverted : request.value;
                const sadr = !request.SADR || (typeof request.SADR === "object" && Object.keys(request.SADR).length === 0) ? null : request.SADR;
                const priority = this._getBacnetPriority(request);
                this._debug("_writePropertyWithType", "Sending writeProperty", {
                    status: "pending",
                    address: request.address,
                    deviceId: request.deviceId,
                    requestId: request.id,
                    objectId: request.objectId,
                    propertyId: GlobalVariables_1.PropertyIds.PROP_PRESENT_VALUE,
                    value: this._summarizeBacnetValue({ type: dataType, value }),
                    priority,
                });
                client.writeProperty(request.address, sadr, request.objectId, GlobalVariables_1.PropertyIds.PROP_PRESENT_VALUE, [{ type: dataType, value: value }], { priority }, (err, value) => {
                    if (err) {
                        this._debug("_writePropertyWithType", "Write response", {
                            status: "error",
                            address: request.address,
                            requestId: request.id,
                            objectId: request.objectId,
                            propertyId: GlobalVariables_1.PropertyIds.PROP_PRESENT_VALUE,
                            typeCode: dataType,
                            typeName: this._getApplicationTagName(dataType),
                            error: err.message || err,
                        });
                        reject(err);
                        return;
                    }
                    this._debug("_writePropertyWithType", "Write response", {
                        status: "success",
                        address: request.address,
                        requestId: request.id,
                        objectId: request.objectId,
                        propertyId: GlobalVariables_1.PropertyIds.PROP_PRESENT_VALUE,
                        typeCode: dataType,
                        typeName: this._getApplicationTagName(dataType),
                        acknowledgement: value,
                    });
                    resolve(value);
                });
            }));
        });
    }
    _convertValueToBoolean(value) {
        if (typeof value === "boolean")
            return value;
        if (typeof value === "number")
            return value !== 0;
        if (typeof value === "string") {
            const val = value.toLowerCase();
            return val === "true" || val === "1";
        }
        return false;
    }
    _releasePriority(request, type) {
        return __awaiter(this, void 0, void 0, function* () {
            const requestCopy = JSON.parse(JSON.stringify(request));
            requestCopy.value = null;
            return this._writePropertyWithType(requestCopy, type);
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
                    obj[propertyName] = this._formatCurrentValue(this._getObjValue(value), property === null || property === void 0 ? void 0 : property.type);
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
        let temp_value = value;
        if (!(0, functions_1.isValidValue)(value) && !(0, functions_1.isValidValueArray)(value) && typeof value !== "object")
            temp_value = value;
        if ((0, functions_1.isValidValue)(value))
            temp_value = value.value;
        if ((0, functions_1.isValidValueArray)(value))
            temp_value = value.map((v) => v.value);
        if (Array.isArray(temp_value) && temp_value.length === 1)
            return temp_value[0];
        return temp_value;
        // return typeof temp_value === "object" ? "" : temp_value;
    }
    _formatCurrentValue(value, type) {
        if ([GlobalVariables_1.ObjectTypes.OBJECT_BINARY_INPUT, GlobalVariables_1.ObjectTypes.OBJECT_BINARY_OUTPUT, GlobalVariables_1.ObjectTypes.OBJECT_BINARY_VALUE, GlobalVariables_1.ObjectTypes.OBJECT_BINARY_LIGHTING_OUTPUT].indexOf(type) !== -1) {
            return value ? true : false;
        }
        if (typeof value === "object" && "errorClass" in value && "errorCode" in value)
            return "";
        return value;
    }
    _getPropertyNameByCode(type) {
        const property = GlobalVariables_1.PropertyNames[type];
        if (property)
            return property.toLocaleLowerCase().replace("prop_", "");
        return;
    }
    _getObjectTypeByCode(typeCode) {
        const property = GlobalVariables_1.ObjectTypesCode[typeCode];
        if (property)
            return property.toLocaleLowerCase().replace("object_", "");
        return;
    }
    _getUnitsByCode(typeCode) {
        const property = GlobalVariables_1.UNITS_TYPES[typeCode];
        if (property)
            return property.toLocaleLowerCase().replace("units_", "").replace("_", " ");
        return;
    }
    _getPossibleDataTypes(type) {
        const analogTypes = new Set([GlobalVariables_1.ObjectTypes.OBJECT_ANALOG_INPUT, GlobalVariables_1.ObjectTypes.OBJECT_ANALOG_OUTPUT, GlobalVariables_1.ObjectTypes.OBJECT_ANALOG_VALUE, GlobalVariables_1.ObjectTypes.OBJECT_MULTI_STATE_INPUT, GlobalVariables_1.ObjectTypes.OBJECT_MULTI_STATE_OUTPUT, GlobalVariables_1.ObjectTypes.OBJECT_MULTI_STATE_VALUE]);
        const binaryTypes = new Set([GlobalVariables_1.ObjectTypes.OBJECT_BINARY_INPUT, GlobalVariables_1.ObjectTypes.OBJECT_BINARY_OUTPUT, GlobalVariables_1.ObjectTypes.OBJECT_BINARY_VALUE, GlobalVariables_1.ObjectTypes.OBJECT_BINARY_LIGHTING_OUTPUT]);
        if (analogTypes.has(type)) {
            return [GlobalVariables_1.APPLICATION_TAGS.BACNET_APPLICATION_TAG_UNSIGNED_INT, GlobalVariables_1.APPLICATION_TAGS.BACNET_APPLICATION_TAG_SIGNED_INT, GlobalVariables_1.APPLICATION_TAGS.BACNET_APPLICATION_TAG_REAL, GlobalVariables_1.APPLICATION_TAGS.BACNET_APPLICATION_TAG_DOUBLE];
        }
        if (binaryTypes.has(type))
            return [GlobalVariables_1.APPLICATION_TAGS.BACNET_APPLICATION_TAG_ENUMERATED, GlobalVariables_1.APPLICATION_TAGS.BACNET_APPLICATION_TAG_BOOLEAN];
        return [GlobalVariables_1.APPLICATION_TAGS.BACNET_APPLICATION_TAG_OCTET_STRING, GlobalVariables_1.APPLICATION_TAGS.BACNET_APPLICATION_TAG_CHARACTER_STRING, GlobalVariables_1.APPLICATION_TAGS.BACNET_APPLICATION_TAG_BIT_STRING];
    }
    _getBacnetPriority(req) {
        // if priority is defined in REQ
        if (req.priority && !isNaN(parseInt(req.priority)))
            return parseInt(req.priority);
        // else if priority is defined in .env
        if (process.env.BACNET_PRIORITY && !isNaN(parseInt(process.env.BACNET_PRIORITY)))
            return parseInt(process.env.BACNET_PRIORITY);
        // else use low priority
        return 16;
    }
}
const BacnetUtilities = BacnetUtilitiesClass.getInstance();
exports.BacnetUtilities = BacnetUtilities;
exports.default = BacnetUtilities;
//# sourceMappingURL=BacnetUtilities.js.map