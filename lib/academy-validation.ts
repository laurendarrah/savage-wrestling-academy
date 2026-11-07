import {validEventSchedule} from './event-schedule';
import {validExtraPractices,validOfferingDetails} from './friday-live';
export function validTeamCodes(codes:any):boolean{
 return Array.isArray(codes)&&codes.length<=200&&new Set(codes.map((c:any)=>c?.code)).size===codes.length&&new Set(codes.map((c:any)=>c?.id)).size===codes.length&&codes.every((c:any)=>c&&typeof c==='object'&&typeof c.id==='string'&&/^[A-Za-z0-9-]{1,80}$/.test(c.id)&&typeof c.code==='string'&&/^[A-Z0-9][A-Z0-9-]{2,31}$/.test(c.code)&&typeof c.name==='string'&&c.name.trim().length>0&&c.name.length<=80&&Number.isInteger(c.percent)&&c.percent>=1&&c.percent<=100&&typeof c.active==='boolean'&&Array.isArray(c.programs)&&c.programs.length>=1&&c.programs.length<=3&&new Set(c.programs).size===c.programs.length&&c.programs.every((id:unknown)=>['Elementary','Intermediate','Advanced'].includes(id as string)));
}
export function teamCodeDiscount(codes:unknown,raw:unknown,program:string,plan:string,base:number|null):{error:string}|{cents:number|null;discount:null|{code:string;name:string;percent:number;cents:number|null}}{
 if(raw===undefined||raw===null||raw==='')return {cents:base,discount:null};
 if(typeof raw!=='string'||raw.length>64)return {error:'Enter a valid team code.'};const code=raw.trim().toUpperCase();if(!code)return {cents:base,discount:null};
 if(plan!=='monthly')return {error:'Team codes apply to the 12-month installment plan only. Choose that plan to use a team code.'};
 if(!validTeamCodes(codes))return {error:'This team code is unavailable.'};
 const found=(codes as any[]).find(c=>c.code===code&&c.active);if(!found||!found.programs.includes(program))return {error:'This team code is inactive, invalid, or unavailable for the selected program.'};
 const amount=base===null?null:Math.round(base*found.percent/100);return {cents:base===null?null:base-(amount??0),discount:{code,name:found.name,percent:found.percent,cents:amount}};
}
export function validState(d: any): boolean {
 if (!d || typeof d !== "object" || Array.isArray(d)) return false;
 if(d.extraPractices!==undefined&&!validExtraPractices(d.extraPractices))return false;
 for(const key of ["kids","bookings","messages","offers","seasons","staff"]) if(!Array.isArray(d[key]) || d[key].length>10000) return false;
 if(!d.attendance || typeof d.attendance !== "object" || !d.settings || typeof d.settings !== "object") return false;
 if(d.programs && (!Array.isArray(d.programs) || d.programs.length !== 3 || d.programs.some((p:any,i:number)=>!p || typeof p !== "object" || p.id !== ["Elementary","Intermediate","Advanced"][i] || typeof p.name !== "string" || !p.name.trim() || p.name.length>100 || typeof p.description !== "string" || p.description.length>2000 || !Number.isInteger(p.priceCents) || p.priceCents<0 || p.priceCents>1000000))) return false;
 if(d.programs?.some((p:any)=>p.walkInPriceCents!==undefined&&(!Number.isInteger(p.walkInPriceCents)||p.walkInPriceCents<0||p.walkInPriceCents>1000000))) return false;
 if(d.teamCodes!==undefined&&!validTeamCodes(d.teamCodes))return false;
 if(d.messages.some((m:any)=>!m||typeof m!=='object'||(m.archived!==undefined&&typeof m.archived!=='boolean')))return false;
 if(d.events!==undefined){
 if(!Array.isArray(d.events)||d.events.length>1000)return false;
 const ids=d.events.filter((e:any)=>e?.id!==undefined).map((e:any)=>e.id);if(new Set(ids).size!==ids.length)return false;
 const realDate=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
 const money=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=10000&&Math.abs(v*100-Math.round(v*100))<0.000001;
 for(const e of d.events){
 if(!e||typeof e!=='object'||(e.archived!==undefined&&typeof e.archived!=='boolean')||typeof e.name!=='string'||!e.name.trim()||e.name.length>120||!validOfferingDetails(e)||!['Camp','Clinic','Event'].includes(e.type)||!money(e.price)||!Number.isInteger(e.slots)||e.slots<0||e.slots>100000||(e.day!=null&&!money(e.day))||(e.id!==undefined&&(typeof e.id!=='string'||!/^[A-Za-z0-9-]{1,80}$/.test(e.id))))return false;
 // Retain older owner-created events so their dates can be edited in the new form.
 if(e.dates!==undefined){if(!Array.isArray(e.dates)||e.dates.length<(e.type==='Camp'?2:1)||e.dates.length>(e.type==='Camp'?366:1)||new Set(e.dates).size!==e.dates.length||e.dates.some((v:unknown)=>!realDate(v)))return false;}
 else if(typeof e.date!=='string'||e.date.length>10000)return false;
 // Times for each day (issue #189) are optional: events saved without them, and older backups, stay valid.
 if(e.schedule!==undefined&&(e.dates===undefined||!validEventSchedule(e.dates,e.schedule)))return false;
 }
 }
 for(const s of d.seasons) {
 if(!s || typeof s !== "object") return false;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(s.start) || !/^\d{4}-\d{2}-\d{2}$/.test(s.end) || s.start>s.end || !["Elementary","Intermediate","Advanced"].includes(s.program)) return false;
 if(!Array.isArray(s.weekly) || s.weekly.length<1 || s.weekly.length>7 || s.weekly.some((w:any)=>!w || typeof w !== "object" || !["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"].includes(w.day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(w.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(w.end) || w.start>=w.end)) return false;
 }
 return true;
}
