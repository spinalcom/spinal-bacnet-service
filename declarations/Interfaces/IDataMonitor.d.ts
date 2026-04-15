import NetworkService from "spinal-model-bmsnetwork";
import { SpinalNode } from "spinal-model-graph";
export interface IDataMonitor {
    id: string;
    networkService?: NetworkService;
    network?: SpinalNode;
    profile?: SpinalNode;
}
