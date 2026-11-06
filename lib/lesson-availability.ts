import {env} from 'cloudflare:workers';
import {OWNER_EMAIL} from './account-auth';
import {academyToday} from './public-schedule';
export const validMonth=(v:string)=>/^\d{4}-(0[1-9]|1[0-2])$/.test(v);
export function academyClock(){const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());return parts.find(p=>p.type==='hour')!.value+':'+parts.find(p=>p.type==='minute')!.value}
export async function availableLessons(month:string){
 const today=academyToday(),time=academyClock();
 const rows=await env.DB!.prepare(`SELECT o.id,o.date,o.start,o.end,p.payload,p.email FROM coach_openings o JOIN coach_profiles p ON p.user_id=o.user_id LEFT JOIN staff_access s ON s.email=p.email WHERE (p.email=? OR s.active=1) AND substr(o.date,1,7)=? AND (o.date>? OR (o.date=? AND o.start>?)) ORDER BY o.date,o.start,o.id LIMIT 501`).bind(OWNER_EMAIL,month,today,today,time).all<{id:string;date:string;start:string;end:string;payload:string;email:string}>();
 // Only an opaque coach key, display name and available times are sent to families. No contact fields, bio or photo.
 const results=[];for(const r of rows.results.slice(0,500)){const bytes=new TextEncoder().encode(r.email);const key=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('').slice(0,24);results.push({id:r.id,coachId:key,coachName:String(JSON.parse(r.payload).name),date:r.date,start:r.start,end:r.end})}return {openings:results,truncated:rows.results.length>500};
}
export async function availableLesson(id:string){
 const row=await env.DB!.prepare('SELECT date FROM coach_openings WHERE id=?').bind(id).first<{date:string}>();if(!row)return null;return (await availableLessons(row.date.slice(0,7))).openings.find(o=>o.id===id)||null;
}

const openingDate=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&
 Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const openingTime=(value:unknown):value is string=>typeof value==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const minutes=(time:string)=>Number(time.slice(0,2))*60+Number(time.slice(3));
const weekMs=7*86400000;

export async function addLessonOpenings(input:{date?:unknown;start?:unknown;end?:unknown;repeatUntil?:unknown},
 coach:{email:string;userId:string},requireSavedProfile=false){
 const {date,start,end,repeatUntil}=input;
 if(!openingDate(date)||date<academyToday()||!openingTime(start)||!openingTime(end)){
  return {status:400,body:{error:'Choose an upcoming date and valid start and end times.'}};
 }
 if(minutes(end)-minutes(start)!==60)return {status:400,body:{error:'Each opening must be exactly one hour.'}};
 const first=Date.parse(date);
 let through=first;
 if(repeatUntil!==undefined&&repeatUntil!==null&&repeatUntil!==''){
  if(!openingDate(repeatUntil)||Date.parse(repeatUntil)-first<weekMs||Date.parse(repeatUntil)-first>=52*weekMs){
   return {status:400,body:{error:'Choose a repeat end date at least one week after the first opening and less than 52 weeks later.'}};
  }
  through=Date.parse(repeatUntil);
 }
 const requested=[];
 for(let stamp=first;stamp<=through;stamp+=weekMs)requested.push({id:crypto.randomUUID(),date:new Date(stamp).toISOString().slice(0,10)});
 // All weekly dates are inserted together, so a collision cannot leave a partially published series.
 const {results}=await env.DB!.prepare(`WITH requested AS (
  SELECT json_extract(value,'$.id') AS id,json_extract(value,'$.date') AS date FROM json_each(?)
 )
 INSERT INTO coach_openings(id,user_id,date,start,end)
 SELECT r.id,?,r.date,?,? FROM requested r
 WHERE NOT EXISTS (
  SELECT 1 FROM coach_openings o JOIN requested q ON q.date=o.date WHERE o.user_id=? AND o.start<? AND o.end>?
 ) AND (? OR EXISTS(SELECT 1 FROM staff_access WHERE email=? AND active=1))
 AND (? OR EXISTS(SELECT 1 FROM coach_profiles WHERE email=? AND user_id=?))
 RETURNING id`).bind(JSON.stringify(requested),coach.userId,start,end,coach.userId,end,start,
  coach.email===OWNER_EMAIL?1:0,coach.email,requireSavedProfile?0:1,coach.email,coach.userId).all<{id:string}>();
 if(!results.length)return {status:409,body:{error:'One or more dates overlap a saved opening, or the coach is no longer available. No dates were added.'}};
 return {status:200,body:{ok:true,id:requested[0].id,count:results.length}};
}
