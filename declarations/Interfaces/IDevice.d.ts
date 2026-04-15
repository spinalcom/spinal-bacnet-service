export interface IDevice {
    address?: string;
    deviceId: number;
    maxApdu?: number;
    segmentation?: number;
    vendorId?: number;
    name?: string;
    id?: string | number;
    typeId?: string;
    type?: string;
    description?: string;
    SADR: string;
}
