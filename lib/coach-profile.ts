export type CoachProfile={name:string;phone:string;bio:string;experience:string;specialties:string};
export const emptyCoachProfile=(name=''):CoachProfile=>({name,phone:'',bio:'',experience:'',specialties:''});
export function cleanCoachProfile(value:unknown):CoachProfile|null {
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const v=value as Record<string,unknown>;
 const limits={name:100,phone:40,bio:3000,experience:1500,specialties:500};
 for(const [key,max] of Object.entries(limits))if(typeof v[key]!=='string'||(v[key] as string).length>max)return null;
 if(!(v.name as string).trim()||!(v.bio as string).trim()||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(Object.keys(limits).map(k=>v[k]).join('')))return null;
 return Object.fromEntries(Object.keys(limits).map(k=>[k,(v[k] as string).trim()])) as CoachProfile;
}
export function rasterType(b:Uint8Array):string|null{
 if(b.length<12)return null;
 if(b[0]===255&&b[1]===216&&b[2]===255)return 'image/jpeg';
 if([137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v))return 'image/png';
 if(String.fromCharCode(...b.slice(0,4))==='RIFF'&&String.fromCharCode(...b.slice(8,12))==='WEBP')return 'image/webp';
 return null;
}
export async function boundedBody(request:Request,limit:number):Promise<Uint8Array|null>{
 if(Number(request.headers.get('content-length'))>limit)return null;
 const reader=request.body?.getReader();if(!reader)return new Uint8Array();
 const chunks:Uint8Array[]=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();return null}chunks.push(value)}
 const result=new Uint8Array(size);let offset=0;for(const c of chunks){result.set(c,offset);offset+=c.length}return result;
}
