import {env} from 'cloudflare:workers';
import {validState} from './academy-validation';
import {validFamily,cleanFamily} from './family-records';
import {eachBatch,jsonChunks} from './paging';
// Marks a backup as this academy's. It dates from the old Sites project and must stay unchanged, so backups downloaded
// from the old site can still be restored on the new one (docs/GO_LIVE.md step 5).
export const BACKUP_PROJECT='appgprj_6ad13665e8c881918c12b096132b4cae';
export const METADATA_SQL=`SELECT COALESCE((SELECT revision FROM academy_state WHERE id='academy'),0) AS academy, COALESCE((SELECT group_concat(token,'|') FROM (SELECT user_id||':'||revision AS token FROM family_accounts ORDER BY user_id)),'') AS families, COALESCE((SELECT json_group_array(json_array(id,user_id,date,start,end)) FROM (SELECT id,user_id,date,start,end FROM coach_openings ORDER BY id)),'[]') AS openings`;
export type Row=Record<string,string|number|null>;
// Lesson type, spots and private-group fields arrived with issue #177; files made before then do not have them.
type Opening={id:string;user_id:string;date:string;start:string;end:string;coach_email?:string|null;format?:string|null;capacity?:number|null;closed?:number;invite_code?:string|null;organizer_id?:string|null;organizer_wrestlers?:string|null};
export type Backup={version:1|2|3;project:string;createdAt:string;academy:any;families:{user_id:string;email:string;payload:any}[];openings:Opening[];records?:Record<string,Row[]>;archive?:{security_events:Row[];truncated:boolean}};
// Version 2 adds every other business table. Restore only re-creates rows that are missing by primary key
// and never overwrites an existing row, so a backup cannot alter a signed agreement or a decided approval.
// Excluded on purpose: staff_access and coach_invites (restoring a file must never grant access), integration_secrets (encrypted
// credential; keep the wrapping key separately), auth_attempts, error_log and usaw_lookups (transient: the latest USA Wrestling check and its one-day cache; the verification itself is a usaw_reviews row), recovery_snapshots and restore_guard (restore bookkeeping).
// tests/backup-coverage.mjs fails if a table is added to drizzle/ without being backed up or listed here.
// security_events is exported for retention but never restored, so audit history cannot be forged from a file.
type Col=[name:string,type:'text'|'int',nullable?:boolean,max?:number];
const BIG=400000;
export const RECORD_TABLES:Record<string,Col[]>={
 practice_curriculum_groups:[['id','text'],['program','text'],['name','text'],['name_key','text'],['revision','int'],['updated_by','text'],['updated_at','text']],
 practice_curricula:[['id','text'],['name','text'],['name_key','text'],['payload','text',false,BIG],['revision','int'],['updated_by','text'],['updated_at','text'],['curriculum_id','text',true],['lesson_order','int']],
 program_approvals:[['id','text'],['user_id','text'],['wrestler_id','text'],['program','text'],['wrestler_name','text'],['grade','text'],['status','text'],['created_at','text'],['updated_at','text'],['decided_by','text',true]],
 approval_messages:[['id','text'],['approval_id','text'],['sender_id','text'],['sender_role','text'],['body','text',false,20000],['created_at','text']],
 practice_plans:[['id','text'],['program','text'],['date','text'],['payload','text',false,BIG],['published','int'],['revision','int'],['updated_by','text'],['updated_at','text']],
 scholarship_awards:[['id','text'],['token_hash','text'],['recipient_email','text'],['wrestler_name','text'],['program','text'],['reference_cents','int'],['terms_text','text',false,BIG],['terms_ready','int'],['revision','int'],['status','text'],['user_id','text',true],['wrestler_id','text',true],['signer','text',true],['accepted_at','text',true],['ended_at','text',true],['expires_at','text'],['created_at','text'],['created_by','text'],['signature_record','text',true,BIG]],
 // Added for issue #78: payments, attendance and every feature table since. Stripe event ids are kept so a
 // restored database still ignores events it has already applied.
 orders:[['id','text'],['user_id','text'],['email','text'],['wrestler_id','text'],['wrestler_name','text'],['kind','text'],['program','text',true],['item_id','text'],['item_label','text'],['dates','text',false,BIG],['base_cents','int'],['discount_cents','int'],['amount_cents','int'],['currency','text'],['pricing','text',false,BIG],['terms_accepted','text',false,BIG],['status','text'],['dedupe_key','text'],['stripe_session_id','text',true],['stripe_payment_intent','text',true],['livemode','int'],['created_at','text'],['updated_at','text'],['paid_at','text',true],['term_start','text',true],['term_end','text',true],['source','text']],
 stripe_events:[['id','text'],['type','text'],['order_id','text',true],['outcome','text'],['received_at','text']],
 subscriptions:[['order_id','text'],['stripe_subscription_id','text'],['status','text'],['payments_made','int'],['payments_total','int'],['term_start','text'],['term_end','text'],['paid_through','text'],['cancel_at','text'],['updated_at','text']],
 // The owner's own entries in the books (issue #194). Payments are not copied there, so orders above stay the only record of them.
 // Added after version 3 first shipped, so older version 3 files may lack it (V3_LATER).
 financial_entries:[['id','text'],['kind','text'],['entry_date','text'],['amount_cents','int'],['category','text'],['note','text'],['receipt','text'],['revision','int'],['created_at','text'],['created_by','text'],['updated_at','text'],['updated_by','text'],['deleted_at','text',true],['deleted_by','text',true]],
 attendance:[['id','text'],['session_key','text'],['session_date','text'],['user_id','text'],['wrestler_id','text'],['wrestler_name','text'],['source','text'],['checked_in_at','text'],['checked_in_by','text']],
 usaw_reviews:[['user_id','text'],['wrestler_id','text'],['number','text'],['expires','text'],['status','text'],['note','text'],['reviewed_by','text'],['reviewed_at','text']],
 // kind (issue #195): waiver, parent_consent or coach_contract. Files made before it have none; see LATER_COLUMNS.
 waiver_versions:[['id','text'],['title','text'],['body','text',false,BIG],['sha256','text'],['published_at','text'],['published_by','text'],['retired_at','text',true],['kind','text']],
 waiver_signatures:[['id','text'],['version_id','text'],['user_id','text'],['wrestler_id','text'],['wrestler_name','text'],['signer','text'],['email','text'],['signature_record','text',false,BIG],['signed_at','text']],
 academy_settings:[['id','text'],['payload','text',false,BIG],['updated_at','text'],['updated_by','text']],
 wrestler_passes:[['id','text'],['user_id','text'],['wrestler_id','text'],['token','text'],['created_at','text'],['revoked_at','text',true],['revoked_by','text',true]],
 waitlist_entries:[['id','text'],['event_id','text'],['option','text'],['dates','text',false,BIG],['user_id','text'],['wrestler_id','text'],['wrestler_name','text'],['email','text'],['status','text'],['created_at','text'],['offered_at','text',true],['offer_expires_at','text',true],['offer_hours','int',true],['auto_next','int'],['offered_by','text',true],['closed_at','text',true]],
 membership_transfers:[['id','text'],['order_id','text'],['from_program','text'],['to_program','text'],['effective_date','text'],['reason','text'],['transferred_by','text'],['created_at','text']],
 announcements:[['id','text'],['subject','text'],['body','text',false,BIG],['audience','text'],['audience_label','text'],['sent_by','text'],['sent_at','text'],['recipients','int']],
 announcement_recipients:[['announcement_id','text'],['user_id','text'],['email','text'],['read_at','text',true],['email_status','text']],
 family_messages:[['id','text'],['user_id','text'],['sender_role','text'],['body','text',false,BIG],['created_at','text'],['read_at','text',true],['email_status','text']],
 booking_exceptions:[['id','text'],['user_id','text'],['wrestler_id','text'],['rule','text'],['starts_on','text'],['ends_on','text'],['reason','text'],['created_by','text'],['created_at','text'],['revoked_at','text',true],['revoked_by','text',true]],
 notifications:[['id','text'],['user_id','text',true],['email','text'],['kind','text'],['subject','text'],['body','text',false,20000],['dedupe_key','text'],['created_at','text'],['read_at','text',true],['email_status','text']],
 // Coach profiles (issue #190). Added after version 3 first shipped, so older version 3 files may lack it (V3_LATER).
 coach_profiles:[['email','text'],['display_name','text'],['bio','text',false,2000],['specialties','text',false,2000],['phone','text'],['photo_key','text',true],['updated_at','text'],['updated_by','text']],
 data_requests:[['id','text'],['user_id','text'],['email','text'],['kind','text'],['note','text',false,2000],['status','text'],['created_at','text'],['resolved_at','text',true],['resolved_by','text',true],['resolution','text',true,2000]],
 // Coach timesheets and time off (issue #193). Added after version 3 first shipped (V3_LATER). Restoring never changes
 // an existing shift or request, so an approved month cannot be altered from a file.
 coach_time_entries:[['id','text'],['user_id','text'],['coach_email','text'],['coach_name','text'],['work_date','text'],['session_key','text',true],['session_title','text',true],['session_start','text',true],['session_end','text',true],['duty','text'],['source','text'],['clock_in','text'],['clock_out','text',true],['fixed_in','text',true],['fixed_out','text',true],['coach_note','text',true],['submitted_at','text',true],['owner_minutes','int',true],['owner_duty','text',true],['owner_note','text',true],['approved_at','text',true],['approved_by','text',true],['approved_minutes','int',true],['approved_duty','text',true],['approved_rate_cents','int',true],['approved_cents','int',true],['voided_at','text',true],['voided_by','text',true],['void_reason','text',true],['history','text',false,BIG],['revision','int'],['created_at','text']],
 coach_time_off:[['id','text'],['user_id','text'],['coach_email','text'],['coach_name','text'],['start_date','text'],['end_date','text'],['reason','text'],['status','text'],['programs','text'],['requested_at','text'],['decided_at','text',true],['decided_by','text',true],['decision_note','text',true],['revision','int']],
};
// Tables whose primary key is not a single id column.
export const RECORD_KEYS:Record<string,string[]>={coach_profiles:['email'],subscriptions:['order_id'],usaw_reviews:['user_id','wrestler_id'],announcement_recipients:['announcement_id','user_id']};
const keysOf=(t:string)=>RECORD_KEYS[t]??['id'];
// JSON columns must parse to the expected shape, so a damaged or tampered file cannot store data that crashes a page.
const JSON_COLUMNS:Record<string,[string,'array'|'object'][]>={coach_profiles:[['specialties','array']],orders:[['dates','array'],['pricing','object'],['terms_accepted','object']],waitlist_entries:[['dates','array']],academy_settings:[['payload','object']],waiver_signatures:[['signature_record','object']],announcements:[['audience','object']],coach_time_entries:[['history','array']],coach_time_off:[['programs','array']]};
const jsonShape=(v:unknown,shape:'array'|'object')=>{try{const x=JSON.parse(String(v));return shape==='array'?Array.isArray(x):!!x&&typeof x==='object'&&!Array.isArray(x)}catch{return false}};
// Tables added to version 3 after it first shipped. A version 3 file made before one was added has no section for it
// and still restores; a file that has the section is checked like any other.
const V3_LATER=['coach_profiles','financial_entries','coach_time_entries','coach_time_off'];
// Columns added to a version 3 table after it first shipped, with the value an older file's rows mean. A row may leave
// them out and is restored with that value; a row that has one is checked like any other column. Issue #195: every
// signed-document version in an older file is a waiver.
const LATER_COLUMNS:Record<string,Record<string,string>>={waiver_versions:{kind:'waiver'}};
const V2_TABLES=['practice_curriculum_groups','practice_curricula','program_approvals','approval_messages','practice_plans','scholarship_awards'];
const ARCHIVE_COLS:Col[]=[['id','text'],['actor','text'],['action','text'],['target','text',false,2000],['created_at','text']];
// Every table is read in batches (issue #46), so no row is left out; a backup that would not fit the limits below
// fails with BackupTooLarge instead of being cut short. A file is limited to ROW_LIMIT rows per table (families and
// openings included) and EXPORT_LIMIT characters. The audit archive keeps the newest ARCHIVE_LIMIT events and says so.
const ROW_LIMIT=20000,ARCHIVE_LIMIT=20000,EXPORT_LIMIT=12000000;
export class BackupTooLarge extends Error{constructor(public what:string){super('Backup is too large for this export tool: '+what)}}
// Reads a whole table in batches of 1,000 by its key, refusing more than `max` rows.
async function readAll<T>(select:string,table:string,key:string[],max:number):Promise<T[]>{
 const out:T[]=[];
 for await(const rows of eachBatch<T>({select,from:'FROM '+table,key,size:1000})){out.push(...rows);if(out.length>max)throw new BackupTooLarge(`more than ${max.toLocaleString('en-US')} rows in ${table}`)}
 return out;
}
// Recovery snapshots are stored in parts below D1's 2 MB value limit: the first part under the snapshot's id, the rest
// as "<id>:1", "<id>:2"... Only first parts are listed, and a snapshot is read back and pruned as a whole.
const SNAPSHOT_PART=600000;
export const SNAPSHOT_LIST="SELECT id,created_at FROM recovery_snapshots WHERE instr(id,':')=0 ORDER BY created_at DESC LIMIT 10";
export async function readSnapshot(id:string){
 const rows=(await env.DB!.prepare("SELECT payload FROM recovery_snapshots WHERE id=?1 OR (substr(id,1,length(?1)+1)=?1||':') ORDER BY length(id),id").bind(id).all<{payload:string}>()).results;
 return rows.length?JSON.parse(rows.map(r=>r.payload).join('')):null;
}
const cols=(spec:Col[])=>spec.map(c=>c[0]).join(',');
function validRow(r:any,spec:Col[],later:Record<string,string>={}){
 if(!r||typeof r!=='object'||Array.isArray(r))return false;
 const absent=Object.keys(later).filter(c=>!Object.prototype.hasOwnProperty.call(r,c));
 if(Object.keys(r).length!==spec.length-absent.length)return false;
 return spec.every(([name,type,nullable,max])=>{if(absent.includes(name))return true;const v=r[name];if(v===null)return !!nullable;if(type==='int')return Number.isSafeInteger(v);return typeof v==='string'&&v.length<=(max??1000)});
}
export async function metadata(){return await env.DB!.prepare(METADATA_SQL).first<{academy:number;families:string;openings:string}>()}
export async function fingerprint(value:unknown){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(b=>b.toString(16).padStart(2,'0')).join('')}
export async function readCore():Promise<Backup>{
 const a=await env.DB!.prepare("SELECT payload FROM academy_state WHERE id='academy'").first<{payload:string}>();
 const families=await readAll<{user_id:string;email:string;payload:string}>('user_id,email,payload','family_accounts',['user_id'],ROW_LIMIT);
 const openings=await readAll<Opening>('id,user_id,date,start,end,coach_email,format,capacity,closed,invite_code,organizer_id,organizer_wrestlers','coach_openings',['id'],ROW_LIMIT);
 return {version:1,project:BACKUP_PROJECT,createdAt:new Date().toISOString(),academy:a?JSON.parse(a.payload):null,families:families.map(r=>({...r,payload:JSON.parse(r.payload)})),openings};
}
// Full export: core sections plus every other business table and the audit archive.
export async function readBackup():Promise<Backup>{
 const core=await readCore(),records:Record<string,Row[]>={};
 for(const t of Object.keys(RECORD_TABLES))records[t]=await readAll<Row>(cols(RECORD_TABLES[t]),t,keysOf(t),ROW_LIMIT);
 // The audit archive is the newest ARCHIVE_LIMIT events; `truncated` in the file says when older ones were left out.
 const events=(await env.DB!.prepare(`SELECT ${cols(ARCHIVE_COLS)} FROM security_events ORDER BY created_at DESC,id LIMIT ${ARCHIVE_LIMIT+1}`).all<Row>()).results;
 const data:Backup={...core,version:3,records,archive:{security_events:events.slice(0,ARCHIVE_LIMIT),truncated:events.length>ARCHIVE_LIMIT}};
 const size=JSON.stringify(data).length;
 if(size>EXPORT_LIMIT)throw new BackupTooLarge(`${(size/1e6).toFixed(1)} MB, more than the ${EXPORT_LIMIT/1e6} MB a file can hold`);return data;
}
const identifier=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9-]{1,80}$/.test(v);
export function validBackup(d:any):d is Backup{
 if(!d||![1,2,3].includes(d.version)||d.project!==BACKUP_PROJECT||!(d.academy===null||validState(d.academy))||!Array.isArray(d.families)||d.families.length>ROW_LIMIT||!Array.isArray(d.openings)||d.openings.length>ROW_LIMIT)return false;
 if(new Set(d.families.map((r:any)=>r?.user_id)).size!==d.families.length||new Set(d.openings.map((r:any)=>r?.id)).size!==d.openings.length)return false;
 if(!d.families.every((r:any)=>r&&identifier(r.user_id)&&typeof r.email==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)&&r.email.length<=254&&validFamily(r.payload)))return false;
 if(!validExtra(d))return false;
 return d.openings.every((r:any)=>r&&identifier(r.id)&&identifier(r.user_id)&&(r.coach_email===undefined||r.coach_email===null||(typeof r.coach_email==='string'&&r.coach_email.length<=254))&&typeof r.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(r.date)&&Number.isFinite(Date.parse(r.date))&&new Date(r.date).toISOString().slice(0,10)===r.date&&typeof r.start==='string'&&typeof r.end==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(r.start)&&/^([01]\d|2[0-3]):[0-5]\d$/.test(r.end)&&(+r.end.slice(0,2)*60+(+r.end.slice(3)))-(+r.start.slice(0,2)*60+(+r.start.slice(3)))===60&&validGroup(r));
}
const groupFields=['format','capacity','closed','invite_code','organizer_id','organizer_wrestlers'];
function validGroup(r:any){
 if(groupFields.every(k=>r[k]===undefined))return true;
 if(!groupFields.every(k=>k in r))return false;
 let kept:unknown=null;if(r.organizer_wrestlers!==null){try{kept=JSON.parse(r.organizer_wrestlers)}catch{return false}if(!Array.isArray(kept)||kept.length>6||!kept.every(identifier))return false}
 return (r.format===null||['one-on-one','partner','small-group'].includes(r.format))&&(r.capacity===null||(Number.isInteger(r.capacity)&&r.capacity>=1&&r.capacity<=6))&&(r.closed===0||r.closed===1)
  &&(r.invite_code===null||(typeof r.invite_code==='string'&&/^[A-Za-z0-9_-]{32}$/.test(r.invite_code)))&&(r.organizer_id===null||identifier(r.organizer_id));
}
function validExtra(d:any){
 if(d.version===1)return d.records===undefined&&d.archive===undefined;
 const r=d.records,a=d.archive;
 // Version 2 files (before issue #78) hold exactly the first six tables; version 3 holds every table. A file missing
 // a section for its version, or carrying one it should not, is refused.
 if(!r||typeof r!=='object'||Array.isArray(r))return false;
 const expected=d.version===2?V2_TABLES:Object.keys(RECORD_TABLES).filter(t=>!V3_LATER.includes(t)||Object.prototype.hasOwnProperty.call(r,t));
 if(Object.keys(r).sort().join()!==[...expected].sort().join())return false;
 for(const [t,spec] of Object.entries(RECORD_TABLES)){if(!expected.includes(t))continue;const rows=r[t],key=(x:any)=>JSON.stringify(keysOf(t).map(k=>x?.[k]));if(!Array.isArray(rows)||rows.length>ROW_LIMIT||new Set(rows.map(key)).size!==rows.length||!rows.every((x:any)=>validRow(x,spec,LATER_COLUMNS[t])&&(JSON_COLUMNS[t]??[]).every(([c,shape])=>jsonShape(x[c],shape))))return false}
 return !!a&&typeof a==='object'&&typeof a.truncated==='boolean'&&Array.isArray(a.security_events)&&a.security_events.length<=ARCHIVE_LIMIT&&a.security_events.every((x:any)=>validRow(x,ARCHIVE_COLS));
}
function snapshotParts(text:string,now:string){
 const id=crypto.randomUUID(),parts:string[]=[];
 for(let i=0;i<text.length;i+=SNAPSHOT_PART)parts.push(text.slice(i,i+SNAPSHOT_PART));
 return parts.map((p,n)=>env.DB!.prepare('INSERT INTO recovery_snapshots(id,payload,created_at) VALUES (?,?,?)').bind(n?id+':'+n:id,p,now));
}
export async function restoreBackup(backup:Backup,expectedFingerprint:string,actor:string){
 const beforeMeta=await metadata();if(await fingerprint(beforeMeta)!==expectedFingerprint)return false;
 const before=await readCore(),guard=crypto.randomUUID(),now=new Date().toISOString();
 // The checked insert and every restore write run in the same D1 batch transaction.
 const queries=[env.DB!.prepare(`INSERT INTO restore_guard(id,valid) SELECT ?,CASE WHEN academy=? AND families=? AND openings=? THEN 1 ELSE 0 END FROM (${METADATA_SQL})`).bind(guard,beforeMeta!.academy,beforeMeta!.families,beforeMeta!.openings),
 ...snapshotParts(JSON.stringify(before),now)];
 if(backup.academy!==null)queries.push(env.DB!.prepare("INSERT INTO academy_state(id,payload,revision,updated_by,updated_at) VALUES ('academy',?,1,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,revision=revision+1,updated_by=excluded.updated_by,updated_at=excluded.updated_at").bind(JSON.stringify(backup.academy),actor,now));
 if(backup.families.length)for(const part of jsonChunks(backup.families.map(r=>({...r,payload:cleanFamily(r.payload)}))))queries.push(env.DB!.prepare("INSERT INTO family_accounts(user_id,email,payload,revision,updated_at) SELECT json_extract(value,'$.user_id'),json_extract(value,'$.email'),json_extract(value,'$.payload'),1,? FROM json_each(?) WHERE 1 ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,payload=excluded.payload,revision=revision+1,updated_at=excluded.updated_at").bind(now,JSON.stringify(part)));
 if(backup.openings.length){
  // Openings from a file made after issue #177 also restore their lesson type, spots and private-group fields.
  const groups=backup.openings.some(o=>'closed' in o),extra=groups?','+groupFields.join(','):'',vals=groups?','+groupFields.map(k=>k==='closed'?"COALESCE(json_extract(value,'$.closed'),0)":`json_extract(value,'$.${k}')`).join(','):'';
  const sql=`INSERT INTO coach_openings(id,user_id,date,start,end,coach_email${extra}) SELECT json_extract(value,'$.id'),json_extract(value,'$.user_id'),json_extract(value,'$.date'),json_extract(value,'$.start'),json_extract(value,'$.end'),json_extract(value,'$.coach_email')${vals} FROM json_each(?) WHERE 1 ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id,date=excluded.date,start=excluded.start,end=excluded.end,coach_email=COALESCE(excluded.coach_email,coach_openings.coach_email)${groups?','+groupFields.map(k=>`${k}=excluded.${k}`).join(','):''}`;
  for(const part of jsonChunks(backup.openings))queries.push(env.DB!.prepare(sql).bind(JSON.stringify(part)))}
 // Each table's rows go in parts below D1's 2 MB value limit; every part is in the same batch, so the restore is still
 // all or nothing.
 const inserted:string[]=[],insertAt:number[][]=[];
 if(backup.version!==1)for(const [t,spec] of Object.entries(RECORD_TABLES)){const rows=backup.records![t]??[];if(!rows.length)continue;inserted.push(t);const at:number[]=[];insertAt.push(at);
  for(const part of jsonChunks(rows)){at.push(queries.length);queries.push(env.DB!.prepare(`INSERT OR IGNORE INTO ${t}(${cols(spec)}) SELECT ${spec.map(c=>LATER_COLUMNS[t]?.[c[0]]!==undefined?`COALESCE(json_extract(value,'$.${c[0]}'),'${LATER_COLUMNS[t][c[0]]}')`:`json_extract(value,'$.${c[0]}')`).join(',')} FROM json_each(?)`).bind(JSON.stringify(part)))}}
 queries.push(env.DB!.prepare('INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),actor,'backup_restored',backup.version!==1?'v'+backup.version+':'+(inserted.join('+')||'core-only'):'v1',now),env.DB!.prepare('DELETE FROM restore_guard WHERE id=?').bind(guard),env.DB!.prepare(`DELETE FROM recovery_snapshots WHERE substr(id,1,instr(id||':',':')-1) NOT IN (SELECT id FROM (${SNAPSHOT_LIST}))`));
 const results=await env.DB!.batch(queries);
 // Report rows actually re-created per table. Existing rows, and rows the database rejects, are skipped.
 const restored:Record<string,number>={};inserted.forEach((t,i)=>{restored[t]=insertAt[i].reduce((n,q)=>n+Number((results[q] as any)?.meta?.changes??0),0)});
 return {restored};
}
