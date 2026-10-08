"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const functions_1 = require("../utils/functions");
(0, node_test_1.default)("isValidValue returns true for BACnet typed value objects", () => {
    strict_1.default.equal((0, functions_1.isValidValue)({ type: 4, value: 42 }), true);
});
(0, node_test_1.default)("isValidValue returns false for invalid values", () => {
    strict_1.default.equal((0, functions_1.isValidValue)(null), false);
    strict_1.default.equal((0, functions_1.isValidValue)(undefined), false);
    strict_1.default.equal((0, functions_1.isValidValue)({ value: 42 }), false);
    strict_1.default.equal((0, functions_1.isValidValue)({ type: 4 }), false);
    strict_1.default.equal((0, functions_1.isValidValue)("42"), false);
});
(0, node_test_1.default)("isValidValueArray returns true only when all items are valid", () => {
    strict_1.default.equal((0, functions_1.isValidValueArray)([
        { type: 4, value: 10 },
        { type: 1, value: true },
    ]), true);
    strict_1.default.equal((0, functions_1.isValidValueArray)([
        { type: 4, value: 10 },
        { invalid: true },
    ]), false);
    strict_1.default.equal((0, functions_1.isValidValueArray)("not-an-array"), false);
});
//# sourceMappingURL=functions.test.js.map