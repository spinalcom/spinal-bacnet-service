import { COV_EVENTS_NAMES } from "../utils/constants";
import { ICovData } from "./ICovObj";
export interface IBacnetRequest {
    name: string;
    id: string;
    parameters: any[];
}
export interface IBacnetResponse {
    status: "success" | "error";
    data?: any;
    error?: string;
}
export interface IBacnetCovRequest {
    name: keyof typeof COV_EVENTS_NAMES;
    id: string;
    parameters?: ICovData;
}
