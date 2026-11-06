import {env} from 'cloudflare:workers';
import {accountReply,sameOrigin,strongAccount} from '../../../lib/account-auth';
import {accountRole} from '../../../lib/access-control';
import {boundedBody} from '../../../lib/coach-profile';
import {coachDuties,coachWorkDate,dutyValid,privateLessonDuty,privateLessonProgram,recordedSeconds,shiftDuty,shiftRate,shiftSeconds,shiftView,timeCsv,timePeriod,timePrograms,type Shift} from '../../../lib/coach-time';

import {lessonAmountValid,lessonFormatValid} from '../../../lib/private-lesson-pay';
import {coachPracticeContext,practiceTimeReview} from '../../../lib/coach-practice-time';

export const dynamic='force-dynamic';
const validShiftId=(id:unknown):id is string=>typeof id==='string'&&/^[0-9a-f-]{36}$/i.test(id);
const validRevision=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=1;
const activeCoach='(? OR EXISTS (SELECT 1 FROM staff_access WHERE email=? AND active=1))';
const fields='id,coach_name,coach_email,program,duty,work_date,started_at,ended_at,closed_at,approved_seconds,approved_duty,approved_rate_cents,approved_at,rate_cents,review_note,draft_seconds,draft_duty,draft_note,submitted_at,revision,practice_context,lesson_format,lesson_gross_cents,approved_lesson_gross_cents';
function timeView(row:Shift){
 const {practice_context,...view}=shiftView(row);
 return {...view,practiceReview:practiceTimeReview(row)};
}

async function identity(request:Request){
 const auth=await strongAccount(request);
 const access=await accountRole(auth.user);
 return {auth,access,owner:access.role==='owner',allowed:auth.strong&&(access.role==='owner'||access.role==='coach')};
}

export async function GET(request:Request){
 const {auth,access,owner,allowed}=await identity(request);
 const reply=(body:unknown,status=200)=>accountReply(body,status,auth.headers);
 const query=new URL(request.url).searchParams,review=query.get('review')==='1',download=query.get('format')==='csv';
 if(!allowed||((review||download)&&!owner))return reply({error:'Verified coach or owner access is required for this view.'},403);
 const today=coachWorkDate(new Date());
 const month=query.get('month')??today.slice(0,7);
 const period=query.get('period')??'full',range=timePeriod(month,period);
 if(!range)return reply({error:'Choose a valid pay period.'},400);
 const db=env.DB!,userId=auth.user!.id;
 const coachEmail=download?(query.get('coach')??'').trim().toLowerCase():'';
 if(coachEmail&&(coachEmail.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(coachEmail)))return reply({error:'Choose a valid coach for this export.'},400);
 const ownerView=review||download;
 const scope=coachEmail?' AND coach_email=?':ownerView?'':' AND user_id=?';
 const rows=db.prepare(`SELECT ${fields} FROM coach_time_entries WHERE work_date BETWEEN ? AND ? AND voided_at IS NULL${scope}${download?' AND approved_at IS NOT NULL':''} ORDER BY work_date,started_at,id LIMIT 1001`)
  .bind(range.from,range.through,...(coachEmail?[coachEmail]:ownerView?[]:[userId]));
 const results=(await rows.all<Shift>()).results;
 if(results.length>1000)return reply({error:'This view has more than 1,000 shifts. Choose a shorter period.'},409);
 if(download){
  auth.headers.set('Content-Type','text/csv; charset=utf-8');
  auth.headers.set('Content-Disposition',`attachment; filename="swa-approved-coach-hours-${month}-${period}.csv"`);
  return new Response('\uFEFF'+timeCsv(results),{headers:auth.headers});
 }
 if(review){
  const coaches=await db.prepare('SELECT email,name FROM staff_access WHERE active=1 ORDER BY name,email').all<{email:string;name:string}>();
  return reply({rows:results.map(timeView),coaches:coaches.results});
 }
 const active=await db.prepare(`SELECT ${fields} FROM coach_time_entries WHERE user_id=? AND closed_at IS NULL AND voided_at IS NULL`).bind(userId).first<Shift>();
 const submissionOpens=timePeriod(month,'full')!.through;
 return reply({rows:results.map(timeView),active:active?timeView(active):null,submissionOpens,
  canSubmit:period==='full'&&today>=submissionOpens,
  programs:owner?timePrograms:(access.staff?.programs??[]).filter(p=>timePrograms.some(id=>id===p))});
}

