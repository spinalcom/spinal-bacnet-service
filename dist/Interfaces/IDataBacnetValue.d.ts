import { SpinalContext, SpinalNode } from "spinal-env-viewer-graph-service";
export interface IDataBacnetValue {
    context: SpinalContext;
    network?: SpinalNode;
    device: SpinalNode;
    organ: SpinalNode;
}
