import {env} from 'cloudflare:workers';
import {validState} from './academy-validation';
import {validFamily,cleanFamily} from './family-records';
import {eachBatch,jsonChunks,chunks,utf8Length} from './paging';
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
// credential; keep the wrapping key separately), auth_attempts, error_log and usaw_lookups (transient: the latest USA Wrestling check and its one-day cache; the verification itself is a usaw_reviews row), recovery_snapshots, restore_guard and restore_staging (restore bookkeeping).
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
 // Card refund totals and Stripe fees (issue #42). Refund rows are restored with the stripe_events they belong to, so a
 // restored database still knows each refund and ignores a replay of its event. Added after version 3 first shipped (V3_LATER).
 payment_refunds:[['id','text'],['order_id','text'],['payment_intent','text'],['charge_id','text',true],['amount_cents','int'],['refunded_cents','int'],['refunded_at','text'],['livemode','int'],['received_at','text']],
 stripe_fees:[['payment_intent','text'],['order_id','text'],['charge_id','text'],['balance_transaction','text'],['amount_cents','int'],['fee_cents','int'],['net_cents','int'],['charged_at','text'],['livemode','int'],['recorded_at','text']],
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
 // Coaches removed for good and when (issue #212), so a restored file keeps each coach's 3-year clock. Added after version 3
 // first shipped (V3_LATER). Restoring never overwrites a row, so a file cannot bring back an email the cleanup cleared.
 removed_coaches:[['id','text'],['email_hash','text'],['email','text',true],['name','text',true],['removed_on','text'],['cleaned_at','text',true]],
};
// Tables whose primary key is not a single id column.
export const RECORD_KEYS:Record<string,string[]>={coach_profiles:['email'],stripe_fees:['payment_intent'],subscriptions:['order_id'],usaw_reviews:['user_id','wrestler_id'],announcement_recipients:['announcement_id','user_id']};
const keysOf=(t:string)=>RECORD_KEYS[t]??['id'];
// JSON columns must parse to the expected shape, so a damaged or tampered file cannot store data that crashes a page.
const JSON_COLUMNS:Record<string,[string,'array'|'object'][]>={coach_profiles:[['specialties','array']],orders:[['dates','array'],['pricing','object'],['terms_accepted','object']],waitlist_entries:[['dates','array']],academy_settings:[['payload','object']],waiver_signatures:[['signature_record','object']],announcements:[['audience','object']],coach_time_entries:[['history','array']],coach_time_off:[['programs','array']]};
const jsonShape=(v:unknown,shape:'array'|'object')=>{try{const x=JSON.parse(String(v));return shape==='array'?Array.isArray(x):!!x&&typeof x==='object'&&!Array.isArray(x)}catch{return false}};
// Tables added to version 3 after it first shipped. A version 3 file made before one was added has no section for it
// and still restores; a file that has the section is checked like any other.
const V3_LATER=['coach_profiles','financial_entries','coach_time_entries','coach_time_off','removed_coaches','payment_refunds','stripe_fees'];
// Columns added to a version 3 table after it first shipped, with the value an older file's rows mean. A row may leave
// them out and is restored with that value; a row that has one is checked like any other column. Issue #195: every
// signed-document version in an older file is a waiver.
const LATER_COLUMNS:Record<string,Record<string,string>>={waiver_versions:{kind:'waiver'}};
const V2_TABLES=['practice_curriculum_groups','practice_curricula','program_approvals','approval_messages','practice_plans','scholarship_awards'];
const ARCHIVE_COLS:Col[]=[['id','text'],['actor','text'],['action','text'],['target','text',false,2000],['created_at','text']];
// Limits (issues #46 and #221). Every table is read in batches, so no row is left out; a backup that would not fit fails
// with BackupTooLarge instead of being cut short.
// - The single-response export and restore (readBackup, validBackup and restoreBackup: GET /api/backups without a mode,
//   and the restore action) hold the whole file in the Worker's memory, so a file is limited to ROW_LIMIT rows per table
//   and EXPORT_LIMIT characters.
// - The Backups page streams the export (backupLines) and uploads a restore in checked parts (beginRestore, stageRestore,
//   commitRestore), so the Worker never holds the whole file. Each record table may then have up to LARGE_ROW_LIMIT rows.
//   Families and openings stay at ROW_LIMIT everywhere, because every restore first saves them in a recovery snapshot.
// The audit archive keeps the newest ARCHIVE_LIMIT events and says so.
const ROW_LIMIT=20000,ARCHIVE_LIMIT=20000,EXPORT_LIMIT=12000000,LARGE_ROW_LIMIT=200000;
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
const OPENING_COLS='id,user_id,date,start,end,coach_email,format,capacity,closed,invite_code,organizer_id,organizer_wrestlers';
export async function readCore():Promise<Backup>{
 const a=await env.DB!.prepare("SELECT payload FROM academy_state WHERE id='academy'").first<{payload:string}>();
 const families=await readAll<{user_id:string;email:string;payload:string}>('user_id,email,payload','family_accounts',['user_id'],ROW_LIMIT);
 const openings=await readAll<Opening>(OPENING_COLS,'coach_openings',['id'],ROW_LIMIT);
 return {version:1,project:BACKUP_PROJECT,createdAt:new Date().toISOString(),academy:a?JSON.parse(a.payload):null,families:families.map(r=>({...r,payload:JSON.parse(r.payload)})),openings};
}

