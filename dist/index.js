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
exports.launchBacnetService = launchBacnetService;
const net_1 = __importDefault(require("net"));
const node_ipc_1 = __importDefault(require("node-ipc"));
const constants_1 = require("./constants");
const BacnetUtilities_1 = __importDefault(require("./utils/BacnetUtilities"));
function launchBacnetService() {
    return __awaiter(this, arguments, void 0, function* (port = constants_1.DEFAULT_PORT) {
        const isAlreadyRunning = yield serverIsRunning(port);
        if (isAlreadyRunning)
            return console.log(`Bacnet service is already running on port ${port}.`);
        node_ipc_1.default.config.id = constants_1.SERVICE_NAME;
        node_ipc_1.default.config.retry = constants_1.IPC_RETRY_INTERVAL;
        node_ipc_1.default.config.silent = true;
        node_ipc_1.default.serveNet("127.0.0.1", port, () => node_ipc_1.default.server.on(constants_1.MESSAGE_EVENT_NAME, (data, socket) => __awaiter(this, void 0, void 0, function* () {
            const { id } = data;
            const result = yield handleBacnetRequest(data);
            console.log(result);
            node_ipc_1.default.server.emit(socket, `${constants_1.RESPONSE_EVENT_NAME}_${id}`, result);
        })));
        node_ipc_1.default.server.start();
    });
}
function handleBacnetRequest(data) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const { name, parameters } = data;
            const functionExists = BacnetUtilities_1.default[name] && typeof BacnetUtilities_1.default[name] === "function";
            if (!functionExists)
                throw new Error(`Bacnet utility function ${name} not found.`);
            const res = yield BacnetUtilities_1.default[name](...parameters);
            return { status: constants_1.REQUEST_RESPONSE_STATES.success, data: res };
        }
        catch (error) {
            return { status: constants_1.REQUEST_RESPONSE_STATES.error, error: error.message };
        }
    });
}
function serverIsRunning(port) {
    return new Promise((resolve, reject) => {
        const socket = new net_1.default.Socket();
        socket.once("connect", () => {
            socket.destroy();
            resolve(true);
        });
        socket.once("error", () => {
            socket.destroy();
            resolve(false);
        });
        socket.connect(port, "127.0.0.1");
    });
}
launchBacnetService().then((result) => __awaiter(void 0, void 0, void 0, function* () {
    yield launchBacnetService(); // Attempt to launch again to test if it detects the already running service
    console.log("Bacnet service launched successfully.");
})).catch((err) => {
    console.error(`Failed to launch Bacnet service: ${err}`);
});
//# sourceMappingURL=index.js.map