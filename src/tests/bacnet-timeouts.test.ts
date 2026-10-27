import test, { mock } from "node:test";
import assert from "node:assert/strict";
import BacnetUtilities from "../utils/BacnetUtilities";
import { CLIENT_RESET_EVENT } from "../utils/constants";

test("a timed-out read does not reset the shared client or cancel another pending read", async () => {
	type ReadCallback = (error: Error | null, data?: unknown) => void;
	const callbacks: ReadCallback[] = [];
	const client = {
		readProperty: (_address: string, _sadr: unknown, _objectId: unknown, _propertyId: unknown, _options: unknown, callback: ReadCallback) => callbacks.push(callback),
		close: mock.fn(),
	};
	const getClient = mock.method(BacnetUtilities, "getClient", () => client);
	const onReset = mock.fn();
	BacnetUtilities.on(CLIENT_RESET_EVENT, onReset);
	try {
		const first = BacnetUtilities.readProperty("192.168.1.10", null, { type: 8, instance: 42 }, 77);
		const second = BacnetUtilities.readProperty("192.168.1.11", null, { type: 8, instance: 43 }, 77);
		const failed = assert.rejects(first, /ERR_TIMEOUT/);
		callbacks[0](new Error("ERR_TIMEOUT"));
		callbacks[1](null, { values: [{ type: 7, value: "available" }] });
		await failed;
		assert.deepEqual(await second, { values: [{ type: 7, value: "available" }] });
		assert.equal(client.close.mock.callCount(), 0);
		assert.equal(onReset.mock.callCount(), 0);
	} finally {
		getClient.mock.restore();
		BacnetUtilities.removeListener(CLIENT_RESET_EVENT, onReset);
	}
});

test("a timed-out multi-property read preserves the shared client", async () => {
	const timeout = new Error("ERR_TIMEOUT");
	const client = {
		readPropertyMultiple: (_address: string, _sadr: unknown, _requests: unknown, callback: (error: Error) => void) => callback(timeout),
		close: mock.fn(),
	};
	const getClient = mock.method(BacnetUtilities, "getClient", () => client);
	const onReset = mock.fn();
	BacnetUtilities.on(CLIENT_RESET_EVENT, onReset);
	try {
		await assert.rejects(BacnetUtilities.readPropertyMultiple("192.168.1.10", null, { objectId: { type: 8, instance: 42 }, properties: [{ id: 77 }] }), /ERR_TIMEOUT/);
		assert.equal(client.close.mock.callCount(), 0);
		assert.equal(onReset.mock.callCount(), 0);
	} finally {
		getClient.mock.restore();
		BacnetUtilities.removeListener(CLIENT_RESET_EVENT, onReset);
	}
});

test("a failed write does not reset the shared client", async () => {
	const client = {
		writeProperty: (_address: string, _sadr: unknown, _objectId: unknown, _propertyId: unknown, _values: unknown, _options: unknown, callback: (error: Error) => void) => callback(new Error("ERR_TIMEOUT")),
		close: mock.fn(),
	};
	const getClient = mock.method(BacnetUtilities, "getClient", () => client);
	const onReset = mock.fn();
	BacnetUtilities.on(CLIENT_RESET_EVENT, onReset);
	try {
		await assert.rejects(BacnetUtilities.writeProperty({ address: "192.168.1.10", objectId: { type: 2, instance: 42 }, deviceId: 42, id: 42, value: 12 }), /ERR_TIMEOUT/);
		assert.equal(client.close.mock.callCount(), 0);
		assert.equal(onReset.mock.callCount(), 0);
	} finally {
		getClient.mock.restore();
		BacnetUtilities.removeListener(CLIENT_RESET_EVENT, onReset);
	}
});