// ---------- Export as lines (issue #221) ----------
// A full backup as a series of lines, read and sent one batch at a time: a header (version, project, time, academy
// settings), then sections of up to 1,000 rows ({table, rows}) for families, openings, each record table and the audit
// archive, and an end line with every section's row count. A section with no rows appears only in the end line. The
// Backups page writes these lines, compressed, into an encrypted file (public/security-backup.js); the end line is sent
// only after every row, so a file cut short never passes as complete.
export type BackupHeader={version:1|2|3;project:string;createdAt:string;academy:any};
export type BackupEnd={end:true;rows:Record<string,number>;truncated:boolean};
export type BackupLine=BackupHeader|{table:string;rows:any[]}|BackupEnd;
// Rows per read: fewer for tables with long text (signatures, plans), so one read stays well inside the Worker's memory.
const batchFor=(spec:Col[])=>spec.some(c=>(c[3]??0)>=BIG)?250:1000;
export async function* backupLines(recordLimit=LARGE_ROW_LIMIT):AsyncGenerator<BackupLine>{
 const a=await env.DB!.prepare("SELECT payload FROM academy_state WHERE id='academy'").first<{payload:string}>();
 yield {version:3,project:BACKUP_PROJECT,createdAt:new Date().toISOString(),academy:a?JSON.parse(a.payload):null};
 const counts:Record<string,number>={};
 async function* section(name:string,select:string,table:string,key:string[],size:number,max:number,map:(r:any)=>any=r=>r):AsyncGenerator<BackupLine>{
  counts[name]=0;
  for await(const rows of eachBatch<Row>({select,from:'FROM '+table,key,size})){counts[name]+=rows.length;if(counts[name]>max)throw new BackupTooLarge(`more than ${max.toLocaleString('en-US')} rows in ${table}`);yield {table:name,rows:rows.map(map)}}
 }
 yield* section('families','user_id,email,payload','family_accounts',['user_id'],1000,ROW_LIMIT,r=>({...r,payload:JSON.parse(r.payload)}));
 yield* section('openings',OPENING_COLS,'coach_openings',['id'],1000,ROW_LIMIT);
 for(const [t,spec] of Object.entries(RECORD_TABLES))yield* section(t,cols(spec),t,keysOf(t),batchFor(spec),recordLimit);
 // The audit archive is the newest ARCHIVE_LIMIT events; `truncated` says when older ones were left out.
 const events=(await env.DB!.prepare(`SELECT ${cols(ARCHIVE_COLS)} FROM security_events ORDER BY created_at DESC,id LIMIT ${ARCHIVE_LIMIT+1}`).all<Row>()).results;
 counts.security_events=Math.min(events.length,ARCHIVE_LIMIT);
 for(const part of chunks(events.slice(0,ARCHIVE_LIMIT),1000))yield {table:'security_events',rows:part};
 yield {end:true,rows:counts,truncated:events.length>ARCHIVE_LIMIT};
}
// Full export as one object (version 3): core sections plus every other business table and the audit archive. Used by
// GET /api/backups without a mode and by the checks; limited to what one response can hold.
export async function readBackup():Promise<Backup>{
 let data!:Backup,size=0;
 const records:Record<string,Row[]>=Object.fromEntries(Object.keys(RECORD_TABLES).map(t=>[t,[]])),events:Row[]=[];
 for await(const line of backupLines(ROW_LIMIT)){
  size+=JSON.stringify(line).length;if(size>EXPORT_LIMIT)throw new BackupTooLarge(`more than the ${EXPORT_LIMIT/1e6} MB one download can hold`);
  if('version' in line)data={...line,version:3,families:[],openings:[],records,archive:{security_events:events,truncated:false}};
  else if('table' in line)(line.table==='families'?data.families:line.table==='openings'?data.openings:line.table==='security_events'?events:records[line.table]).push(...line.rows);
  else data.archive!.truncated=line.truncated;
 }
 return data;
}

