/*** 
 * Structure of response of readPropertyMultiple
*/


export interface IReadProperty {
      objectId: {
      type: string | number;
      instance: string | number};
      property?: {id: number|string; index: number};
      values : Array<{id: number|string;index : number; value: any}>

}

export interface IReadPropertyMultiple { 
   values : Array<IReadProperty>;
   [key: string] : any;
}