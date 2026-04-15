export interface IRequestArray {
    objectId: {
        type: string | number;
        instance: string | number;
    };
    properties: Array<{
        id: number | string;
    }>;
}
