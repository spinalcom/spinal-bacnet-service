import test from "node:test";
import assert from "node:assert/strict";

import { isValidValue, isValidValueArray } from "../utils/functions";

test("isValidValue returns true for BACnet typed value objects", () => {
	assert.equal(isValidValue({ type: 4, value: 42 }), true);
});

test("isValidValue returns false for invalid values", () => {
	assert.equal(isValidValue(null), false);
	assert.equal(isValidValue(undefined), false);
	assert.equal(isValidValue({ value: 42 }), false);
	assert.equal(isValidValue({ type: 4 }), false);
	assert.equal(isValidValue("42"), false);
});

test("isValidValueArray returns true only when all items are valid", () => {
	assert.equal(
		isValidValueArray([
			{ type: 4, value: 10 },
			{ type: 1, value: true },
		]),
		true
	);

	assert.equal(
		isValidValueArray([
			{ type: 4, value: 10 },
			{ invalid: true },
		]),
		false
	);

	assert.equal(isValidValueArray("not-an-array"), false);
});
