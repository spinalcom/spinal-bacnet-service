import { SpinalContext, SpinalGraph, SpinalNode } from "spinal-model-graph";
export interface IDataDiscover {
    network: SpinalNode;
    graph: SpinalGraph;
    organ: SpinalNode;
    context: SpinalContext;
}
