import {coachWorkDate,recordedSeconds,shiftSeconds,type Shift} from './coach-time';
import {fridayLiveSchedule} from './friday-live';
import {registrationCatalog} from './registration-catalog';

const minute=60000;
const easternOffset=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',timeZoneName:'longOffset'});

function easternTime(date:string,time:string){
 const local=date+'T'+time+':00';
 const guess=new Date(local+'Z');
 const offset=(at:Date)=>easternOffset.formatToParts(at).find(p=>p.type==='timeZoneName')!.value.slice(3);
 const corrected=new Date(local+offset(guess));
 return Date.parse(local+offset(corrected));
}

type PracticeTime={name:string;start:number;end:number};
type PracticeContext={practice:PracticeTime|null;next:PracticeTime|null;bufferMinutes?:number};

export function coachPracticeContext(settings:unknown,now:Date,program:string,assigned:string[]):PracticeContext{
 const today=coachWorkDate(now),midnight=Date.parse(today);
 const dates=[-1,0,1].map(day=>new Date(midnight+day*86400000).toISOString().slice(0,10));
 const months=[...new Set(dates.map(date=>date.slice(0,7)))];
 const sessions=months.flatMap(month=>{
  const schedule=registrationCatalog(settings,month,'0000-01-01');
  return [
   ...schedule.practices.map(p=>({...p,name:schedule.programs.find((g:{id:string;name:string})=>g.id===p.program)?.name??p.program})),
   ...fridayLiveSchedule(settings,month,'0000-01-01').map(p=>({...p,program:null}))
  ];
 }).filter(p=>dates.includes(p.date)).map(p=>({...p,start:easternTime(p.date,p.start),end:easternTime(p.date,p.end)}));
 const candidates=sessions.filter(p=>(p.program===program||p.program===null)&&
  (p.date===today||(+now>=p.start&&+now<=p.end)));
 const distance=(p:PracticeTime)=>Math.max(p.start-+now,+now-p.end,0);
 const practice=candidates.sort((a,b)=>distance(a)-distance(b)||Number(b.program===program)-Number(a.program===program)||a.start-b.start)[0];
 if(!practice)return {practice:null,next:null,bufferMinutes:0};
 const next=sessions.filter(p=>(p.program===null||assigned.includes(p.program))&&
  p.start>=practice.end&&p.start-practice.end<=15*minute).sort((a,b)=>a.start-b.start)[0];
 const snapshot=({name,start,end}:PracticeTime)=>({name,start,end});
 return {practice:snapshot(practice),next:next?snapshot(next):null,bufferMinutes:0};
}

export function practiceTimeReview(row:Shift){
 if(!row.practice_context)return null;
 const {practice,next,bufferMinutes=10}=JSON.parse(row.practice_context) as PracticeContext;
 if(!practice)return {limitMinutes:null,reasons:['No published practice matched this program and date.']};
 const buffer=bufferMinutes*minute,limitMinutes=(practice.end-practice.start)/minute+2*bufferMinutes;
 const threshold=bufferMinutes?` more than ${bufferMinutes} minutes`:'';
 const reasons:string[]=[];
 const started=Date.parse(row.started_at),ended=row.ended_at?Date.parse(row.ended_at):null;
 if(started<practice.start-buffer)reasons.push('Clocked in'+threshold+' before '+practice.name+' started.');
 if(started>practice.end+buffer)reasons.push('Clocked in'+threshold+' after '+practice.name+' ended.');
 if(ended!==null&&ended>practice.end+buffer)reasons.push('Clocked out'+threshold+' after '+practice.name+' ended.');
 if(Math.max(recordedSeconds(row)??0,shiftSeconds(row)??0,row.approved_seconds??0)>limitMinutes*60){
  reasons.push(bufferMinutes?'Hours exceed the '+limitMinutes+'-minute window for one practice.':'Hours exceed the '+limitMinutes+' scheduled minutes for one practice.');
 }
 if(reasons.length&&next&&ended!==null&&started<practice.end&&ended>=next.start){
  reasons.push('Possible back-to-back coverage with '+next.name+'. Verify the continuous shift.');
 }
 return {limitMinutes,reasons};
}
