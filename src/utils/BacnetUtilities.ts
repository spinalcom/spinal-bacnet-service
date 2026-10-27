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
import { IDevice, IDiscoverDevicesOptions, IObjectId, IReadPropertyMultiple, IRequestArray, IReadProperty, ICovData, IWriteRequest } from "../Interfaces";
import { SEGMENTATIONS } from "./GlobalVariables";
import { EventEmitter } from "node:events";
import { CLIENT_RESET_EVENT } from "./constants";
import { isValidValue, isValidValueArray } from "./functions";
import { printDebugLog } from "./debug_logs";
import { performance } from "node:perf_hooks";

type BacnetReadErrorCategory = "bacnetError" | "reject" | "abort" | "timeout" | "localError";

interface BacnetReadTracker {
	requestedKeys: Set<string>;
	firstAttemptSuccessKeys: Set<string>;
	finalSuccessKeys: Set<string>;
	finalErrorByKey: Map<string, BacnetReadErrorCategory>;
	retries: number;
	errorsByCategory: Record<BacnetReadErrorCategory, number>;
	successfulRequestDurationsMs: number[];
}

type DiscoverIpTarget = NonNullable<IDiscoverDevicesOptions["ips"]>[number];
type DiscoverClientOptions = Pick<IDiscoverDevicesOptions, "port" | "interface" | "broadcastAddress" | "apduTimeout">;

class BacnetUtilitiesClass extends EventEmitter {
	private static instance: BacnetUtilitiesClass;
	private _client: bacnet = null;
	private readonly _DISCOVERY_WAIT_MS = 15 * 1000;

	private _debug(scope: string, message: string, data?: any): void {
		if (typeof data === "undefined") {
			printDebugLog(`[BacnetUtilities] ==> [${scope}] ${message}`);
			return;
		}

		printDebugLog(`[BacnetUtilities] ==> [${scope}] ${message}`, data);
	}

	private _getApplicationTagName(typeCode: unknown): string | undefined {
		if (typeof typeCode !== "number") return;
		return Object.entries(APPLICATION_TAGS).find(([, code]) => code === typeCode)?.[0];
	}