// ---------- Validation ----------
const identifier=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9-]{1,80}$/.test(v);
const TIME=/^([01]\d|2[0-3]):[0-5]\d$/;
const validFamilyRow=(r:any)=>!!r&&identifier(r.user_id)&&typeof r.email==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)&&r.email.length<=254&&validFamily(r.payload);
const validOpening=(r:any)=>!!r&&identifier(r.id)&&identifier(r.user_id)&&(r.coach_email===undefined||r.coach_email===null||(typeof r.coach_email==='string'&&r.coach_email.length<=254))&&typeof r.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(r.date)&&Number.isFinite(Date.parse(r.date))&&new Date(r.date).toISOString().slice(0,10)===r.date&&typeof r.start==='string'&&typeof r.end==='string'&&TIME.test(r.start)&&TIME.test(r.end)&&(+r.end.slice(0,2)*60+(+r.end.slice(3)))-(+r.start.slice(0,2)*60+(+r.start.slice(3)))===60&&validGroup(r);
const groupFields=['format','capacity','closed','invite_code','organizer_id','organizer_wrestlers'];
function validGroup(r:any){
 if(groupFields.every(k=>r[k]===undefined))return true;
 if(!groupFields.every(k=>k in r))return false;
 let kept:unknown=null;if(r.organizer_wrestlers!==null){try{kept=JSON.parse(r.organizer_wrestlers)}catch{return false}if(!Array.isArray(kept)||kept.length>6||!kept.every(identifier))return false}
 return (r.format===null||['one-on-one','partner','small-group'].includes(r.format))&&(r.capacity===null||(Number.isInteger(r.capacity)&&r.capacity>=1&&r.capacity<=6))&&(r.closed===0||r.closed===1)
  &&(r.invite_code===null||(typeof r.invite_code==='string'&&/^[A-Za-z0-9_-]{32}$/.test(r.invite_code)))&&(r.organizer_id===null||identifier(r.organizer_id));
}
// Every section a backup can hold, in restore order: the core, each record table, then the audit archive (checked, never
// restored).
const SECTIONS=['families','openings',...Object.keys(RECORD_TABLES),'security_events'];
const sectionKeys=(s:string)=>s==='families'?['user_id']:s==='openings'?['id']:s==='security_events'?[]:keysOf(s);
const rowCheck=(s:string):((r:any)=>boolean)=>s==='families'?validFamilyRow:s==='openings'?validOpening:s==='security_events'?r=>validRow(r,ARCHIVE_COLS)
 :r=>validRow(r,RECORD_TABLES[s],LATER_COLUMNS[s])&&(JSON_COLUMNS[s]??[]).every(([c,shape])=>jsonShape(r[c],shape));
