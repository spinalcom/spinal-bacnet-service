export const CLIENT_RESET_EVENT = "clientReset";
export const SERVICE_NAME = "spinal_bacnet_service";
export const DEFAULT_PORT = 47810;
export const IPC_RETRY_INTERVAL = 1500;
export const MESSAGE_EVENT_NAME = "bacnet_request";
export const RESPONSE_EVENT_NAME = "bacnet_response";
export const COV_EVENT_NAME = "cov_event";
export const BACNET_COV_EVENT_NAME = "cov_result_event";

export const REQUEST_RESPONSE_STATES = {
    success: "success",
    error: "error"
} as const;


export const COV_EVENTS_NAMES = {
    "subscribed": "subscribed",
    "subscribe": "subscribe",
    "failed": "failed",
    "changed": "changed",
    "unsubscribe": "unsubscribe",
    "unsubscribed": "unsubscribed",
    "error": "error",
    "exit": "exit"
} as const;