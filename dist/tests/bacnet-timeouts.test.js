"use strict";
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
const node_test_1 = __importStar(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const BacnetUtilities_1 = __importDefault(require("../utils/BacnetUtilities"));
const constants_1 = require("../utils/constants");
(0, node_test_1.default)("a timed-out read does not reset the shared client or cancel another pending read", () => __awaiter(void 0, void 0, void 0, function* () {
    const callbacks = [];
    const client = {
        readProperty: (_address, _sadr, _objectId, _propertyId, _options, callback) => callbacks.push(callback),
        close: node_test_1.mock.fn(),
    };
    const getClient = node_test_1.mock.method(BacnetUtilities_1.default, "getClient", () => client);
    const onReset = node_test_1.mock.fn();
    BacnetUtilities_1.default.on(constants_1.CLIENT_RESET_EVENT, onReset);
    try {
        const first = BacnetUtilities_1.default.readProperty("192.168.1.10", null, { type: 8, instance: 42 }, 77);
        const second = BacnetUtilities_1.default.readProperty("192.168.1.11", null, { type: 8, instance: 43 }, 77);
        const failed = strict_1.default.rejects(first, /ERR_TIMEOUT/);
        callbacks[0](new Error("ERR_TIMEOUT"));
        callbacks[1](null, { values: [{ type: 7, value: "available" }] });
        yield failed;
        strict_1.default.deepEqual(yield second, { values: [{ type: 7, value: "available" }] });
        strict_1.default.equal(client.close.mock.callCount(), 0);
        strict_1.default.equal(onReset.mock.callCount(), 0);
    }
    finally {
        getClient.mock.restore();
        BacnetUtilities_1.default.removeListener(constants_1.CLIENT_RESET_EVENT, onReset);
    }
}));
(0, node_test_1.default)("a timed-out multi-property read preserves the shared client", () => __awaiter(void 0, void 0, void 0, function* () {
    const timeout = new Error("ERR_TIMEOUT");
    const client = {
        readPropertyMultiple: (_address, _sadr, _requests, callback) => callback(timeout),
        close: node_test_1.mock.fn(),
    };
    const getClient = node_test_1.mock.method(BacnetUtilities_1.default, "getClient", () => client);
    const onReset = node_test_1.mock.fn();
    BacnetUtilities_1.default.on(constants_1.CLIENT_RESET_EVENT, onReset);
    try {
        yield strict_1.default.rejects(BacnetUtilities_1.default.readPropertyMultiple("192.168.1.10", null, { objectId: { type: 8, instance: 42 }, properties: [{ id: 77 }] }), /ERR_TIMEOUT/);
        strict_1.default.equal(client.close.mock.callCount(), 0);
        strict_1.default.equal(onReset.mock.callCount(), 0);
    }
    finally {
        getClient.mock.restore();
        BacnetUtilities_1.default.removeListener(constants_1.CLIENT_RESET_EVENT, onReset);
    }
}));
(0, node_test_1.default)("a failed write does not reset the shared client", () => __awaiter(void 0, void 0, void 0, function* () {
    const client = {
        writeProperty: (_address, _sadr, _objectId, _propertyId, _values, _options, callback) => callback(new Error("ERR_TIMEOUT")),
        close: node_test_1.mock.fn(),
    };
    const getClient = node_test_1.mock.method(BacnetUtilities_1.default, "getClient", () => client);
    const onReset = node_test_1.mock.fn();
    BacnetUtilities_1.default.on(constants_1.CLIENT_RESET_EVENT, onReset);
    try {
        yield strict_1.default.rejects(BacnetUtilities_1.default.writeProperty({ address: "192.168.1.10", objectId: { type: 2, instance: 42 }, deviceId: 42, id: 42, value: 12 }), /ERR_TIMEOUT/);
        strict_1.default.equal(client.close.mock.callCount(), 0);
        strict_1.default.equal(onReset.mock.callCount(), 0);
    }
    finally {
        getClient.mock.restore();
        BacnetUtilities_1.default.removeListener(constants_1.CLIENT_RESET_EVENT, onReset);
    }
}));
(0, node_test_1.default)("discovery treats targets without a process as unicast and skips empty addresses", () => {
    const whoIs = node_test_1.mock.fn();
    const fail = node_test_1.mock.fn();
    BacnetUtilities_1.default._runTargetedDiscovery({ whoIs }, [
        { id: 50, address: "10.10.121.7", deviceId: 121007 },
        { id: 69, address: "", deviceId: "" },
    ], fail);
    strict_1.default.equal(whoIs.mock.callCount(), 1);
    strict_1.default.deepEqual(whoIs.mock.calls[0].arguments[0], { address: "10.10.121.7" });
    strict_1.default.equal(fail.mock.callCount(), 0);
});
//# sourceMappingURL=bacnet-timeouts.test.js.map