// The rows of one section: each the right shape, and no key twice.
export function validRows(section:string,rows:unknown):rows is any[]{
 if(!SECTIONS.includes(section)||!Array.isArray(rows))return false;
 const keys=sectionKeys(section);
 if(keys.length&&new Set(rows.map((x:any)=>JSON.stringify(keys.map(k=>x?.[k])))).size!==rows.length)return false;
 return rows.every(rowCheck(section));
}
// Version 2 files (before issue #78) hold exactly the first six tables; version 3 holds every table, except that a file made
// before a V3_LATER table was added has no section for it.
const recordTablesFor=(version:number,present:string[])=>version===2?V2_TABLES:Object.keys(RECORD_TABLES).filter(t=>!V3_LATER.includes(t)||present.includes(t));
const sameSet=(a:string[],b:string[])=>[...a].sort().join()===[...b].sort().join();
const validHeader=(d:any)=>!!d&&[1,2,3].includes(d.version)&&d.project===BACKUP_PROJECT&&(d.academy===null||validState(d.academy));
export function validBackup(d:any):d is Backup{
 if(!validHeader(d)||!Array.isArray(d.families)||d.families.length>ROW_LIMIT||!Array.isArray(d.openings)||d.openings.length>ROW_LIMIT)return false;
 return validRows('families',d.families)&&validExtra(d)&&validRows('openings',d.openings);
}
function validExtra(d:any){
 if(d.version===1)return d.records===undefined&&d.archive===undefined;
 const r=d.records,a=d.archive;
 // A file missing a section for its version, or carrying one it should not, is refused.
 if(!r||typeof r!=='object'||Array.isArray(r))return false;
 const expected=recordTablesFor(d.version,Object.keys(r));
 if(!sameSet(Object.keys(r),expected)||!expected.every(t=>Array.isArray(r[t])&&r[t].length<=ROW_LIMIT&&validRows(t,r[t])))return false;
 return !!a&&typeof a==='object'&&typeof a.truncated==='boolean'&&Array.isArray(a.security_events)&&a.security_events.length<=ARCHIVE_LIMIT&&validRows('security_events',a.security_events);
}

