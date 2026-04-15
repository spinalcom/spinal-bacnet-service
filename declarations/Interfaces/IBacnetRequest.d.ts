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
