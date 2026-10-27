export interface IDiscoverDevicesOptions {
    mode?: "broadcast" | "unicast";
    port?: number;
    interface?: string;
    broadcastAddress?: string;
    apduTimeout?: number;
    ips?: {
        id: number | string;
        process: "unicast" | "bbmd";
        address: string;
        deviceId?: string | number;
    }[];
}
