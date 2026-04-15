import { IObjectId } from "./IObjectId";
export interface ICovData {
    children: IObjectId[];
}
export interface ICovSubscribeReq {
    ip: string;
    object: IObjectId;
}
