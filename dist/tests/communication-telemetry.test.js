"use strict";
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
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const BacnetUtilities_1 = __importDefault(require("../utils/BacnetUtilities"));
const cov_1 = require("../utils/cov");
const constants_1 = require("../utils/constants");
(0, node_test_1.default)("reports final timeouts for individual point reads", () => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const utilities = BacnetUtilities_1.default;
    const originalSegmentationCheck = utilities.deviceAcceptSegmentation;
    const originalReadProperty = utilities.readProperty;
    utilities.deviceAcceptSegmentation = () => __awaiter(void 0, void 0, void 0, function* () { return false; });
    utilities.readProperty = (_address, _sadr, object) => __awaiter(void 0, void 0, void 0, function* () {
        if (object.instance === 2)
            throw new Error("ERR_TIMEOUT");
        if (object.instance === 3)
            return { values: [{ value: { errorClass: 2, errorCode: 5 } }] };
        return { values: [{ value: { type: 4, value: 42 } }] };
    });
    try {
        const result = yield BacnetUtilities_1.default._getChildrenNewValueWithMetrics({ address: "192.0.2.1", deviceId: 1, SADR: "" }, [
            { type: 0, instance: 1 },
            { type: 0, instance: 2 },
            { type: 0, instance: 3 },
        ]);
        strict_1.default.equal(result.telemetry.requestedPoints, 3);
        strict_1.default.equal(result.telemetry.firstAttemptSuccesses, 1);
        strict_1.default.equal(result.telemetry.finalSuccesses, 1);
        strict_1.default.equal(result.telemetry.retries, 0);
        strict_1.default.equal(result.telemetry.timedOutPoints, 1);
        strict_1.default.equal(result.telemetry.errorsByCategory.timeout, 1);
        strict_1.default.equal(result.telemetry.errorsByCategory.bacnetError, 1);
        strict_1.default.equal(result.telemetry.successfulRequestDurationsMs.length, 1);
        strict_1.default.equal((_a = result.values) === null || _a === void 0 ? void 0 : _a[0].currentValue, 42);
    }
    finally {
        utilities.deviceAcceptSegmentation = originalSegmentationCheck;
        utilities.readProperty = originalReadProperty;
    }
}));
(0, node_test_1.default)("counts property-read fallback as retries and clears recovered timeouts", () => __awaiter(void 0, void 0, void 0, function* () {
    const utilities = BacnetUtilities_1.default;
    const originalSegmentationCheck = utilities.deviceAcceptSegmentation;
    const originalReadPropertyMultiple = utilities.readPropertyMultiple;
    const originalReadProperty = utilities.readProperty;
    const originalDeviceIsAvailable = utilities.deviceIsAvailable;
    utilities.deviceAcceptSegmentation = () => __awaiter(void 0, void 0, void 0, function* () { return true; });
    utilities.readPropertyMultiple = () => __awaiter(void 0, void 0, void 0, function* () {
        throw new Error("ERR_TIMEOUT");
    });
    utilities.deviceIsAvailable = () => __awaiter(void 0, void 0, void 0, function* () { return true; });
    utilities.readProperty = (_address, _sadr, object) => __awaiter(void 0, void 0, void 0, function* () {
        return ({
            values: [{ value: { type: 4, value: object.instance * 10 } }],
        });
    });
    try {
        const result = yield BacnetUtilities_1.default._getChildrenNewValueWithMetrics({ address: "192.0.2.1", deviceId: 1, SADR: "" }, [
            { type: 0, instance: 1 },
            { type: 0, instance: 2 },
        ]);
        strict_1.default.equal(result.telemetry.requestedPoints, 2);
        strict_1.default.equal(result.telemetry.firstAttemptSuccesses, 0);
        strict_1.default.equal(result.telemetry.finalSuccesses, 2);
        strict_1.default.equal(result.telemetry.retries, 2);
        strict_1.default.equal(result.telemetry.timedOutPoints, 0);
        strict_1.default.equal(result.telemetry.errorsByCategory.timeout, 1);
    }
    finally {
        utilities.deviceAcceptSegmentation = originalSegmentationCheck;
        utilities.readPropertyMultiple = originalReadPropertyMultiple;
        utilities.readProperty = originalReadProperty;
        utilities.deviceIsAvailable = originalDeviceIsAvailable;
    }
}));
(0, node_test_1.default)("publishes explicit renewal lifecycle events for COV telemetry", () => __awaiter(void 0, void 0, void 0, function* () {
    const spinalCov = cov_1.SpinalCov.getInstance();
    const previousSubscriptions = spinalCov.monitoredSubscriptions;
    const previousSendEvent = spinalCov._sendEvent;
    const previousSendSubscribeRequest = spinalCov._sendSubscribeRequestToBacnet;
    const previousListenChangeEvent = spinalCov._listenChangeEvent;
    const bacnetUtilities = BacnetUtilities_1.default;
    const previousGetClient = bacnetUtilities.getClient;
    const events = [];
    spinalCov.monitoredSubscriptions = new Map([
        ["192.0.2.1_0_1", { ip: "192.0.2.1", object: { type: 0, instance: 1 } }],
    ]);
    spinalCov._sendEvent = (event) => events.push(event);
    spinalCov._sendSubscribeRequestToBacnet = () => __awaiter(void 0, void 0, void 0, function* () { return undefined; });
    spinalCov._listenChangeEvent = () => undefined;
    bacnetUtilities.getClient = () => ({});
    try {
        yield spinalCov._resubscribeToCovItems();
        strict_1.default.deepEqual(events.map(({ eventName, operation }) => [eventName, operation]), [
            [constants_1.COV_EVENTS_NAMES.renewalStart, "renewal"],
            [constants_1.COV_EVENTS_NAMES.subscribed, "renewal"],
        ]);
    }
    finally {
        spinalCov.monitoredSubscriptions = previousSubscriptions;
        spinalCov._sendEvent = previousSendEvent;
        spinalCov._sendSubscribeRequestToBacnet = previousSendSubscribeRequest;
        spinalCov._listenChangeEvent = previousListenChangeEvent;
        bacnetUtilities.getClient = previousGetClient;
    }
}));
//# sourceMappingURL=communication-telemetry.test.js.map