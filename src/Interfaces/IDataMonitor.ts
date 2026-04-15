// import { SpinalListenerModel } from "spinal-model-bacnet";
import NetworkService from "spinal-model-bmsnetwork";
import { SpinalNode } from "spinal-model-graph";
// import { SpinalDevice } from "../modules/SpinalDevice";


export interface IDataMonitor {
   id: string;
   // spinalModel?: SpinalListenerModel;
   // spinalDevice?: SpinalDevice;
   networkService?: NetworkService;
   network?: SpinalNode,
   profile?: SpinalNode
}