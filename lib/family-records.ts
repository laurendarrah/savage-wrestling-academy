export type FamilyProfile={parentName:string;phone:string;wrestlers:{id:string;name:string;grade:string}[]};
export const emptyFamily=():FamilyProfile=>({parentName:'',phone:'',wrestlers:[]});
export function validFamily(value:unknown):value is FamilyProfile{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const v=value as FamilyProfile;
 return typeof v.parentName==='string'&&v.parentName.length<=120&&typeof v.phone==='string'&&v.phone.length<=40&&Array.isArray(v.wrestlers)&&v.wrestlers.length<=20&&new Set(v.wrestlers.map(w=>w?.id)).size===v.wrestlers.length&&v.wrestlers.every(w=>w&&typeof w.id==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(w.id)&&typeof w.name==='string'&&w.name.trim().length>0&&w.name.length<=120&&typeof w.grade==='string'&&['K',...Array.from({length:12},(_,i)=>String(i+1)),'Adult'].includes(w.grade));
}
export function cleanFamily(value:FamilyProfile):FamilyProfile{return {parentName:value.parentName.trim(),phone:value.phone.trim(),wrestlers:value.wrestlers.map(w=>({id:w.id,name:w.name.trim(),grade:w.grade}))}}
