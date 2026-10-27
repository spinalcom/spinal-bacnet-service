import assert from "node:assert/strict";
import test from "node:test";
import BacnetUtilities from "../utils/BacnetUtilities";
import { SpinalCov } from "../utils/cov";
import { COV_EVENTS_NAMES } from "../utils/constants";

test("reports final timeouts for individual point reads", async () => {
	const utilities = BacnetUtilities as any;
	const originalSegmentationCheck = utilities.deviceAcceptSegmentation;
	const originalReadProperty = utilities.readProperty;

	utilities.deviceAcceptSegmentation = async () => false;
	utilities.readProperty = async (_address: string, _sadr: unknown, object: { instance: number }) => {
		if (object.instance === 2) throw new Error("ERR_TIMEOUT");
		if (object.instance === 3) return { values: [{ value: { errorClass: 2, errorCode: 5 } }] };
		return { values: [{ value: { type: 4, value: 42 } }] };
	};

	try {
		const result = await BacnetUtilities._getChildrenNewValueWithMetrics(
			{ address: "192.0.2.1", deviceId: 1, SADR: "" },
			[
				{ type: 0, instance: 1 },
				{ type: 0, instance: 2 },
				{ type: 0, instance: 3 },
			],
		);

		assert.equal(result.telemetry.requestedPoints, 3);
		assert.equal(result.telemetry.firstAttemptSuccesses, 1);
		assert.equal(result.telemetry.finalSuccesses, 1);
		assert.equal(result.telemetry.retries, 0);
		assert.equal(result.telemetry.timedOutPoints, 1);
		assert.equal(result.telemetry.errorsByCategory.timeout, 1);
		assert.equal(result.telemetry.errorsByCategory.bacnetError, 1);
		assert.equal(result.telemetry.successfulRequestDurationsMs.length, 1);
		assert.equal(result.values?.[0].currentValue, 42);
	} finally {
		utilities.deviceAcceptSegmentation = originalSegmentationCheck;
		utilities.readProperty = originalReadProperty;
	}
});

test("counts property-read fallback as retries and clears recovered timeouts", async () => {
	const utilities = BacnetUtilities as any;
	const originalSegmentationCheck = utilities.deviceAcceptSegmentation;
	const originalReadPropertyMultiple = utilities.readPropertyMultiple;
	const originalReadProperty = utilities.readProperty;
	const originalDeviceIsAvailable = utilities.deviceIsAvailable;

	utilities.deviceAcceptSegmentation = async () => true;
	utilities.readPropertyMultiple = async () => {
		throw new Error("ERR_TIMEOUT");
	};
	utilities.deviceIsAvailable = async () => true;
	utilities.readProperty = async (_address: string, _sadr: unknown, object: { instance: number }) => ({
		values: [{ value: { type: 4, value: object.instance * 10 } }],
	});

	try {
		const result = await BacnetUtilities._getChildrenNewValueWithMetrics(
				{ address: "192.0.2.1", deviceId: 1, SADR: "" },
			[
				{ type: 0, instance: 1 },
				{ type: 0, instance: 2 },
			],
		);

		assert.equal(result.telemetry.requestedPoints, 2);
		assert.equal(result.telemetry.firstAttemptSuccesses, 0);
		assert.equal(result.telemetry.finalSuccesses, 2);
		assert.equal(result.telemetry.retries, 2);
		assert.equal(result.telemetry.timedOutPoints, 0);
		assert.equal(result.telemetry.errorsByCategory.timeout, 1);
	} finally {
		utilities.deviceAcceptSegmentation = originalSegmentationCheck;
		utilities.readPropertyMultiple = originalReadPropertyMultiple;
		utilities.readProperty = originalReadProperty;
		utilities.deviceIsAvailable = originalDeviceIsAvailable;
	}
});

test("publishes explicit renewal lifecycle events for COV telemetry", async () => {
	const spinalCov = SpinalCov.getInstance() as any;
	const previousSubscriptions = spinalCov.monitoredSubscriptions;
	const previousSendEvent = spinalCov._sendEvent;
	const previousSendSubscribeRequest = spinalCov._sendSubscribeRequestToBacnet;
	const previousListenChangeEvent = spinalCov._listenChangeEvent;
	const bacnetUtilities = BacnetUtilities as any;
	const previousGetClient = bacnetUtilities.getClient;
	const events: any[] = [];

	spinalCov.monitoredSubscriptions = new Map([
		["192.0.2.1_0_1", { ip: "192.0.2.1", object: { type: 0, instance: 1 } }],
	]);
	spinalCov._sendEvent = (event: any) => events.push(event);
	spinalCov._sendSubscribeRequestToBacnet = async () => undefined;
	spinalCov._listenChangeEvent = () => undefined;
	bacnetUtilities.getClient = () => ({});

	try {
		await spinalCov._resubscribeToCovItems();
		assert.deepEqual(
			events.map(({ eventName, operation }: any) => [eventName, operation]),
			[
				[COV_EVENTS_NAMES.renewalStart, "renewal"],
				[COV_EVENTS_NAMES.subscribed, "renewal"],
			],
		);
	} finally {
		spinalCov.monitoredSubscriptions = previousSubscriptions;
		spinalCov._sendEvent = previousSendEvent;
		spinalCov._sendSubscribeRequestToBacnet = previousSendSubscribeRequest;
		spinalCov._listenChangeEvent = previousListenChangeEvent;
		bacnetUtilities.getClient = previousGetClient;
	}
});
