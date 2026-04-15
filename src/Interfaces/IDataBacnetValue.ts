import { NetworkService } from "spinal-model-bmsnetwork";
import { SpinalContext, SpinalNode, SpinalNodeRef } from "spinal-env-viewer-graph-service";
import { IDevice } from "./IDevice";

export interface IDataBacnetValue {
   context: SpinalContext;
   network?: SpinalNode;
   device: SpinalNode;
   organ: SpinalNode;
}
