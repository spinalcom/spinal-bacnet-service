import { IObjectId } from "./IObjectId";
export interface ICovData {
    deviceId: string | number;
    children: IObjectId[];
}
export interface ICovSubscribeReq {
    ip: string;
    object: IObjectId;
}
