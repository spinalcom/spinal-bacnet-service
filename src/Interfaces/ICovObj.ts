import { IObjectId } from "./IObjectId";

export interface ICovData {
	address: string;
	deviceId: string | number;
	children: IObjectId[];
	_clientId?: string;
	timestamp?: number;
}

export interface ICovSubscribeReq {
	ip: string;
	object: IObjectId;
}
