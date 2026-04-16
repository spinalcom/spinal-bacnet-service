export interface IRequestArray {
   objectId: { type: string | number; instance: string | number };
   properties: Array<{ id: number | string }>
}

export interface IWriteRequest {
   address: string;
   SADR?: any;
   priority?: number;
   deviceId: number | string;
   objectId: {
      type: number | string;
      instance: number | string;
   };
   value: string | number | boolean;
   id: string | number;
}