	private _summarizeBacnetValue(value: any): any {
		if (Array.isArray(value)) {
			const limit = 20;
			const summary = value.slice(0, limit).map((item) => this._summarizeBacnetValue(item));
			if (value.length > limit) summary.push({ truncatedItems: value.length - limit });
			return summary;
		}
		if (!value || typeof value !== "object") return value;

		if (typeof value.type === "number" && "value" in value) {
			return {
				typeCode: value.type,
				typeName: this._getApplicationTagName(value.type),
				value: this._summarizeBacnetValue(value.value),
			};
		}

		return Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => [key, this._summarizeBacnetValue(nestedValue)]));
	}

	private _summarizeReadPropertyResponse(data: any): any[] {
		return (data?.values || []).map((property: any) => ({
			propertyId: property.id ?? data.property?.id,
			arrayIndex: property.index,
			value: this._summarizeBacnetValue(property.value),
		}));
	}

	private _summarizeReadPropertyMultipleResponse(data: any): any[] {
		const objects = data?.values || [];
		const summary = objects.slice(0, 50).map((object: any) => ({
			objectId: object.objectId,
			properties: (object.values || []).slice(0, 50).map((property: any) => ({
				propertyId: property.id,
				arrayIndex: property.index,
				value: this._summarizeBacnetValue(property.value),
			})),
		}));
		if (objects.length > 50) summary.push({ truncatedObjects: objects.length - 50 });
		return summary;
	}

	private _toValidPort(value?: string | number): number | undefined {
		if (!value) return;
		const port = Number.parseInt(String(value), 10);
		if (!Number.isInteger(port) || port < 1 || port > 65535) return;
		return port;
	}

	private _toValidTimeout(value?: string | number): number | undefined {
		if (!value) return;
		const timeout = Number.parseInt(String(value), 10);
		if (!Number.isInteger(timeout) || timeout < 1) return;
		return timeout;
	}

	private _toValidTtl(value?: string | number): number | undefined {
		if (!value) return;
		const ttl = Number.parseInt(String(value), 10);
		if (!Number.isInteger(ttl) || ttl < 1 || ttl > 65535) return;
		return ttl;
	}

	private _toValidDeviceId(value?: string | number): number | undefined {
		if (typeof value === "undefined" || value === null) return;
		const deviceId = Number.parseInt(String(value), 10);
		if (!Number.isInteger(deviceId) || deviceId < 0 || deviceId > 4194303) return;
		return deviceId;
	}

	private _configureForeignDeviceRegistration(client: bacnet): void {
		const bbmdAddress = process.env.BACNET_BBMD_ADDRESS;
		if (!bbmdAddress) return;
		this._debug("_configureForeignDeviceRegistration", "Attempting foreign device registration", { bbmdAddress });

		const bbmdPort = this._toValidPort(process.env.BACNET_BBMD_PORT) || 47808;
		const bbmdTtl = this._toValidTtl(process.env.BACNET_BBMD_TTL) || 60;
		const bacnetClient = client as any;

		if (typeof bacnetClient.registerForeignDevice !== "function") {
			this._debug("_configureForeignDeviceRegistration", "registerForeignDevice is not available on this bacstack version");
			return;
		}

		bacnetClient.registerForeignDevice({ address: bbmdAddress, port: bbmdPort }, bbmdTtl, (err: Error | null) => {
			if (err) {
				this._debug("_configureForeignDeviceRegistration", "Foreign Device Registration failed", err.message || err);
				return;
			}

			this._debug("_configureForeignDeviceRegistration", `Foreign Device Registration active on ${bbmdAddress}:${bbmdPort} (ttl=${bbmdTtl}s)`);
		});
	}

	private _resolveDiscoverClientOptions(options?: DiscoverClientOptions) {
		const apduTimeout = this._toValidTimeout(options?.apduTimeout) || this._toValidTimeout(process.env.BACNET_APDU_TIMEOUT) || 6000;
		const port = this._toValidPort(options?.port) || this._toValidPort(process.env.BACNET_PORT);
		const iface = options?.interface || process.env.BACNET_INTERFACE;
		const broadcastAddress = options?.broadcastAddress || process.env.BACNET_BROADCAST_ADDRESS;

		const clientOptions: any = { apduTimeout };
		if (port) clientOptions.port = port;
		if (iface) clientOptions.interface = iface;
		if (broadcastAddress) clientOptions.broadcastAddress = broadcastAddress;

		return clientOptions;
	}

	private _toDiscoveryMapKey(address: string | undefined, deviceId: string | number | undefined, sadr: any): string {
		return `${address || ""}_${deviceId || ""}_${JSON.stringify(sadr || "")}`;
	}

	private _mapIAmDevice(device: any): IDevice {
		return {
			address: device.address,
			deviceId: device.deviceId,
			maxApdu: device.maxApdu,
			segmentation: device.segmentation,
			vendorId: device.vendorId,
			SADR: device.SADR,
		};
	}

	private _getDiscoverTargets(options?: IDiscoverDevicesOptions): DiscoverIpTarget[] {
		return Array.isArray(options?.ips) ? options.ips : [];
	}

	private _getUnicastTargets(targets: DiscoverIpTarget[]): Array<{ address: string; deviceId?: string | number }> {
		return targets.filter((target) => (!target.process || target.process === "unicast") && target.address?.trim()).map((target) => ({ address: target.address, deviceId: target.deviceId }));
	}

	private _runTargetedDiscovery(client: bacnet, targets: DiscoverIpTarget[], fail: (err: Error) => void): void {
		this._debug("discoverDevices", "Launching targeted discovery", {
			targets: targets.length,
			unicastTargets: targets.filter((target) => (!target.process || target.process === "unicast") && target.address?.trim()).length,
			bbmdTargets: targets.filter((target) => target.process === "bbmd" && target.address?.trim()).length,
		});

		for (const target of targets) {
			if (!target.address?.trim()) {
				this._debug("discoverDevices", "Skipping target with empty address", { id: target.id, process: target.process });
				continue;
			}

			if (!target.process || target.process === "unicast") {
				this._debug("discoverDevices", "Sending unicast whoIs", target.address);
				client.whoIs({ address: target.address });
				continue;
			}

			if (target.process === "bbmd") {
				this._debug("discoverDevices", "Registering BBMD target", target.address);
				this._registerForeignForDiscovery(client, target.address, (err?: Error) => {
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

	private _registerForeignForDiscovery(client: bacnet, bbmdAddress: string, next: (err?: Error) => void): void {
		const bbmdPort = this._toValidPort(process.env.BACNET_BBMD_PORT) || 47808;
		const bbmdTtl = this._toValidTtl(process.env.BACNET_BBMD_TTL) || 60;
		const currentClient = client as any;
		this._debug("_registerForeignForDiscovery", "Registering foreign device for discovery", { bbmdAddress, bbmdPort, bbmdTtl });

		if (!bbmdAddress) {
			next(new Error("discoverDevicesDynamic: bbmdAddress is required in bbmd mode"));
			return;
		}

		if (typeof currentClient.registerForeignDevice !== "function") {
			next(new Error("discoverDevicesDynamic: registerForeignDevice is not available on this bacstack version"));
			return;
		}

		currentClient.registerForeignDevice({ address: bbmdAddress, port: bbmdPort }, bbmdTtl, (err: Error | null) => {
			if (err) return next(err);
			this._debug("_registerForeignForDiscovery", "Foreign registration successful");
			next();
		});
	}

	private _readPropertyWithClient(client: bacnet, address: string, objectId: IObjectId, propertyId: number | string, options: any = {}): Promise<any> {
		this._debug("_readPropertyWithClient", "Request start", { status: "pending", address, objectId, propertyId, options });
		return new Promise((resolve, reject) => {
			client.readProperty(address, null, objectId, propertyId, options, (err: Error, data: any) => {
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

	private _extractFirstReadPropertyValue(data: any): any {
		return this._getObjValue(data?.values?.[0]?.value);
	}

	private _isValidDeviceName(name: unknown): name is string {
		return typeof name === "string" && name.trim().length > 0;
	}

	private async _ensureDiscoveredDeviceName(client: bacnet, device: IDevice): Promise<string | undefined> {
		if (!device.address) return;
		if (this._isValidDeviceName(device.name)) return device.name;

		const resolvedDeviceId = this._toValidDeviceId(device.deviceId);
		if (typeof resolvedDeviceId === "undefined") return;

		try {
			const data = await this._readPropertyWithClient(client, device.address, { type: ObjectTypes.OBJECT_DEVICE, instance: resolvedDeviceId }, PropertyIds.PROP_OBJECT_NAME);
			const name = this._extractFirstReadPropertyValue(data);
			if (!this._isValidDeviceName(name)) return;
			return name;
		} catch (error) {
			this._debug("_ensureDiscoveredDeviceName", "Failed to read PROP_OBJECT_NAME", { address: device.address, deviceId: device.deviceId, error });
			return;
		}
	}

	private async _filterUnresponsiveDiscoveredDevices(client: bacnet, devicesMap: Map<string, IDevice>): Promise<void> {
		for (const [key, device] of Array.from(devicesMap.entries())) {
			const name = await this._ensureDiscoveredDeviceName(client, device);
			if (!this._isValidDeviceName(name)) {
				this._debug("_filterUnresponsiveDiscoveredDevices", "Dropping device with empty name", { address: device.address, deviceId: device.deviceId });
				devicesMap.delete(key);
				continue;
			}

			device.name = name;
			devicesMap.set(key, device);
		}
	}

	private async _discoverDeviceByReadProperty(client: bacnet, target: { address: string; deviceId?: string | number }): Promise<IDevice | undefined> {
		this._debug("_discoverDeviceByReadProperty", "Start fallback discovery", target);
		const preferredDeviceId = this._toValidDeviceId(target.deviceId);
		if (typeof preferredDeviceId === "undefined") {
			this._debug("_discoverDeviceByReadProperty", "Fallback requires a known deviceId; provide ips[].deviceId when unicast I-Am is unavailable", { address: target.address });
			return;
		}

		const resolvedDeviceId = preferredDeviceId;
		const deviceObjectId = { type: ObjectTypes.OBJECT_DEVICE, instance: resolvedDeviceId };

		const readOptionalValue = async (propertyId: number): Promise<any> => {
			try {
				const data = await this._readPropertyWithClient(client, target.address, deviceObjectId, propertyId);
				return this._extractFirstReadPropertyValue(data);
			} catch (error) {
				return undefined;
			}
		};

		const [name, description, segmentation, vendorId, maxApdu, objectType] = await Promise.all([readOptionalValue(PropertyIds.PROP_OBJECT_NAME), readOptionalValue(PropertyIds.PROP_DESCRIPTION), readOptionalValue(PropertyIds.PROP_SEGMENTATION_SUPPORTED), readOptionalValue(PropertyIds.PROP_VENDOR_IDENTIFIER), readOptionalValue(PropertyIds.PROP_MAX_APDU_LENGTH_ACCEPTED), readOptionalValue(PropertyIds.PROP_OBJECT_TYPE)]);

		if (!this._isValidDeviceName(name)) {
			this._debug("_discoverDeviceByReadProperty", "Empty device name, considered unresponsive", { address: target.address, deviceId: resolvedDeviceId });
			return;
		}

		const typeId = typeof objectType === "number" ? objectType : ObjectTypes.OBJECT_DEVICE;

		const device: IDevice = {
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
	}

	private async _fallbackUnicastDiscoveryWithReadProperty(client: bacnet, targets: Array<{ address: string; deviceId?: string | number }>, devicesMap: Map<string, IDevice>): Promise<void> {
		this._debug("_fallbackUnicastDiscoveryWithReadProperty", "Starting unicast fallback for targets", targets.length);
		for (const target of targets) {
			if (!target.address) continue;
			const foundByWhoIs = Array.from(devicesMap.values()).some((device) => device.address === target.address);
			if (foundByWhoIs) continue;

			try {
				const discovered = await this._discoverDeviceByReadProperty(client, target);
				if (!discovered) continue;

				const key = `${discovered.address || ""}_${discovered.deviceId || ""}_`;
				devicesMap.set(key, discovered);
				this._debug("_fallbackUnicastDiscoveryWithReadProperty", "Discovered by readProperty", { target: target.address, deviceId: discovered.deviceId });
			} catch (error) {
				this._debug("_fallbackUnicastDiscoveryWithReadProperty", `Fallback failed for ${target.address}`, error);
			}
		}
	}

	private _getRequiredDeviceAddress(device: IDevice): string {
		const deviceAddress = device.address;
		if (!deviceAddress) throw new Error("Device address is required");
		return deviceAddress;
	}

	private _buildObjectDetailBaseInfo(device: IDevice, objectId: IObjectId): any {
		return {
			objectId,
			id: objectId.instance,
			typeId: objectId.type,
			type: this._getObjectTypeByCode(objectId.type),
			instance: objectId.instance,
			deviceId: device.deviceId,
		};
	}

	private async _readDeviceObjectList(device: IDevice, objectId: IObjectId, deviceAddress: string, deviceAcceptSegmentation: boolean): Promise<any> {
		if (deviceAcceptSegmentation) {
			const params = [{ objectId, properties: [{ id: PropertyIds.PROP_OBJECT_LIST }] }];
			const data = await this.readPropertyMultiple(deviceAddress, device.SADR, params);
			const dataFormatted = data.values.map((el) => el.values.map((el2) => this._formatCurrentValue(el2.value, el.objectId.type)));
			return lodash.flattenDeep(dataFormatted);
		}

		const data = await this.readProperty(deviceAddress, device.SADR, objectId, PropertyIds.PROP_OBJECT_LIST);
		return data.values;
	}

	private async _recoverDeviceObjectListFromError(error: any, device: IDevice, objectId: IObjectId, deviceAddress: string, deviceAcceptSegmentation: boolean): Promise<any> {
		if (error?.message?.match(/reason:4/i) || error?.message?.match(/err_timeout/i)) {
			return this.getItemListByFragment(device, objectId);
		}

		if (deviceAcceptSegmentation) {
			const data = await this.readProperty(deviceAddress, device.SADR, objectId, PropertyIds.PROP_OBJECT_LIST);
			return data.values;
		}

		throw error;
	}

	private async _readObjectPropertiesSequentially(deviceAddress: string, sadr: any, objectId: IObjectId, properties: number[], itemInfo: any): Promise<number> {
		let failedCount = 0;

		while (properties.length > 0) {
			try {
				const property = properties.shift();
				if (typeof property === "undefined") continue;

				const formated = await this._getPropertyValue(deviceAddress, sadr, objectId, property);
				for (const key in formated) {
					itemInfo[key] = formated[key];
				}
			} catch (error) {
				failedCount++;
			}
		}

		return failedCount;
	}

	private constructor() {
		super();
	}

	public static getInstance(): BacnetUtilitiesClass {
		if (!this.instance) this.instance = new BacnetUtilitiesClass();
		return this.instance;
	}

	public createNewBacnetClient(timeout: number = 3000): bacnet {
		const apduTimeout = this._toValidTimeout(process.env.BACNET_APDU_TIMEOUT) || timeout;
		const port = this._toValidPort(process.env.BACNET_PORT);
		const interfaceAddress = process.env.BACNET_INTERFACE;
		const broadcastAddress = process.env.BACNET_BROADCAST_ADDRESS;

		const options: any = { apduTimeout };

		if (port) options.port = port;
		if (interfaceAddress) options.interface = interfaceAddress;
		if (broadcastAddress) options.broadcastAddress = broadcastAddress;
		this._debug("createNewBacnetClient", "Creating BACnet client", options);

		const client = new bacnet(options);
		this._listenClientErrorEvent(client);
		this._configureForeignDeviceRegistration(client);
		this._debug("createNewBacnetClient", "BACnet client created");
		return client;
	}

	public getClient(): bacnet {
		if (!this._client) {
			this._debug("getClient", "No shared client found, creating one");
			this._client = this.createNewBacnetClient();
		}

		return this._client;
	}

	public discoverDevices(options?: IDiscoverDevicesOptions): Promise<IDevice[]> {
		const waitMs = this._DISCOVERY_WAIT_MS;
		this._debug("discoverDevices", "Discovery requested", {
			mode: options?.mode || "broadcast",
			clientOptions: this._resolveDiscoverClientOptions(options),
			targets: options?.ips || [],
		});
		return new Promise((resolve, reject) => {
			const mode = options?.mode || "broadcast";
			const targets = this._getDiscoverTargets(options);
			const unicastTargets = this._getUnicastTargets(targets);
			const clientOptions = this._resolveDiscoverClientOptions(options);
			const sharedClientOptions = this._resolveDiscoverClientOptions();
			const useSharedClient = clientOptions.port === sharedClientOptions.port && clientOptions.interface === sharedClientOptions.interface && clientOptions.broadcastAddress === sharedClientOptions.broadcastAddress;

			const discoveryClient = useSharedClient ? this.getClient() : new bacnet(clientOptions);
			const devicesMap = new Map<string, IDevice>();
			let settled = false;
			const onIAm = (device: any) => {
				const key = this._toDiscoveryMapKey(device.address, device.deviceId, device.SADR);
				this._debug("discoverDevices", "Received iAm", { address: device.address, deviceId: device.deviceId });
				devicesMap.set(key, this._mapIAmDevice(device));
			};
			const onError = (err: Error) => {
				this._debug("discoverDevices", "Discovery client error", err?.message || err);
			};

			// Cleanup and finalize functions for the discovery process
			const cleanup = () => {
				this._debug("discoverDevices", "Cleanup discovery listeners and socket", { sharedClient: useSharedClient });
				discoveryClient.removeListener("iAm", onIAm);
				discoveryClient.removeListener("error", onError);
				if (!useSharedClient) {
					try {
						discoveryClient.close();
					} catch (error) {
						this._debug("discoverDevices", "Close error", error);
					}
				}
			};

			// Finalize the discovery process by cleaning up and resolving the promise with discovered devices
			const finalize = async () => {
				if (settled) return;
				settled = true;
				this._debug("discoverDevices", "Finalize discovery", { devicesFound: devicesMap.size });

				if (devicesMap.size === 0 && unicastTargets.length > 0) {
					await this._fallbackUnicastDiscoveryWithReadProperty(discoveryClient, unicastTargets, devicesMap);
				}

				if (devicesMap.size > 0) {
					await this._filterUnresponsiveDiscoveredDevices(discoveryClient, devicesMap);
				}

				cleanup();
				this._debug("discoverDevices", "Discovery finished", { devicesFound: devicesMap.size });
				resolve(Array.from(devicesMap.values()));
			};

			// Handle discovery failure by cleaning up and rejecting the promise
			const fail = (err: Error) => {
				if (settled) return;
				settled = true;
				this._debug("discoverDevices", "Discovery failed", err.message || err);
				cleanup();
				reject(err);
			};

			discoveryClient.on("iAm", onIAm);
			discoveryClient.on("error", onError);

			setTimeout(() => {
				this._debug("discoverDevices", "Discovery timeout reached", waitMs);
				void finalize();
			}, waitMs);

			try {
				if (targets.length > 0) {
					this._runTargetedDiscovery(discoveryClient, targets, fail);
					return;
				}

				if (mode === "unicast") {
					fail(new Error("discoverDevices: ips is required in unicast mode"));
					return;
				}

				discoveryClient.whoIs();
				this._debug("discoverDevices", "Sending broadcast whoIs");
			} catch (error: any) {
				fail(error);
			}
		});
	}

	private _listenClientErrorEvent(client: bacnet): void {
		client.on("close", () => {
			// printDebugLog("client closed");
			// this._client = null;
		});

		client.on("timeout", (payload?: any) => {
			printDebugLog("client timeout", payload || "");
		});

		client.on("error", (err: Error) => {
			printDebugLog("error client", err.message);
		});
	}

	public [CLIENT_RESET_EVENT]() {
		this._debug("CLIENT_RESET_EVENT", "Resetting shared BACnet client");
		if (this._client) {
			try {
				this._client.close();
			} catch (error) {
				this._debug("CLIENT_RESET_EVENT", "Error while closing BACnet client", error);
			}
		}

		this._client = null;
		this._client = this.createNewBacnetClient();
		this.emit(CLIENT_RESET_EVENT, this._client);
		this._debug("CLIENT_RESET_EVENT", "Shared BACnet client reset complete");

		return this._client;
	}

	////////////////////////////////////////////////////////////////
	////                  READ BACNET DATA                        //
	////////////////////////////////////////////////////////////////

	public readPropertyMultiple(address: string, sadr: any, requestArray: IRequestArray | IRequestArray[]): Promise<IReadPropertyMultiple> {
		const requests = Array.isArray(requestArray) ? requestArray : [requestArray];
		this._debug("readPropertyMultiple", "Request start", {
			status: "pending",
			address,
			SADR: sadr,
			requestCount: requests.length,
			requests: requests.map(({ objectId, properties }) => ({ objectId, propertyIds: properties.map(({ id }) => id) })),
		});
		return new Promise(async (resolve, reject) => {
			try {
				const client = this.getClient();
				requestArray = requests;
				if (sadr && typeof sadr == "object") sadr = Object.keys(sadr).length === 0 ? null : sadr;

				client.readPropertyMultiple(address, sadr, requestArray, (err: Error, data: any) => {
					if (err) {
						this._debug("readPropertyMultiple", "Request complete", { status: "error", address, error: err.message || err });
						reject(err);
						return;
					}

					this._debug("readPropertyMultiple", "Request complete", {
						status: "success",
						address,
						objectsRetrieved: data?.values?.length || 0,
						values: this._summarizeReadPropertyMultipleResponse(data),
					});
					resolve(data);
				});
			} catch (error) {
				this._debug("readPropertyMultiple", "Request complete", { status: "error", address, error });
				reject(error);
			}
		});
	}

	public async readProperty(address: string, sadr: any, objectId: IObjectId, propertyId: number | string, clientOptions?: any): Promise<IReadProperty> {
		this._debug("readProperty", "Request start", { status: "pending", address, SADR: sadr, objectId, propertyId, options: clientOptions });
		const client = this.getClient();
		const options = clientOptions || {};
		if (sadr && typeof sadr == "object") sadr = Object.keys(sadr).length === 0 ? null : sadr;

		return new Promise((resolve, reject) => {
			client.readProperty(address, sadr, objectId, propertyId, options, (err: Error, data: any) => {
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
	}

	public async deviceIsAvailable(device: IDevice): Promise<boolean> {
		try {
			await this.readProperty(device.address!, device.SADR, { instance: device.deviceId, type: 8 }, PropertyIds.PROP_OBJECT_NAME);
			this._debug("deviceIsAvailable", "Device is available", { address: device.address, deviceId: device.deviceId });
			return true;
		} catch (error) {
			this._debug("deviceIsAvailable", "Device is unavailable", { address: device.address, deviceId: device.deviceId, error });
			return false;
		}
	}

	////////////////////////////////////////////////////////////////
	////                  GET ALL BACNET OBJECT LIST              //
	////////////////////////////////////////////////////////////////

	public async _getDeviceObjectList(device: IDevice, SENSOR_TYPES: Array<number>, getListUsingFragment: boolean = false): Promise<IObjectId[]> {
		const deviceIsAvailable = await this.deviceIsAvailable(device);
		if (!deviceIsAvailable) throw new Error("Device is not available");

		const objectId = { type: ObjectTypes.OBJECT_DEVICE, instance: device.deviceId };
		let values;
		const deviceAddress = this._getRequiredDeviceAddress(device);

		const deviceAcceptSegmentation = await this.deviceAcceptSegmentation(device);

		try {
			if (getListUsingFragment) throw new Error("reason:4"); // Force to use fragment method;
			values = await this._readDeviceObjectList(device, objectId, deviceAddress, deviceAcceptSegmentation);
		} catch (error: any) {
			values = await this._recoverDeviceObjectListFromError(error, device, objectId, deviceAddress, deviceAcceptSegmentation);
		}

		// If values is still undefined or empty after trying both methods, throw an error
		if (typeof values === "undefined" || !values?.length) throw new Error("No values found");

		return values.filter((item: any) => SENSOR_TYPES.indexOf(item.value.type) !== -1);
	}

	public async getItemListByFragment(device: IDevice, objectId: IObjectId): Promise<IObjectId[]> {
		const bacnetItemsFound: IObjectId[] = [];
		let index = 1;
		let finish = false;

		const deviceAddress = this._getRequiredDeviceAddress(device);

		while (!finish) {
			try {
				const clientOptions = { arrayIndex: index };
				const value = await this.readProperty(deviceAddress, device.SADR, objectId, PropertyIds.PROP_OBJECT_LIST, clientOptions);
				if (value) {
					index++;
					bacnetItemsFound.push(...(value.values as any[]));
				} else {
					finish = true;
				}
			} catch (err: any) {
				if (bacnetItemsFound.length === 0) {
					throw err;
				}

				// Some devices end indexed reads with an error once the last element is reached.
				finish = true;
			}
		}

		return bacnetItemsFound;
	}

	////////////////////////////////////////////////////////////////
	////                  GET OBJECT DETAIL                       //
	////////////////////////////////////////////////////////////////

	public async _getObjectDetail(device: IDevice, objects: IObjectId[]): Promise<{ [key: string]: string | boolean | number }[]> {
		const deviceIsAvailable = await this.deviceIsAvailable(device);
		if (!deviceIsAvailable) throw new Error("Device is not available");

		let objectLists: (IObjectId | IObjectId[])[] = [...objects];

		let objectListDetails: { [key: string]: string | boolean | number }[] = [];
		const deviceAcceptSegmentation = await this.deviceAcceptSegmentation(device);

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
					if (deviceAcceptSegmentation && deviceIsAvailable) {
						const itemsFound = await this._retryGetObjectDetailWithReadProperty(object, device);
						if (itemsFound.length > 0) objectListDetails.push(itemsFound);
					}
				}
			}
		}

		if (deviceAcceptSegmentation) objectListDetails = lodash.flattenDeep(objectListDetails as any[]);

		return objectListDetails;
	}

	private async _retryGetObjectDetailWithReadProperty(items: IObjectId[], device: IDevice): Promise<any> {
		const itemsFound: any[] = [];
		let totalFailedCount = 0;

		for (const item of items) {
			try {
				const res = await this._getObjectDetailWithReadProperty(device, item);
				if (res) itemsFound.push(res);
			} catch (error) {
				totalFailedCount++;
			}
		}

		if (totalFailedCount === items.length) throw new Error("Failed to get details for all items");

		return itemsFound;
	}

	public async _getObjectDetailWithReadPropertyMultiple(device: IDevice, objects: IObjectId[]): Promise<any[]> {
		try {
			const deviceAddress = this._getRequiredDeviceAddress(device);

			const deviceIsAvailable = await this.deviceIsAvailable(device);
			if (!deviceIsAvailable) throw new Error("Device is not available");

			const requestArray: IRequestArray[] = objects.map((el) => ({
				objectId: JSON.parse(JSON.stringify(el)),
				properties: [{ id: PropertyIds.PROP_OBJECT_NAME }, { id: PropertyIds.PROP_PRESENT_VALUE }, { id: PropertyIds.PROP_DESCRIPTION }, { id: PropertyIds.PROP_OBJECT_TYPE }, { id: PropertyIds.PROP_UNITS }, { id: PropertyIds.PROP_MAX_PRES_VALUE }, { id: PropertyIds.PROP_MIN_PRES_VALUE }, { id: PropertyIds.PROP_BIT_TEXT }],
			}));
			const data = await this.readPropertyMultiple(deviceAddress, device.SADR, requestArray);

			return data.values.map((el) => {
				const { objectId } = el;

				const itemInfo: any = this._buildObjectDetailBaseInfo(device, objectId);

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
		const deviceAddress = this._getRequiredDeviceAddress(device);
		const deviceIsAvailable = await this.deviceIsAvailable(device);

		if (!deviceIsAvailable) throw new Error("Device is not available");

		const properties = [PropertyIds.PROP_OBJECT_NAME, PropertyIds.PROP_PRESENT_VALUE, PropertyIds.PROP_DESCRIPTION, PropertyIds.PROP_OBJECT_TYPE, PropertyIds.PROP_UNITS, PropertyIds.PROP_MAX_PRES_VALUE, PropertyIds.PROP_MIN_PRES_VALUE, PropertyIds.PROP_BIT_TEXT];

		const propertiesLength = properties.length;

		const itemInfo: any = this._buildObjectDetailBaseInfo(device, objectId);

		const failedCount = await this._readObjectPropertiesSequentially(deviceAddress, device.SADR, objectId, properties, itemInfo);

		if (failedCount === propertiesLength) throw new Error("failed to get object details");

		return itemInfo;
	}

	private async deviceAcceptSegmentation(device: IDevice): Promise<boolean> {
		try {
			if (!isNaN(device.segmentation as number)) {
				return [SEGMENTATIONS.SEGMENTATION_BOTH, SEGMENTATIONS.SEGMENTATION_TRANSMIT].indexOf(device.segmentation) !== -1;
			}

			const objectId = { type: ObjectTypes.OBJECT_DEVICE, instance: device.deviceId };
			const propertyId = PropertyIds.PROP_SEGMENTATION_SUPPORTED;
			const formated: any = await this._getPropertyValue(device.address as string, device.SADR, objectId, propertyId);
			const propertyName = this._getPropertyNameByCode(propertyId);
			if (formated && propertyName) {
				const value = formated[propertyName];
				return [SEGMENTATIONS.SEGMENTATION_BOTH, SEGMENTATIONS.SEGMENTATION_TRANSMIT].indexOf(value) !== -1;
			}

			return false;
		} catch (error) {
			return false;
		}
	}

	public async _getChildrenNewValue(device: IDevice, children: Array<IObjectId>): Promise<Array<{ id: string | number; type: string | number; currentValue: any }> | undefined> {
		const deviceAcceptSegmentation = await this.deviceAcceptSegmentation(device);

		if (deviceAcceptSegmentation) return this.getChildrenNewValueWithReadPropertyMultiple(device, children);

		return this.getChildrenNewValueWithReadProperty(device, children);
	}

	public async _getChildrenNewValueWithMetrics(
		device: IDevice,
		children: Array<IObjectId>,
	): Promise<{
		values: Array<{ id: string | number; type: string | number; currentValue: any }> | undefined;
		telemetry: {
			requestedPoints: number;
			firstAttemptSuccesses: number;
			finalSuccesses: number;
			retries: number;
			timedOutPoints: number;
			errorsByCategory: Record<BacnetReadErrorCategory, number>;
			successfulRequestDurationsMs: number[];
		};
		error?: string;
	}> {
		const tracker: BacnetReadTracker = {
			requestedKeys: new Set(children.map((child) => this._readObjectKey(child))),
			firstAttemptSuccessKeys: new Set(),
			finalSuccessKeys: new Set(),
			finalErrorByKey: new Map(),
			retries: 0,
			errorsByCategory: { bacnetError: 0, reject: 0, abort: 0, timeout: 0, localError: 0 },
			successfulRequestDurationsMs: [],
		};

		let values: Array<{ id: string | number; type: string | number; currentValue: any }> | undefined;
		let errorMessage: string | undefined;

		try {
			const deviceAcceptSegmentation = await this.deviceAcceptSegmentation(device);
			values = deviceAcceptSegmentation ? await this.getChildrenNewValueWithReadPropertyMultiple(device, children, tracker) : await this.getChildrenNewValueWithReadProperty(device, children, tracker);
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		}

		for (const key of tracker.requestedKeys) {
			if (tracker.finalSuccessKeys.has(key)) {
				tracker.finalErrorByKey.delete(key);
			} else if (!tracker.finalErrorByKey.has(key)) {
				tracker.finalErrorByKey.set(key, "localError");
				tracker.errorsByCategory.localError++;
			}
		}

		return {
			values,
			telemetry: {
				requestedPoints: children.length,
				firstAttemptSuccesses: tracker.firstAttemptSuccessKeys.size,
				finalSuccesses: tracker.finalSuccessKeys.size,
				retries: tracker.retries,
				timedOutPoints: Array.from(tracker.finalErrorByKey.values()).filter((category) => category === "timeout").length,
				errorsByCategory: tracker.errorsByCategory,
				successfulRequestDurationsMs: tracker.successfulRequestDurationsMs,
			},
			...(errorMessage && { error: errorMessage }),
		};
	}

	private _readObjectKey(object: IObjectId): string {
		return `${object.type}_${object.instance}`;
	}

	private _classifyReadError(error: unknown): BacnetReadErrorCategory {
		const value = error as any;
		const message = [value?.name, value?.message, value?.code, value?.errorClass, value?.errorCode, value?.errClass, value?.errCode]
			.filter((part) => typeof part !== "undefined" && part !== null)
			.join(" ")
			.toLowerCase();

		if (/err_?timeout|timeout/.test(message)) return "timeout";
		if (/\breject\b|reject[-_ ]?pdu/.test(message)) return "reject";
		if (/\babort\b|abort[-_ ]?pdu/.test(message)) return "abort";
		if (value?.errorClass || value?.errorCode || value?.errClass || value?.errCode || /bacnet error|error class|error code/.test(message)) return "bacnetError";
		return "localError";
	}

	private _recordReadSuccess(tracker: BacnetReadTracker | undefined, objects: IObjectId[], startedAt: number, firstAttempt: boolean): void {
		if (!tracker || objects.length === 0) return;

		tracker.successfulRequestDurationsMs.push(Math.max(0, performance.now() - startedAt));
		for (const object of objects) {
			const key = this._readObjectKey(object);
			tracker.finalSuccessKeys.add(key);
			tracker.finalErrorByKey.delete(key);
			if (firstAttempt) tracker.firstAttemptSuccessKeys.add(key);
		}
	}

	private _isBacnetErrorValue(value: any): boolean {
		if (Array.isArray(value)) return value.some((entry) => this._isBacnetErrorValue(entry));
		return !!value && typeof value === "object" && typeof value.errorClass !== "undefined" && typeof value.errorCode !== "undefined";
	}

	private _recordReadError(tracker: BacnetReadTracker | undefined, objects: IObjectId[], error: unknown): void {
		if (!tracker) return;

		const category = this._classifyReadError(error);
		tracker.errorsByCategory[category]++;
		for (const object of objects) tracker.finalErrorByKey.set(this._readObjectKey(object), category);
	}

	private async getChildrenNewValueWithReadPropertyMultiple(device: IDevice, children: Array<IObjectId>, tracker?: BacnetReadTracker): Promise<Array<{ id: string | number; type: string | number; currentValue: any }> | undefined> {
		try {
			const requestArray = children.map((el) => ({ objectId: el, properties: [{ id: PropertyIds.PROP_PRESENT_VALUE }] }));

			const list_chunked = lodash.chunk(requestArray, 50);
			const deviceAddress = this._getRequiredDeviceAddress(device);

			const res: any[] = [];

			while (list_chunked.length > 0) {
				const arr = list_chunked.pop();
				if (!arr) continue;

				const startedAt = performance.now();
				let data: IReadPropertyMultiple;
				let dataFormated: { id: string | number; type: string | number; currentValue: any }[];
				try {
					data = await this.readPropertyMultiple(deviceAddress, device.SADR, arr);
					dataFormated = data.values.map((el) => {
						const value = this._getObjValue(el.values[0].value);
						return {
							id: el.objectId.instance,
							type: el.objectId.type,
							currentValue: this._formatCurrentValue(value, el.objectId.type),
						};
					});
					const successfulObjects = data.values.filter((el) => !this._isBacnetErrorValue(el.values[0]?.value)).map((el) => el.objectId);
					for (const el of data.values) {
						if (this._isBacnetErrorValue(el.values[0]?.value)) this._recordReadError(tracker, [el.objectId], el.values[0].value);
					}
					this._recordReadSuccess(tracker, successfulObjects, startedAt, true);
				} catch (error) {
					this._recordReadError(
						tracker,
						arr.map(({ objectId }) => objectId),
						error,
					);
					throw error;
				}

				res.push(dataFormated);
			}

			return lodash.flattenDeep(res);
		} catch (error) {
			const deviceIdAvailable = await this.deviceIsAvailable(device);
			if (deviceIdAvailable) {
				return this.getChildrenNewValueWithReadProperty(device, children, tracker, true);
			}
			throw error;
		}
	}

	private async getChildrenNewValueWithReadProperty(device: IDevice, children: Array<IObjectId>, tracker?: BacnetReadTracker, isRetry = false): Promise<Array<{ id: string | number; type: string | number; currentValue: any }> | undefined> {
		const res: any[] = [];

		try {
			const deep_children = [...children];
			let rejectCount = 0;
			const deviceAddress = this._getRequiredDeviceAddress(device);

			while (deep_children.length > 0) {
				const child: any = deep_children.shift();

				if (child) {
					if (isRetry && tracker) tracker.retries++;
					const startedAt = performance.now();
					try {
						child.id = child.instance;
						const data = await this.readProperty(deviceAddress, device.SADR, child, PropertyIds.PROP_PRESENT_VALUE);
						const value = data.values[0]?.value;
						child.currentValue = this._formatCurrentValue(this._getObjValue(value), child.type);
						res.push(child);
						if (this._isBacnetErrorValue(value)) this._recordReadError(tracker, [child], value);
						else this._recordReadSuccess(tracker, [child], startedAt, !isRetry);
					} catch (error) {
						this._recordReadError(tracker, [child], error);
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
		this._debug("writeProperty", "Write request start", {
			status: "pending",
			address: request.address,
			deviceId: request.deviceId,
			requestId: request.id,
			objectId: request.objectId,
			propertyId: PropertyIds.PROP_PRESENT_VALUE,
			requestedValue: request.value,
			releasePriority,
		});
		const types = this._getPossibleDataTypes(request.objectId.type);
		let success = false;
		let data = null;
		let lastError: unknown = null;

		while (types.length > 0 && !success) {
			const type = types.shift();
			try {
				if (typeof type === "undefined") throw new Error("No more data types to try");
				this._debug("writeProperty", "Trying BACnet application type", { typeCode: type, typeName: this._getApplicationTagName(type) });
				data = await this._writePropertyWithType(request, type);
				success = true;
				if (releasePriority) await this._releasePriority(request, type);
			} catch (error) {
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
				propertyId: PropertyIds.PROP_PRESENT_VALUE,
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
			propertyId: PropertyIds.PROP_PRESENT_VALUE,
			acknowledgement: data,
		});
		return data;
	}

	private async _writePropertyWithType(request: IWriteRequest, dataType: number): Promise<any> {
		return new Promise(async (resolve, reject) => {
			const client = this.getClient();
			const valueConverted = this._convertValueToBoolean(request.value) ? 1 : 0;
			const value = dataType === APPLICATION_TAGS.BACNET_APPLICATION_TAG_ENUMERATED ? valueConverted : request.value;
			const sadr = !request.SADR || (typeof request.SADR === "object" && Object.keys(request.SADR).length === 0) ? null : request.SADR;

			const priority = this._getBacnetPriority(request);
			this._debug("_writePropertyWithType", "Sending writeProperty", {
				status: "pending",
				address: request.address,
				deviceId: request.deviceId,
				requestId: request.id,
				objectId: request.objectId,
				propertyId: PropertyIds.PROP_PRESENT_VALUE,
				value: this._summarizeBacnetValue({ type: dataType, value }),
				priority,
			});

			client.writeProperty(request.address, sadr, request.objectId, PropertyIds.PROP_PRESENT_VALUE, [{ type: dataType, value: value }], { priority }, (err: Error, value: any) => {
				if (err) {
					this._debug("_writePropertyWithType", "Write response", {
						status: "error",
						address: request.address,
						requestId: request.id,
						objectId: request.objectId,
						propertyId: PropertyIds.PROP_PRESENT_VALUE,
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
					propertyId: PropertyIds.PROP_PRESENT_VALUE,
					typeCode: dataType,
					typeName: this._getApplicationTagName(dataType),
					acknowledgement: value,
				});
				resolve(value);
			});
		});
	}

	private _convertValueToBoolean(value: string | number | boolean): boolean {
		if (typeof value === "boolean") return value;
		if (typeof value === "number") return value !== 0;
		if (typeof value === "string") {
			const val = value.toLowerCase();

			return val === "true" || val === "1";
		}

		return false;
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
					obj[propertyName] = this._formatCurrentValue(this._getObjValue(value), property?.type);
				}
			}

			if (typeof obj.units !== "undefined") {
				if (typeof obj.units === "object") obj.units = "";
				else obj.units = this._getUnitsByCode(obj.units);
			}

			return obj;
		}

		return {};
	}

	public _getObjValue(value: any): boolean | string | number | any {
		let temp_value = value;

		if (!isValidValue(value) && !isValidValueArray(value) && typeof value !== "object") temp_value = value;
		if (isValidValue(value)) temp_value = value.value;
		if (isValidValueArray(value)) temp_value = value.map((v) => v.value);

		if (Array.isArray(temp_value) && temp_value.length === 1) return temp_value[0];
		return temp_value;

		// return typeof temp_value === "object" ? "" : temp_value;
	}

	public _formatCurrentValue(value: any, type: number | string): boolean | string | number {
		if ([ObjectTypes.OBJECT_BINARY_INPUT, ObjectTypes.OBJECT_BINARY_OUTPUT, ObjectTypes.OBJECT_BINARY_VALUE, ObjectTypes.OBJECT_BINARY_LIGHTING_OUTPUT].indexOf(type) !== -1) {
			return value ? true : false;
		}

		if (typeof value === "object" && "errorClass" in value && "errorCode" in value) return "";

		return value;
	}

	public _getPropertyNameByCode(type: number): string | undefined {
		const property = PropertyNames[type];
		if (property) return property.toLocaleLowerCase().replace("prop_", "");
		return;
	}

	public _getObjectTypeByCode(typeCode: number | string): string | undefined {
		const property = ObjectTypesCode[typeCode];
		if (property) return property.toLocaleLowerCase().replace("object_", "");
		return;
	}

	public _getUnitsByCode(typeCode: number): string | undefined {
		const property = UNITS_TYPES[typeCode];
		if (property) return property.toLocaleLowerCase().replace("units_", "").replace("_", " ");
		return;
	}

	private _getPossibleDataTypes(type: number | string): number[] {
		const analogTypes = new Set([ObjectTypes.OBJECT_ANALOG_INPUT, ObjectTypes.OBJECT_ANALOG_OUTPUT, ObjectTypes.OBJECT_ANALOG_VALUE, ObjectTypes.OBJECT_MULTI_STATE_INPUT, ObjectTypes.OBJECT_MULTI_STATE_OUTPUT, ObjectTypes.OBJECT_MULTI_STATE_VALUE]);

		const binaryTypes = new Set([ObjectTypes.OBJECT_BINARY_INPUT, ObjectTypes.OBJECT_BINARY_OUTPUT, ObjectTypes.OBJECT_BINARY_VALUE, ObjectTypes.OBJECT_BINARY_LIGHTING_OUTPUT]);

		if (analogTypes.has(type)) {
			return [APPLICATION_TAGS.BACNET_APPLICATION_TAG_UNSIGNED_INT, APPLICATION_TAGS.BACNET_APPLICATION_TAG_SIGNED_INT, APPLICATION_TAGS.BACNET_APPLICATION_TAG_REAL, APPLICATION_TAGS.BACNET_APPLICATION_TAG_DOUBLE];
		}

		if (binaryTypes.has(type)) return [APPLICATION_TAGS.BACNET_APPLICATION_TAG_ENUMERATED, APPLICATION_TAGS.BACNET_APPLICATION_TAG_BOOLEAN];

		return [APPLICATION_TAGS.BACNET_APPLICATION_TAG_OCTET_STRING, APPLICATION_TAGS.BACNET_APPLICATION_TAG_CHARACTER_STRING, APPLICATION_TAGS.BACNET_APPLICATION_TAG_BIT_STRING];
	}

	private _getBacnetPriority(req: any | IWriteRequest): number {
		// if priority is defined in REQ
		if (req.priority && !isNaN(parseInt(req.priority))) return parseInt(req.priority);

		// else if priority is defined in .env
		if (process.env.BACNET_PRIORITY && !isNaN(parseInt(process.env.BACNET_PRIORITY))) return parseInt(process.env.BACNET_PRIORITY);

		// else use low priority
		return 16;
	}
}

const BacnetUtilities = BacnetUtilitiesClass.getInstance();
export default BacnetUtilities;
export { BacnetUtilities };
