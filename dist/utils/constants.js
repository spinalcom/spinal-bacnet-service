"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COV_EVENTS_NAMES = exports.REQUEST_RESPONSE_STATES = exports.BACNET_COV_EVENT_NAME = exports.COV_EVENT_NAME = exports.RESPONSE_EVENT_NAME = exports.MESSAGE_EVENT_NAME = exports.IPC_RETRY_INTERVAL = exports.DEFAULT_PORT = exports.SERVICE_NAME = exports.CLIENT_RESET_EVENT = void 0;
exports.CLIENT_RESET_EVENT = "clientReset";
exports.SERVICE_NAME = "spinal_bacnet_service";
exports.DEFAULT_PORT = 47810;
exports.IPC_RETRY_INTERVAL = 1500;
exports.MESSAGE_EVENT_NAME = "bacnet_request";
exports.RESPONSE_EVENT_NAME = "bacnet_response";
exports.COV_EVENT_NAME = "cov_event";
exports.BACNET_COV_EVENT_NAME = "cov_result_event";
exports.REQUEST_RESPONSE_STATES = {
    success: "success",
    error: "error"
};
exports.COV_EVENTS_NAMES = {
    "subscribed": "subscribed",
    "subscribe": "subscribe",
    "failed": "failed",
    "changed": "changed",
    "unsubscribe": "unsubscribe",
    "unsubscribed": "unsubscribed",
    "error": "error",
    "exit": "exit"
};
//# sourceMappingURL=constants.js.map