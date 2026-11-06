import {env} from 'cloudflare:workers';
import {ownerIdentity,accountReply,sameOrigin} from '../../../lib/account-auth';
import {boundedBody} from '../../../lib/coach-profile';
import {academyToday} from '../../../lib/public-schedule';
import {coachLessonPercent} from '../../../lib/private-lesson-pay';
import {cleanFinancialEntry,financialCategories,financialMonth} from '../../../lib/financials';
export const dynamic='force-dynamic';
const totalsSql="COALESCE(SUM(CASE WHEN kind='income' THEN cents ELSE 0 END),0) AS income,COALESCE(SUM(CASE WHEN kind='expense' THEN cents ELSE 0 END),0) AS expenses,COUNT(*) AS count";
type Totals={income:number;expenses:number;count:number};
type CategoryTotal={kind:'income'|'expense';category:string;cents:number};
const withNet=(totals:Totals)=>({...totals,net:totals.income-totals.expenses});
function categoryTotals(lower:string,upper:string){
 return env.DB!.prepare(`SELECT kind,category,SUM(cents) AS cents FROM financial_entries
  WHERE date BETWEEN ? AND ? AND voided_at IS NULL GROUP BY kind,category ORDER BY cents DESC,category`)
  .bind(lower,upper);
}
type LessonTotals={count:number;grossCents:number;coachCents:number};
function approvedLessonTotals(lower:string,upper:string){
 return env.DB!.prepare(`SELECT COUNT(*) AS count,COALESCE(SUM(approved_lesson_gross_cents),0) AS grossCents,
  COALESCE(SUM(CAST((approved_lesson_gross_cents*?+50)/100 AS INTEGER)),0) AS coachCents FROM coach_time_entries
  WHERE work_date BETWEEN ? AND ? AND approved_at IS NOT NULL AND voided_at IS NULL
  AND lesson_format IS NOT NULL AND approved_lesson_gross_cents IS NOT NULL`).bind(coachLessonPercent,lower,upper);
}
function lessonFinancials(totals:LessonTotals){
 return {...totals,businessCents:totals.grossCents-totals.coachCents};
}
async function yearlyFinancials(year:string){
 const lower=year+'-01-01',upper=year+'-12-31';
 const [monthly,breakdown,lessons]=await env.DB!.batch([
  env.DB!.prepare(`SELECT substr(date,1,7) AS month,${totalsSql}
   FROM financial_entries WHERE date BETWEEN ? AND ? AND voided_at IS NULL GROUP BY substr(date,1,7)`).bind(lower,upper),
  categoryTotals(lower,upper),
  approvedLessonTotals(lower,upper)
 ]);
 const results=monthly.results as (Totals&{month:string})[];
 const recorded=new Map(results.map(({month,...totals})=>[month,totals]));
 const totals={income:0,expenses:0,count:0};
 const months=Array.from({length:12},(_,i)=>{
  const month=year+'-'+String(i+1).padStart(2,'0');
  const entry=recorded.get(month)??{income:0,expenses:0,count:0};
  totals.income+=entry.income;
  totals.expenses+=entry.expenses;
  totals.count+=entry.count;
  return {month,...withNet(entry)};
 });
 return {year,months,totals:withNet(totals),categoryTotals:breakdown.results as CategoryTotal[],lessonTotals:lessonFinancials(lessons.results[0] as LessonTotals)};
}
export async function GET(request:Request){
 const auth=await ownerIdentity(request),reply=(b:unknown,s=200)=>accountReply(b,s,auth.headers);if(!auth.owner)return reply({error:'Owner access and authenticator verification required.'},403);
 const u=new URL(request.url),year=u.searchParams.get('year');
 if(year!==null){
  if(!financialMonth(year+'-01')||u.searchParams.has('month')||u.searchParams.has('offset'))return reply({error:'Choose a valid year.'},400);
  return reply(await yearlyFinancials(year));
 }
 const today=academyToday(),month=u.searchParams.get('month')||today.slice(0,7),offset=Number(u.searchParams.get('offset')||0);if(!financialMonth(month)||!Number.isSafeInteger(offset)||offset<0||offset>100000)return reply({error:'Choose a valid month and page.'},400);
 const lower=month+'-01',upper=month+'-31';
 const [rows,sums,breakdown,lessons]=await env.DB!.batch([
  env.DB!.prepare('SELECT id,date,kind,category,description,cents,revision,voided_at FROM financial_entries WHERE date BETWEEN ? AND ? ORDER BY date DESC,created_at DESC,id DESC LIMIT 51 OFFSET ?').bind(lower,upper,offset),
  env.DB!.prepare(`SELECT ${totalsSql} FROM financial_entries WHERE date BETWEEN ? AND ? AND voided_at IS NULL`).bind(lower,upper),
  categoryTotals(lower,upper),
  approvedLessonTotals(lower,upper)
 ]);
 return reply({month,today,entries:rows.results.slice(0,50),hasMore:rows.results.length>50,categories:financialCategories,totals:withNet(sums.results[0] as Totals),categoryTotals:breakdown.results as CategoryTotal[],lessonTotals:lessonFinancials(lessons.results[0] as LessonTotals)});
}
export async function POST(request:Request){
 const auth=await ownerIdentity(request),reply=(b:unknown,s=200)=>accountReply(b,s,auth.headers);if(!auth.owner)return reply({error:'Owner access and authenticator verification required.'},403);
 if(!sameOrigin(request))return reply({error:'Invalid request origin.'},403);if(!request.headers.get('content-type')?.includes('application/json'))return reply({error:'JSON required.'},415);
 const bytes=await boundedBody(request,4096);if(!bytes)return reply({error:'Entry too large.'},413);let input;try{input=JSON.parse(new TextDecoder().decode(bytes))}catch{return reply({error:'Invalid request.'},400)}
 if(!['add','edit','void'].includes(input?.action))return reply({error:'Choose an entry action.'},400);
 const add=input.action==='add',voiding=input.action==='void';if(!add&&(typeof input.id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(input.id)||!Number.isSafeInteger(input.revision)||input.revision<1))return reply({error:'Choose a current entry.'},400);
 const entry=voiding?null:cleanFinancialEntry(input,academyToday());if(!voiding&&!entry)return reply({error:'Enter a date through today, category, description and a positive dollar amount with up to two decimal places.'},400);
 const id=add?crypto.randomUUID():input.id,now=new Date().toISOString(),actor=auth.owner.userId,revision=add?1:input.revision+1;
 const write=add?env.DB!.prepare('INSERT INTO financial_entries(id,date,kind,category,description,cents,revision,created_at,updated_at,updated_by) VALUES (?,?,?,?,?,?,1,?,?,?) RETURNING id').bind(id,entry!.date,entry!.kind,entry!.category,entry!.description,entry!.cents,now,now,actor):voiding?env.DB!.prepare('UPDATE financial_entries SET voided_at=?,revision=revision+1,updated_at=?,updated_by=? WHERE id=? AND revision=? AND voided_at IS NULL RETURNING id').bind(now,now,actor,id,input.revision):env.DB!.prepare('UPDATE financial_entries SET date=?,kind=?,category=?,description=?,cents=?,revision=revision+1,updated_at=?,updated_by=? WHERE id=? AND revision=? AND voided_at IS NULL RETURNING id').bind(entry!.date,entry!.kind,entry!.category,entry!.description,entry!.cents,now,actor,id,input.revision);
 const [saved]=await env.DB!.batch([write,env.DB!.prepare('INSERT INTO security_events(id,actor,action,target,created_at) SELECT ?,?,?,?,? WHERE changes()=1 AND EXISTS (SELECT 1 FROM financial_entries WHERE id=? AND revision=? AND updated_at=? AND updated_by=?)').bind(crypto.randomUUID(),actor,'financial_entry_'+input.action,id,now,id,revision,now,actor)]);
 return saved.results.length?reply({ok:true,id,revision}):reply({error:'This entry changed. Refresh before saving.'},409);
}
