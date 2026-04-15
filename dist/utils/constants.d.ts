export declare const CLIENT_RESET_EVENT = "clientReset";
export declare const SERVICE_NAME = "spinal_bacnet_service";
export declare const DEFAULT_PORT = 47810;
export declare const IPC_RETRY_INTERVAL = 1500;
export declare const MESSAGE_EVENT_NAME = "bacnet_request";
export declare const RESPONSE_EVENT_NAME = "bacnet_response";
export declare const COV_EVENT_NAME = "cov_event";
export declare const BACNET_COV_EVENT_NAME = "cov_result_event";
export declare const REQUEST_RESPONSE_STATES: {
    readonly success: "success";
    readonly error: "error";
};
export declare const COV_EVENTS_NAMES: {
    readonly subscribed: "subscribed";
    readonly subscribe: "subscribe";
    readonly failed: "failed";
    readonly changed: "changed";
    readonly unsubscribe: "unsubscribe";
    readonly unsubscribed: "unsubscribed";
    readonly error: "error";
    readonly exit: "exit";
};