export async function POST(request:Request){
 const {auth,access,owner,allowed}=await identity(request);
 const reply=(body:unknown,status=200)=>accountReply(body,status,auth.headers);
 if(!allowed)return reply({error:'Coach access and authenticator verification are required.'},403);
 if(!sameOrigin(request))return reply({error:'Invalid request origin.'},403);
 if(!request.headers.get('content-type')?.includes('application/json'))return reply({error:'JSON required.'},415);
 const bytes=await boundedBody(request,75000);
 if(!bytes)return reply({error:'Request too large.'},413);
 let input;try{input=JSON.parse(new TextDecoder().decode(bytes))}catch{return reply({error:'Invalid request.'},400)}
 const user=auth.user!,email=user.email!.toLowerCase(),db=env.DB!,now=new Date(),stamp=now.toISOString();
 if(input?.action==='start'){
  const duty=input.duty,lesson=duty===privateLessonDuty,program=lesson?privateLessonProgram:input.program;
  if(!dutyValid(duty)||!lesson&&(!timePrograms.some(id=>id===program)||(!owner&&!access.staff?.programs.includes(program))))return reply({error:'Choose an assigned program and coaching role.'},400);
  if(lesson&&!lessonFormatValid(input.lessonFormat))return reply({error:'Choose a private lesson format.'},400);
  const profile=await db.prepare("SELECT json_extract(payload,'$.name') AS name FROM coach_profiles WHERE email=?").bind(email).first<{name:string}>();
  const settings=lesson?null:await db.prepare("SELECT payload FROM academy_state WHERE id='academy'").first<{payload:string}>();
  const context=lesson?null:coachPracticeContext(settings?JSON.parse(settings.payload):{},now,program,owner?[...timePrograms]:access.staff!.programs);
  const saved=await db.prepare(`INSERT INTO coach_time_entries(id,user_id,coach_name,coach_email,program,duty,work_date,started_at,rate_cents,practice_context,lesson_format)
   SELECT ?,?,?,?,?,?,?,?,?,?,?
   WHERE ${activeCoach} ON CONFLICT DO NOTHING RETURNING id`)
   .bind(crypto.randomUUID(),user.id,profile?.name||access.staff?.name||(owner?'Academy owner':email),email,program,duty,coachWorkDate(now),stamp,coachDuties[duty],context?JSON.stringify(context):null,lesson?input.lessonFormat:null,owner?1:0,email).first();
  return saved?reply({ok:true}):reply({error:'You already have an open shift or your access changed. Refresh and check your clock-in.'},409);
 }
 if(input?.action==='submit'){
  if(input.period!==undefined&&input.period!=='full')return reply({error:'Submit hours for the full month.'},400);
  const range=typeof input.month==='string'?timePeriod(input.month,'full'):null;
  const shifts=input.shifts;
  if(!range||!Array.isArray(shifts)||!shifts.length||shifts.length>1000||
   shifts.some(row=>!validShiftId(row?.id)||!validRevision(row?.revision))||new Set(shifts.map(row=>row.id)).size!==shifts.length){
   return reply({error:'Choose a month with completed drafts.'},400);
  }
  if(coachWorkDate(now)<range.through)return reply({error:'Timesheet submission opens on the last day of the month (Eastern time).'},409);
  const [saved]=await db.batch([
   db.prepare(`WITH selected AS (
    SELECT json_extract(value,'$.id') AS id,json_extract(value,'$.revision') AS revision FROM json_each(?)
   ), drafts AS MATERIALIZED (
    SELECT id,revision,draft_seconds,ended_at,started_at FROM coach_time_entries
    WHERE user_id=? AND work_date BETWEEN ? AND ? AND ended_at IS NOT NULL AND submitted_at IS NULL
      AND approved_at IS NULL AND voided_at IS NULL
   ), ready AS MATERIALIZED (
    SELECT e.id FROM drafts e JOIN selected s ON e.id=s.id AND e.revision=s.revision
    WHERE COALESCE(e.draft_seconds,ROUND((julianday(e.ended_at)-julianday(e.started_at))*86400)) BETWEEN 1 AND 86400
   )
   UPDATE coach_time_entries SET submitted_at=?,revision=revision+1
    WHERE (SELECT count(*) FROM ready)=(SELECT count(*) FROM drafts)
      AND (SELECT count(*) FROM ready)=? AND id IN (SELECT id FROM ready) AND ${activeCoach} RETURNING id`)
    .bind(JSON.stringify(shifts.map(({id,revision})=>({id,revision}))),user.id,range.from,range.through,stamp,shifts.length,owner?1:0,email),
   db.prepare(`INSERT INTO security_events(id,actor,action,target,created_at) SELECT ?,?,'coach_timesheet_submitted',?,? WHERE changes()>0`)
    .bind(crypto.randomUUID(),user.id,input.month+':full',stamp)
  ]);
  return saved.results.length?reply({ok:true}):reply({error:'A draft changed or needs a time correction. Refresh before submitting.'},409);
 }
 if(!validShiftId(input?.id)||!validRevision(input.revision))return reply({error:'Choose a current shift.'},400);
 const {id,revision}=input;
 if(input.action==='end'){
  const saved=await db.prepare(`UPDATE coach_time_entries SET ended_at=?,closed_at=?,revision=revision+1
   WHERE id=? AND user_id=? AND revision=? AND closed_at IS NULL AND started_at<? AND ${activeCoach} RETURNING id`)
   .bind(stamp,stamp,id,user.id,revision,stamp,owner?1:0,email).first();
  return saved?reply({ok:true}):reply({error:'This shift changed or was already closed. Refresh your timesheet.'},409);
 }
 if(input.action==='edit-draft'||input.action==='pull-back'){
  const edit=input.action==='edit-draft';
  const row=await db.prepare(`SELECT ${fields} FROM coach_time_entries WHERE id=? AND user_id=? AND revision=?
   AND approved_at IS NULL AND voided_at IS NULL AND ended_at IS NOT NULL`).bind(id,user.id,revision).first<Shift>();
  if(!row||edit===!!row.submitted_at)return reply({error:'This shift is no longer available to change. Refresh your timesheet.'},409);
  const actual=recordedSeconds(row),duty=input.duty,note=typeof input.note==='string'?input.note.trim():'';
  const seconds=input.minutes==null?null:Number.isInteger(input.minutes)?input.minutes*60:NaN;
  if(edit&&(duty===privateLessonDuty)!==(row.duty===privateLessonDuty)){
   return reply({error:'Private lessons and practices are separate work types. Correct the time within the recorded work type.'},400);
  }
  if(edit&&(!dutyValid(duty)||(seconds!==null&&(!Number.isFinite(seconds)||seconds<60||seconds>86400))||
   (seconds===null&&(actual===null||actual<1||actual>86400))||note.length>300||
   ((seconds!==null&&seconds!==actual||duty!==row.duty)&&!note))){
   return reply({error:'Enter 1–1,440 worked minutes and a reason when correcting the recorded time or role.'},400);
  }
  const lessonGross=input.lessonGrossCents===undefined?row.lesson_gross_cents??null:input.lessonGrossCents;
  if(edit&&lessonGross!==null&&(!row.lesson_format||!lessonAmountValid(lessonGross)))return reply({error:'Enter valid collected lesson revenue.'},400);
  const change=edit?'draft_seconds=?,draft_duty=?,draft_note=?,lesson_gross_cents=?':'submitted_at=NULL';
  const [saved]=await db.batch([
   db.prepare(`UPDATE coach_time_entries SET ${change},revision=revision+1
    WHERE id=? AND user_id=? AND revision=? AND approved_at IS NULL AND voided_at IS NULL
     AND ended_at IS NOT NULL AND submitted_at IS ${edit?'NULL':'NOT NULL'} AND ${activeCoach} RETURNING id`)
    .bind(...(edit?[seconds,duty===row.duty?null:duty,note||null,lessonGross]:[]),id,user.id,revision,owner?1:0,email),
   db.prepare('INSERT INTO security_events(id,actor,action,target,created_at) SELECT ?,?,?,?,? WHERE changes()=1')
    .bind(crypto.randomUUID(),user.id,edit?'coach_shift_draft_edited':'coach_shift_pulled_back',id,stamp)
  ]);
  return saved.results.length?reply({ok:true}):reply({error:'This shift changed. Refresh before continuing.'},409);
 }
 if(!owner)return reply({error:'Only the owner can manage timesheet shifts.'},403);
 const approving=input.action==='approve',deleting=input.action==='delete';
 if(!approving&&!deleting&&input.action!=='reopen')return reply({error:'Choose a shift action.'},400);
 if(deleting&&input.confirmed!==true)return reply({error:'Confirm which shift to delete.'},400);
 const row=await db.prepare(`SELECT ${fields} FROM coach_time_entries WHERE id=? AND revision=? AND voided_at IS NULL`).bind(id,revision).first<Shift>();
 if(!row)return reply({error:'The shift changed. Refresh before reviewing.'},409);
 if(!deleting&&approving===!!row.approved_at)return reply({error:'This shift already has that review status. Refresh to continue.'},409);
 let write;
 if(deleting){
  write=db.prepare(`UPDATE coach_time_entries SET voided_at=?,closed_at=COALESCE(closed_at,?),revision=revision+1
   WHERE id=? AND revision=? AND voided_at IS NULL RETURNING id`).bind(stamp,stamp,id,revision);
 }else if(approving){
  if(row.ended_at&&!row.submitted_at)return reply({error:'This shift is still a draft. The coach must submit it first.'},409);
  const actual=shiftSeconds(row),seconds=input.minutes==null?actual:Number.isInteger(input.minutes)?input.minutes*60:null;
  const previousDuty=shiftDuty(row),duty=input.duty??previousDuty,note=typeof input.note==='string'?input.note.trim():'';
  if((duty===privateLessonDuty)!==(row.duty===privateLessonDuty))return reply({error:'Review this shift under its recorded work type.'},400);
  if(seconds===null||seconds<1||seconds>86400||!dutyValid(duty)||note.length>300)return reply({error:'Enter a valid role and actual worked time between one minute and 24 hours when correcting a shift.'},400);
  const lessonGross=input.lessonGrossCents===undefined?row.lesson_gross_cents??null:input.lessonGrossCents;
  if(row.lesson_format?!lessonAmountValid(lessonGross):lessonGross!==null)return reply({error:'Confirm the total collected for this private lesson before approving.'},400);
  if((seconds!==actual||duty!==previousDuty)&&!note)return reply({error:'Add a reason for the correction.'},400);
  write=db.prepare(`UPDATE coach_time_entries SET closed_at=COALESCE(closed_at,?),submitted_at=COALESCE(submitted_at,?),approved_seconds=?,approved_duty=?,
   approved_rate_cents=?,approved_lesson_gross_cents=?,review_note=?,approved_at=?,approved_by=?,revision=revision+1
   WHERE id=? AND revision=? AND approved_at IS NULL RETURNING id`)
   .bind(stamp,stamp,seconds,duty,shiftRate(row,duty),lessonGross,note||null,stamp,user.id,id,revision);
 }else{
  write=db.prepare(`UPDATE coach_time_entries SET approved_seconds=NULL,approved_duty=NULL,approved_rate_cents=NULL,approved_lesson_gross_cents=NULL,
   review_note=NULL,approved_at=NULL,approved_by=NULL,revision=revision+1
   WHERE id=? AND revision=? AND approved_at IS NOT NULL RETURNING id`).bind(id,revision);
 }
 const [saved]=await db.batch([write,db.prepare('INSERT INTO security_events(id,actor,action,target,created_at) SELECT ?,?,?,?,? WHERE changes()=1')
  .bind(crypto.randomUUID(),user.id,deleting?'coach_shift_voided':approving?'coach_shift_approved':'coach_shift_reopened',id,stamp)]);
 return saved.results.length?reply({ok:true}):reply({error:'The shift changed. Refresh before reviewing.'},409);
}
