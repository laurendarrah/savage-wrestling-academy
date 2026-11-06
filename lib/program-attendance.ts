import {env} from 'cloudflare:workers';
import {registrationCatalog} from './registration-catalog';
import {programDetails} from './program-names';
import type {usaCardLabels} from './usa-card';
import {testWrestlerPrefix} from './test-family';

export const attendancePrograms=['Elementary','Intermediate','Advanced'];
const academyZone='America/New_York';
export const attendanceToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:academyZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function attendanceDate(date:unknown):date is string{
 if(typeof date!=='string'||!/^20\d\d-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(date))return false;
 const parsed=new Date(date);
 return Number.isFinite(+parsed)&&parsed.toISOString().slice(0,10)===date;
}
export type Practice={id:string;program:string;date:string;start:string;end:string;scheduled:boolean};
export type RosterPerson={userId:string;wrestlerId:string;name:string;kind:string;checkedAt:string|null;method:string|null;cardStatus:keyof typeof usaCardLabels|null};

export async function attendanceDay(date:string,test=false){
 if(test){
  const programs=attendancePrograms.map(id=>({id,name:programDetails[id].name}));
  return {programs,practices:programs.map(({id:program})=>({
   id:'test:'+program+':'+date+':18:00',program,date,start:'18:00',end:'19:00',scheduled:true
  }))};
 }
 const db=env.DB!;
 const [state,saved]=await db.batch([
  db.prepare("SELECT payload FROM academy_state WHERE id='academy'"),
  db.prepare(`SELECT program,practice_start AS start,practice_end AS end FROM program_enrollments
    WHERE kind='walkin' AND starts_on=? AND voided_at IS NULL
    UNION SELECT program,practice_start,practice_end FROM attendance_checkins WHERE date=? AND practice_id NOT LIKE 'test:%'`).bind(date,date)
 ]);
 const row=state.results[0] as {payload:string}|undefined;
 const catalog=registrationCatalog(row?JSON.parse(row.payload):{},date.slice(0,7),date);
 const programs=attendancePrograms.map(id=>({id,name:catalog.programs.find((p:{id:string})=>p.id===id)?.name||programDetails[id].name}));
 const practices=new Map<string,Practice>(catalog.practices.filter(p=>p.date===date).map(p=>[p.id,{...p,scheduled:true}]));
 for(const {program,start,end} of saved.results as {program:string;start:string;end:string}[]){
  const id=program+':'+date+':'+start;
  if(!practices.has(id))practices.set(id,{id,program,date,start,end,scheduled:false});
 }
 return {programs,practices:[...practices.values()].sort((a,b)=>a.start.localeCompare(b.start)||a.program.localeCompare(b.program))};
}

function nextLocalMidnight(date:string){
 const tomorrow=new Date(Date.parse(date)+86400000).toISOString().slice(0,10);
 const offset=new Intl.DateTimeFormat('en',{timeZone:academyZone,timeZoneName:'longOffset'})
  .formatToParts(new Date(tomorrow+'T00:00:00Z')).find(p=>p.type==='timeZoneName')!.value.slice(3);
 return new Date(tomorrow+'T00:00:00'+offset).toISOString();
}

export async function practiceRoster(practice:Practice,testUserId:string|null=null){
 const {program,date,start,id,scheduled}=practice;
 const rows=await env.DB!.prepare(`WITH eligible AS (
  SELECT user_id,wrestler_id,'membership' AS kind,2 AS priority FROM program_enrollments
   WHERE program=?1 AND voided_at IS NULL AND kind='membership' AND starts_on<=?2 AND ends_on>=?2 AND ?5=1
  UNION ALL SELECT user_id,wrestler_id,'walk-in',3 FROM program_enrollments
   WHERE program=?1 AND voided_at IS NULL AND kind='walkin' AND starts_on=?2 AND practice_start=?3
  UNION ALL SELECT user_id,wrestler_id,'scholarship',1 FROM scholarship_awards
   WHERE program=?1 AND status='active' AND accepted_at<?6 AND ?5=1
 ), grouped AS (
  SELECT user_id,wrestler_id,MIN(priority) AS priority FROM eligible
  WHERE (wrestler_id GLOB ?7)=CASE WHEN ?8 IS NULL THEN 0 ELSE 1 END AND (?8 IS NULL OR user_id=?8)
  GROUP BY user_id,wrestler_id
 ), roster AS (
  SELECT e.user_id,e.wrestler_id,json_extract(w.value,'$.name') AS name,
   CASE e.priority WHEN 1 THEN 'scholarship' WHEN 2 THEN 'membership' ELSE 'walk-in' END AS kind
  FROM grouped e JOIN family_accounts f ON f.user_id=e.user_id
   JOIN json_each(f.payload,'$.wrestlers') w ON json_extract(w.value,'$.id')=e.wrestler_id
 )
 SELECT r.user_id AS userId,r.wrestler_id AS wrestlerId,r.name,r.kind,c.checked_at AS checkedAt,c.method,
  CASE WHEN ?8 IS NOT NULL THEN NULL WHEN m.wrestler_id IS NULL THEN 'missing' WHEN m.expires_on<?2 THEN 'expired'
   WHEN m.verified_at IS NULL THEN 'pending' ELSE 'current' END AS cardStatus
 FROM roster r LEFT JOIN attendance_checkins c ON c.practice_id=?4 AND c.user_id=r.user_id AND c.wrestler_id=r.wrestler_id
 LEFT JOIN wrestler_membership_cards m ON m.user_id=r.user_id AND m.wrestler_id=r.wrestler_id
 UNION ALL SELECT c.user_id,c.wrestler_id,c.wrestler_name,'previous check-in',c.checked_at,c.method,NULL
 FROM attendance_checkins c WHERE c.practice_id=?4 AND NOT EXISTS
  (SELECT 1 FROM roster r WHERE r.user_id=c.user_id AND r.wrestler_id=c.wrestler_id)
 ORDER BY name COLLATE NOCASE`).bind(program,date,start,id,scheduled?1:0,nextLocalMidnight(date),testWrestlerPrefix+'*',testUserId).all<RosterPerson>();
 return rows.results;
}