// ---------- Restore ----------
function snapshotParts(text:string,now:string){
 const id=crypto.randomUUID(),parts:string[]=[];
 for(let i=0;i<text.length;i+=SNAPSHOT_PART)parts.push(text.slice(i,i+SNAPSHOT_PART));
 return parts.map((p,n)=>env.DB!.prepare('INSERT INTO recovery_snapshots(id,payload,created_at) VALUES (?,?,?)').bind(n?id+':'+n:id,p,now));
}
type Meta={academy:number;families:string;openings:string};
// One restore write: a JSON list of rows for one section, below D1's 2 MB value limit. `value` is that JSON, or (staged)
// the id of the restore_staging row that holds it. Openings with lesson type, spots and private-group fields (issue #177)
// are written with them; openings from older files leave those fields as they are.
type Part={section:string;value:string;grouped:boolean};
function openingSql(grouped:boolean,src:string){
 const extra=grouped?','+groupFields.join(','):'',vals=grouped?','+groupFields.map(k=>k==='closed'?"COALESCE(json_extract(value,'$.closed'),0)":`json_extract(value,'$.${k}')`).join(','):'';
 return `INSERT INTO coach_openings(id,user_id,date,start,end,coach_email${extra}) SELECT json_extract(value,'$.id'),json_extract(value,'$.user_id'),json_extract(value,'$.date'),json_extract(value,'$.start'),json_extract(value,'$.end'),json_extract(value,'$.coach_email')${vals} FROM json_each(${src}) WHERE 1 ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id,date=excluded.date,start=excluded.start,end=excluded.end,coach_email=COALESCE(excluded.coach_email,coach_openings.coach_email)${grouped?','+groupFields.map(k=>`${k}=excluded.${k}`).join(','):''}`;
}
const recordSql=(t:string,src:string)=>`INSERT OR IGNORE INTO ${t}(${cols(RECORD_TABLES[t])}) SELECT ${RECORD_TABLES[t].map(c=>LATER_COLUMNS[t]?.[c[0]]!==undefined?`COALESCE(json_extract(value,'$.${c[0]}'),'${LATER_COLUMNS[t][c[0]]}')`:`json_extract(value,'$.${c[0]}')`).join(',')} FROM json_each(${src})`;
const groupedOpening=(o:any)=>!!o&&typeof o==='object'&&'closed' in o;
// A section's rows as parts. Family profiles are cleaned as they are saved; openings are split by whether they carry the
// group fields.
function partsOf(section:string,rows:any[]):{rows:any[];grouped:boolean}[]{
 if(section==='openings')return [true,false].flatMap(g=>jsonChunks(rows.filter(o=>groupedOpening(o)===g),PART_BYTES).map(p=>({rows:p,grouped:g})));
 return jsonChunks(section==='families'?rows.map(r=>({...r,payload:cleanFamily(r.payload)})):rows,PART_BYTES).map(p=>({rows:p,grouped:false}));
}
// Applies a restore in one D1 batch transaction: the checked insert, a recovery snapshot of the current core sections, the
// academy settings, then every part (families and openings replace matching rows; record tables only re-create rows that
// are missing by primary key and never overwrite one, so a backup cannot alter a signed agreement or a decided approval).
// Parts come in SECTIONS order. All or nothing.
async function applyRestore(o:{version:number;academy:any;parts:Part[];staged:boolean;beforeMeta:Meta;actor:string;after?:D1PreparedStatement[]}){
 const db=env.DB!,src=o.staged?'(SELECT payload FROM restore_staging WHERE id=?)':'?',m=o.beforeMeta;
 const before=await readCore(),guard=crypto.randomUUID(),now=new Date().toISOString();
 const queries=[db.prepare(`INSERT INTO restore_guard(id,valid) SELECT ?,CASE WHEN academy=? AND families=? AND openings=? THEN 1 ELSE 0 END FROM (${METADATA_SQL})`).bind(guard,m.academy,m.families,m.openings),
 ...snapshotParts(JSON.stringify(before),now)];
 if(o.academy!==null)queries.push(db.prepare("INSERT INTO academy_state(id,payload,revision,updated_by,updated_at) VALUES ('academy',?,1,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,revision=revision+1,updated_by=excluded.updated_by,updated_at=excluded.updated_at").bind(JSON.stringify(o.academy),o.actor,now));
 const inserted:string[]=[],insertAt:number[][]=[];
 for(const p of o.parts){
  if(p.section==='families')queries.push(db.prepare(`INSERT INTO family_accounts(user_id,email,payload,revision,updated_at) SELECT json_extract(value,'$.user_id'),json_extract(value,'$.email'),json_extract(value,'$.payload'),1,? FROM json_each(${src}) WHERE 1 ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,payload=excluded.payload,revision=revision+1,updated_at=excluded.updated_at`).bind(now,p.value));
  else if(p.section==='openings')queries.push(db.prepare(openingSql(p.grouped,src)).bind(p.value));
  else if(RECORD_TABLES[p.section]){if(inserted.at(-1)!==p.section){inserted.push(p.section);insertAt.push([])}insertAt.at(-1)!.push(queries.length);queries.push(db.prepare(recordSql(p.section,src)).bind(p.value))}
 }
 queries.push(db.prepare('INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),o.actor,'backup_restored',o.version!==1?'v'+o.version+':'+(inserted.join('+')||'core-only'):'v1',now),db.prepare('DELETE FROM restore_guard WHERE id=?').bind(guard),db.prepare(`DELETE FROM recovery_snapshots WHERE substr(id,1,instr(id||':',':')-1) NOT IN (SELECT id FROM (${SNAPSHOT_LIST}))`),...(o.after??[]));
 const results=await db.batch(queries);
 // Report rows actually re-created per table. Existing rows, and rows the database rejects, are skipped.
 const restored:Record<string,number>={};inserted.forEach((t,i)=>{restored[t]=insertAt[i].reduce((n,q)=>n+Number((results[q] as any)?.meta?.changes??0),0)});
 return {restored};
}
// Restores a whole backup object sent in one request (files up to EXPORT_LIMIT). False when records changed after preview.
export async function restoreBackup(backup:Backup,expectedFingerprint:string,actor:string){
 const beforeMeta=await metadata();if(await fingerprint(beforeMeta)!==expectedFingerprint)return false;
 const sections:[string,any[]][]=[['families',backup.families],['openings',backup.openings],...(backup.version!==1?Object.keys(RECORD_TABLES).map(t=>[t,backup.records![t]??[]] as [string,any[]]):[])];
 const parts=sections.flatMap(([section,rows])=>partsOf(section,rows).map(p=>({section,value:JSON.stringify(p.rows),grouped:p.grouped})));
 return applyRestore({version:backup.version,academy:backup.academy,parts,staged:false,beforeMeta:beforeMeta!,actor});
}

// ---------- Restore in parts (issue #221) ----------
// The Backups page uploads a backup of any supported version in parts: beginRestore, then stageRestore with up to
// STAGE_REQUEST_BYTES of rows at a time (each section checked as it arrives and saved in restore_staging), then
// commitRestore with the header and every section's row count. The commit checks that every expected section arrived
// whole and that no key repeats across parts, then applies everything with applyRestore in one batch, reading each part
// from restore_staging inside D1, so the Worker never holds the whole backup and the restore stays all or nothing.
// Limits keep the commit batch well inside D1's: parts below its 2 MB value limit, at most STAGE_PARTS parts.
const PART_BYTES=1500000,STAGE_BYTES=300000000,STAGE_PARTS=600,STAGE_TTL=86400000;
export const STAGE_REQUEST_BYTES=9000000;
const BEGIN='#begin';
const limitFor=(s:string)=>s==='families'||s==='openings'?ROW_LIMIT:s==='security_events'?ARCHIVE_LIMIT:LARGE_ROW_LIMIT;
// Removes uploads that were never committed (started more than a day ago), and rows left without a start.
const STALE_STAGING="DELETE FROM restore_staging WHERE upload NOT IN (SELECT upload FROM restore_staging WHERE section='#begin' AND created_at>=?)";
const staleBefore=()=>new Date(Date.now()-STAGE_TTL).toISOString();
export async function clearStaleStaging(){await env.DB!.prepare(STALE_STAGING).bind(staleBefore()).run()}
// Starts an upload. The owner's earlier unfinished uploads are discarded.
export async function beginRestore(user:string){
 const upload=crypto.randomUUID(),now=new Date().toISOString();
 await env.DB!.batch([env.DB!.prepare('DELETE FROM restore_staging WHERE user_id=?').bind(user),env.DB!.prepare(STALE_STAGING).bind(staleBefore()),
  env.DB!.prepare('INSERT INTO restore_staging(id,upload,user_id,seq,section,grouped,row_count,bytes,payload,created_at) VALUES (?,?,?,0,?,0,0,0,?,?)').bind(upload+':0',upload,user,BEGIN,'[]',now)]);
 return upload;
}
export async function discardRestore(upload:string,user:string){await env.DB!.prepare('DELETE FROM restore_staging WHERE upload=? AND user_id=?').bind(upload,user).run()}
type StageResult={ok:true}|{error:'invalid'|'expired'|'too-large'};
// Saves checked rows for one or more sections. The audit archive is checked and counted but not kept: it is never restored.
export async function stageRestore(upload:string,user:string,sections:unknown):Promise<StageResult>{
 if(!Array.isArray(sections)||!sections.length||sections.length>SECTIONS.length)return {error:'invalid'};
 if(!sections.every((s:any)=>s&&typeof s==='object'&&SECTIONS.includes(s.table)&&validRows(s.table,s.rows)&&s.rows.length<=limitFor(s.table)))return {error:'invalid'};
 const head=await env.DB!.prepare(`SELECT COALESCE(max(seq),0) AS seq,COALESCE(sum(bytes),0) AS bytes,count(*) AS parts,max(CASE WHEN section='${BEGIN}' THEN created_at END) AS started FROM restore_staging WHERE upload=? AND user_id=?`).bind(upload,user).first<{seq:number;bytes:number;parts:number;started:string|null}>();
 if(!head?.started||head.started<staleBefore())return {error:'expired'};
 const now=new Date().toISOString(),rows:{section:string;grouped:boolean;count:number;payload:string;bytes:number}[]=[];
 for(const {table,rows:list} of sections as {table:string;rows:any[]}[]){
  if(table==='security_events'){rows.push({section:table,grouped:false,count:list.length,payload:'[]',bytes:0});continue}
  for(const p of partsOf(table,list)){const payload=JSON.stringify(p.rows);rows.push({section:table,grouped:p.grouped,count:p.rows.length,payload,bytes:utf8Length(payload)})}
 }
 if(head.parts+rows.length>STAGE_PARTS||head.bytes+rows.reduce((n,r)=>n+r.bytes,0)>STAGE_BYTES)return {error:'too-large'};
 if(rows.length)await env.DB!.batch(rows.map((r,i)=>env.DB!.prepare('INSERT INTO restore_staging(id,upload,user_id,seq,section,grouped,row_count,bytes,payload,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
  .bind(upload+':'+(head.seq+1+i),upload,user,head.seq+1+i,r.section,r.grouped?1:0,r.count,r.bytes,r.payload,now)));
 return {ok:true};
}
// Applies a staged upload. `input` is the backup's header, every section's row count from its end line, and (versions 2
// and 3) whether its audit archive was truncated. False when records changed after preview.
export async function commitRestore(upload:string,user:string,input:any,expectedFingerprint:string,actor:string):Promise<false|{error:'invalid'|'expired'}|{restored:Record<string,number>}>{
 const header=input?.header,declared=input?.rows;
 if(!validHeader(header)||!declared||typeof declared!=='object'||Array.isArray(declared))return {error:'invalid'};
 const names=Object.keys(declared),expected=['families','openings',...(header.version===1?[]:[...recordTablesFor(header.version,names),'security_events'])];
 if(!sameSet(names,expected)||!names.every(s=>Number.isSafeInteger(declared[s])&&declared[s]>=0&&declared[s]<=limitFor(s))||(header.version!==1&&typeof input.truncated!=='boolean'))return {error:'invalid'};
 const staged=(await env.DB!.prepare('SELECT id,section,grouped,row_count FROM restore_staging WHERE upload=? AND user_id=? ORDER BY seq').bind(upload,user).all<{id:string;section:string;grouped:number;row_count:number}>()).results;
 const start=staged.find(s=>s.section===BEGIN);if(!start)return {error:'expired'};
 // Every section arrived whole: its staged rows add up to the count in the file's end line.
 const got:Record<string,number>={},partCount:Record<string,number>={};
 for(const s of staged)if(s.section!==BEGIN){got[s.section]=(got[s.section]??0)+s.row_count;partCount[s.section]=(partCount[s.section]??0)+1}
 if(!Object.keys(got).every(s=>names.includes(s))||!names.every(s=>(got[s]??0)===declared[s]))return {error:'invalid'};
 // Each part was checked for repeated keys as it arrived; a section saved in several parts is checked across them here.
 const spread=Object.keys(partCount).filter(s=>partCount[s]>1&&s!=='security_events');
 if(spread.length){
  const sql=spread.map(s=>`SELECT * FROM (SELECT '${s}' AS section FROM restore_staging s, json_each(s.payload) j WHERE s.upload=?1 AND s.section='${s}' GROUP BY ${sectionKeys(s).map(k=>`json_extract(j.value,'$.${k}')`).join(',')} HAVING count(*)>1 LIMIT 1)`).join(' UNION ALL ');
  if(await env.DB!.prepare(sql).bind(upload).first())return {error:'invalid'};
 }
 const beforeMeta=await metadata();if(await fingerprint(beforeMeta)!==expectedFingerprint)return false;
 const order=(s:string)=>SECTIONS.indexOf(s);
 const parts=staged.filter(s=>s.section!==BEGIN&&s.section!=='security_events').sort((a,b)=>order(a.section)-order(b.section)).map(s=>({section:s.section,value:s.id,grouped:s.grouped===1}));
 return applyRestore({version:header.version,academy:header.academy,parts,staged:true,beforeMeta:beforeMeta!,actor,after:[env.DB!.prepare('DELETE FROM restore_staging WHERE upload=?').bind(upload)]});
}
