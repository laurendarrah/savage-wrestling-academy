export type FamilyProfile={parentName:string;phone:string;wrestlers:{id:string;name:string;grade:string;usawNumber?:string;usawExpires?:string}[]};
// USA Wrestling card (issue #68): optional on the profile, required to book. Number is letters, digits or dashes.
export const USAW_NUMBER=/^[A-Za-z0-9-]{4,24}$/;
const cardDate=(d:unknown)=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&new Date(d+'T12:00:00Z').toISOString().slice(0,10)===d;
const validCard=(w:any)=>(w.usawNumber===undefined||w.usawNumber===''||(typeof w.usawNumber==='string'&&USAW_NUMBER.test(w.usawNumber.trim())))&&(w.usawExpires===undefined||w.usawExpires===''||cardDate(w.usawExpires));
export const emptyFamily=():FamilyProfile=>({parentName:'',phone:'',wrestlers:[]});
export function validFamily(value:unknown):value is FamilyProfile{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const v=value as FamilyProfile;
 return typeof v.parentName==='string'&&v.parentName.length<=120&&typeof v.phone==='string'&&v.phone.length<=40&&Array.isArray(v.wrestlers)&&v.wrestlers.length<=20&&new Set(v.wrestlers.map(w=>w?.id)).size===v.wrestlers.length&&v.wrestlers.every(w=>w&&typeof w.id==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(w.id)&&typeof w.name==='string'&&w.name.trim().length>0&&w.name.length<=120&&typeof w.grade==='string'&&['K',...Array.from({length:12},(_,i)=>String(i+1)),'Adult'].includes(w.grade)&&validCard(w));
}
export function cleanFamily(value:FamilyProfile):FamilyProfile{return {parentName:value.parentName.trim(),phone:value.phone.trim(),wrestlers:value.wrestlers.map(w=>({id:w.id,name:w.name.trim(),grade:w.grade,usawNumber:(w.usawNumber||'').trim().toUpperCase(),usawExpires:w.usawExpires||''}))}}
