import { SpinalNode } from "spinal-env-viewer-graph-service";
import NetworkService from "spinal-model-bmsnetwork";
// import { SpinalDevice } from "../modules/SpinalDevice";
import { IObjectId } from "./IObjectId";

export interface ICovData {
    // spinalDevice: SpinalDevice;
    // networkService: NetworkService;
    // spinalModel: SpinalListenerModel;
    // network: SpinalNode;
    deviceId: string | number;
    children: IObjectId[];
}


export interface ICovSubscribeReq {
    ip: string;
    object: IObjectId;
}