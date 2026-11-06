import {env} from 'cloudflare:workers';
import {accountReply,sameOrigin,strongAccount} from '../../../lib/account-auth';
import {accountRole} from '../../../lib/access-control';
import {boundedBody} from '../../../lib/coach-profile';
import {financialMonth} from '../../../lib/financials';

export const dynamic='force-dynamic';
const categories=['sick','personal','vacation','other'];
const statuses=['pending','approved','declined','withdrawn','cancelled'];
const fields='id,coach_name,category,start_date,end_date,note,status,submitted_at,reviewed_at,revision';
const pageSize=40;
const activeCoach='(? OR EXISTS (SELECT 1 FROM staff_access WHERE email=? AND active=1))';

function dateValue(input:unknown){
 if(typeof input!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(input)||!financialMonth(input.slice(0,7)))return null;
 const value=Date.parse(input+'T00:00:00Z');
 return Number.isFinite(value)&&new Date(value).toISOString().slice(0,10)===input?value:null;
}
async function identity(request:Request){
 const auth=await strongAccount(request);
 const access=await accountRole(auth.user);
 const owner=access.role==='owner';
 return {auth,access,owner,allowed:auth.strong&&(owner||access.role==='coach')};
}

export async function GET(request:Request){
 const {auth,owner,allowed}=await identity(request);
 const reply=(body:unknown,status=200)=>accountReply(body,status,auth.headers);
 const query=new URL(request.url).searchParams,review=query.get('review')==='1';
 if(!allowed||(review&&!owner))return reply({error:'Verified coach or owner access is required.'},403);
 const filter=query.get('status')??(review?'pending':'all'),offset=Number(query.get('offset')??0);
 if((filter!=='all'&&!statuses.includes(filter))||!Number.isSafeInteger(offset)||offset<0||offset>100000)return reply({error:'Choose a valid status and page.'},400);
 const scope=review?'1=1':'user_id=?';
 const bindings=review?[]:[auth.user!.id];
 const filterSql=filter==='all'?'':' AND status=?';
 if(filter!=='all')bindings.push(filter);
 const {results}=await env.DB!.prepare(`SELECT ${fields} FROM coach_time_off WHERE ${scope}${filterSql}
  ORDER BY submitted_at DESC,id DESC LIMIT ? OFFSET ?`).bind(...bindings,pageSize+1,offset).all();
 return reply({requests:results.slice(0,pageSize),hasMore:results.length>pageSize});
}

export async function POST(request:Request){
 const {auth,access,owner,allowed}=await identity(request);
 const reply=(body:unknown,status=200)=>accountReply(body,status,auth.headers);
 if(!allowed)return reply({error:'Coach access and authenticator verification are required.'},403);
 if(!sameOrigin(request))return reply({error:'Invalid request origin.'},403);
 if(!request.headers.get('content-type')?.includes('application/json'))return reply({error:'JSON required.'},415);
 const bytes=await boundedBody(request,4096);
 if(!bytes)return reply({error:'Request too large.'},413);
 let input;try{input=JSON.parse(new TextDecoder().decode(bytes))}catch{return reply({error:'Invalid request.'},400)}
 const user=auth.user!,email=user.email!.toLowerCase(),db=env.DB!,stamp=new Date().toISOString();
 if(input?.action==='request'){
  const {category,startDate,endDate}=input;
  const start=dateValue(startDate),end=dateValue(endDate);
  const note=typeof input.note==='string'?input.note.trim():'';
  if(!categories.includes(category)||start===null||end===null||end<start||end-start>365*86400000||note.length>240)return reply({error:'Choose a type and valid dates spanning at most 366 days. Keep any scheduling note to 240 characters.'},400);
  const profile=await db.prepare("SELECT json_extract(payload,'$.name') AS name FROM coach_profiles WHERE email=?").bind(email).first<{name:string}>();
  const saved=await db.prepare(`INSERT INTO coach_time_off(id,user_id,coach_name,category,start_date,end_date,note,submitted_at)
   SELECT ?,?,?,?,?,?,?,? WHERE ${activeCoach} AND NOT EXISTS (
    SELECT 1 FROM coach_time_off WHERE user_id=? AND status IN ('pending','approved') AND start_date<=? AND end_date>=?
   ) RETURNING id`).bind(crypto.randomUUID(),user.id,profile?.name||access.staff?.name||(owner?'Academy owner':email),
    category,startDate,endDate,note,stamp,owner?1:0,email,user.id,endDate,startDate).first();
  return saved?reply({ok:true}):reply({error:'These dates overlap a pending or approved request, or your access changed.'},409);
 }
 if(typeof input?.id!=='string'||!/^[0-9a-f-]{36}$/i.test(input.id)||!Number.isSafeInteger(input.revision)||input.revision<1)return reply({error:'Choose a current request.'},400);
 const {id,revision,action}=input;
 if(action==='withdraw'){
  const saved=await db.prepare(`UPDATE coach_time_off SET status='withdrawn',reviewed_at=?,reviewed_by=?,revision=revision+1
   WHERE id=? AND user_id=? AND revision=? AND status='pending' AND ${activeCoach} RETURNING id`)
   .bind(stamp,user.id,id,user.id,revision,owner?1:0,email).first();
  return saved?reply({ok:true}):reply({error:'Only your own pending requests can be withdrawn. Refresh before trying again.'},409);
 }
 if(!owner)return reply({error:'Only the owner can review requests.'},403);
 const next=action==='approve'?'approved':action==='decline'?'declined':action==='cancel'?'cancelled':null;
 if(!next)return reply({error:'Choose a review action.'},400);
 const previous=action==='cancel'?'approved':'pending';
 const [saved]=await db.batch([
  db.prepare('UPDATE coach_time_off SET status=?,reviewed_at=?,reviewed_by=?,revision=revision+1 WHERE id=? AND revision=? AND status=? RETURNING id')
   .bind(next,stamp,user.id,id,revision,previous),
  db.prepare('INSERT INTO security_events(id,actor,action,target,created_at) SELECT ?,?,?,?,? WHERE changes()=1')
   .bind(crypto.randomUUID(),user.id,'coach_time_off_'+next,id,stamp)
 ]);
 return saved.results.length?reply({ok:true}):reply({error:'This request changed. Refresh before reviewing.'},409);
}
