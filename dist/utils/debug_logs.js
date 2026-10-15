"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.printDebugLog = printDebugLog;
function printDebugLog(message, ...optionalParams) {
    var _a, _b;
    const logging = ((_a = process.env) === null || _a === void 0 ? void 0 : _a.LOG_BACNET_SERVICE) == "1" || ((_b = process.env) === null || _b === void 0 ? void 0 : _b.LOG_BACNET_SERVICE) == "true";
    if (logging)
        console.log(message, ...optionalParams);
}
//# sourceMappingURL=debug_logs.js.map