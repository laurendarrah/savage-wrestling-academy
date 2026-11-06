import {financialMonth} from './financials';
import {lessonFormatLabels,lessonSplit,type LessonFormat} from './private-lesson-pay';

export const privateLessonDuty='private_lesson';
export const privateLessonProgram='Private lesson';
export const coachDuties={head:4000,assistant:3000,[privateLessonDuty]:0} as const;
const dutyLabels={head:'Head coach',assistant:'Assistant coach',[privateLessonDuty]:'Private lesson'} as const;
export type Duty=keyof typeof coachDuties;
export const timePrograms=['Elementary','Intermediate','Advanced'] as const;
const programLabels={Elementary:'SWA Development',Intermediate:'SWA Intermediate',Advanced:'SWA Advance'};
export function dutyValid(duty:unknown):duty is Duty{return typeof duty==='string'&&Object.hasOwn(coachDuties,duty)}

export function timePeriod(month:string,period:string){
 if(!financialMonth(month)||!['full','first','second'].includes(period))return null;
 const [year,monthNumber]=month.split('-').map(Number);
 const lastDay=String(new Date(Date.UTC(year,monthNumber,0)).getUTCDate());
 return {from:month+(period==='second'?'-16':'-01'),through:month+'-'+(period==='first'?'15':lastDay)};
}
export function coachWorkDate(now:Date){
 return new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}

export type Shift={
 id:string;coach_name:string;coach_email:string;program:typeof timePrograms[number]|typeof privateLessonProgram;duty:Duty;work_date:string;
 started_at:string;ended_at:string|null;closed_at:string|null;
 approved_seconds:number|null;approved_duty:Duty|null;approved_rate_cents:number|null;approved_at:string|null;
 draft_seconds:number|null;draft_duty:Duty|null;draft_note:string|null;submitted_at:string|null;
 rate_cents:number;review_note:string|null;revision:number;practice_context?:string|null;
 lesson_format?:LessonFormat|null;lesson_gross_cents?:number|null;approved_lesson_gross_cents?:number|null;
};
export function recordedSeconds(row:Shift){
 return row.ended_at?Math.round((Date.parse(row.ended_at)-Date.parse(row.started_at))/1000):null;
}
export const shiftSeconds=(row:Shift)=>row.draft_seconds??recordedSeconds(row);
export const shiftDuty=(row:Shift)=>row.draft_duty??row.duty;
export const shiftRate=(row:Shift,duty:Duty)=>duty===row.duty?row.rate_cents:coachDuties[duty];
export const grossCents=(seconds:number,rate:number)=>Math.round(seconds*rate/3600);
export function shiftView(row:Shift){
 const seconds=row.approved_seconds??shiftSeconds(row);
 const rate=row.approved_rate_cents??shiftRate(row,shiftDuty(row));
 const lessonGross=row.approved_lesson_gross_cents??row.lesson_gross_cents??null;
 const split=row.lesson_format&&lessonGross!==null?lessonSplit(lessonGross):null;
 return {...row,programName:row.program===privateLessonProgram?privateLessonProgram:programLabels[row.program],seconds,
  rate:row.lesson_format?null:rate,gross:row.lesson_format?split?.coachCents??null:seconds===null?null:grossCents(seconds,rate),
  lessonFormatName:row.lesson_format?lessonFormatLabels[row.lesson_format]:null,lessonSplit:split};
}
function csvField(value:string|number){
 const raw=String(value);
 const safe=/^[\s\uFEFF]*[=+@-]|^[\t\r\n]/.test(raw)?"'"+raw:raw;
 return '"'+safe.replaceAll('"','""')+'"';
}
export function timeCsv(rows:Shift[]){
 const header=['Entry ID','Coach','Coach email','Work date (ET)','Program','Role','Recorded clock in (UTC)','Recorded clock out (UTC)','Approved seconds','Approved hours','Hourly rate (USD)','Estimated straight-time gross (USD)','Review note','Lesson format','Collected lesson revenue (USD)','SWA lesson share (USD)'];
 const lines=rows.map(row=>{
  const view=shiftView(row);
  return [row.id,row.coach_name,row.coach_email,row.work_date,view.programName,dutyLabels[row.approved_duty??row.duty],
   row.started_at,row.ended_at??'',view.seconds!, (view.seconds!/3600).toFixed(4), view.rate===null?'':(view.rate/100).toFixed(2),(view.gross!/100).toFixed(2),row.review_note??'',
   view.lessonFormatName??'',view.lessonSplit?(view.lessonSplit.grossCents/100).toFixed(2):'',view.lessonSplit?(view.lessonSplit.businessCents/100).toFixed(2):''];
 });
 return [header,...lines].map(line=>line.map(csvField).join(',')).join('\r\n')+'\r\n';
}
