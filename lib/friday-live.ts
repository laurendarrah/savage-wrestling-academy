export function validOfferingDetails(v:any){return (v.gradeRange===undefined||typeof v.gradeRange==='string'&&v.gradeRange.length<=80)&&(v.description===undefined||typeof v.description==='string'&&v.description.length<=2000)}
export type ExtraPractice={id:string;name:string;gradeRange?:string;description?:string;dates:string[];start:string;end:string;memberCents:number;nonMemberCents:number;enabled:boolean};
const realDate=(d:any):d is string=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d+'T12:00:00Z').toISOString().slice(0,10)===d;
export function validExtraPractices(list:any):list is ExtraPractice[]{
 const time=(t:any)=>typeof t==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(t),price=(n:any)=>Number.isInteger(n)&&n>=0&&n<=1000000;
 return Array.isArray(list)&&list.length<=500&&new Set(list.map(p=>p?.id)).size===list.length&&list.every(p=>p&&typeof p==='object'&&typeof p.id==='string'&&/^[A-Za-z0-9-]{1,80}$/.test(p.id)&&typeof p.name==='string'&&p.name.trim().length>0&&p.name.length<=120&&validOfferingDetails(p)&&typeof p.enabled==='boolean'&&time(p.start)&&time(p.end)&&p.start<p.end&&price(p.memberCents)&&price(p.nonMemberCents)&&Array.isArray(p.dates)&&p.dates.length>0&&p.dates.length<=366&&new Set(p.dates).size===p.dates.length&&p.dates.every(realDate));
}
// Keep prior semester settings in the record, but offer only explicitly selected dates.
export function withFridayLive(state:any){return state&&typeof state==='object'?{...state,extraPractices:state.extraPractices??[]}:state}
export function fridayLiveSchedule(state:any,month:string,today:string){
 const list=state?.extraPractices??[];if(!validExtraPractices(list))return [];
 return list.filter(p=>p.enabled).flatMap(p=>p.dates.filter(date=>date>=today&&date.slice(0,7)===month).map(date=>({id:p.id,name:p.name,gradeRange:p.gradeRange,description:p.description,date,start:p.start,end:p.end,memberCents:p.memberCents,nonMemberCents:p.nonMemberCents,includedInMembership:false}))).sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start)||a.id.localeCompare(b.id));
}
