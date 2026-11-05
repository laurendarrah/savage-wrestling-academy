import {env} from 'cloudflare:workers';
import {validState} from './academy-validation';
import {validFamily,cleanFamily} from './family-records';
export const BACKUP_PROJECT='appgprj_6ad13665e8c881918c12b096132b4cae';
export const METADATA_SQL=`SELECT COALESCE((SELECT revision FROM academy_state WHERE id='academy'),0) AS academy, COALESCE((SELECT group_concat(token,'|') FROM (SELECT user_id||':'||revision AS token FROM family_accounts ORDER BY user_id)),'') AS families, COALESCE((SELECT json_group_array(json_array(id,user_id,date,start,end)) FROM (SELECT id,user_id,date,start,end FROM coach_openings ORDER BY id)),'[]') AS openings`;
export type Row=Record<string,string|number|null>;
export type Backup={version:1|2;project:string;createdAt:string;academy:any;families:{user_id:string;email:string;payload:any}[];openings:{id:string;user_id:string;date:string;start:string;end:string}[];records?:Record<string,Row[]>;archive?:{security_events:Row[];truncated:boolean}};
// Version 2 adds every other business table. Restore only re-creates rows that are missing by primary key
// and never overwrites an existing row, so a backup cannot alter a signed agreement or a decided approval.
// Excluded on purpose: staff_access (restoring a file must never grant access), integration_secrets (encrypted
// credential; keep the wrapping key separately), auth_attempts (transient), recovery_snapshots and restore_guard (restore bookkeeping).
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
};
const ARCHIVE_COLS:Col[]=[['id','text'],['actor','text'],['action','text'],['target','text',false,2000],['created_at','text']];
const ROW_LIMIT=20000,ARCHIVE_LIMIT=20000,EXPORT_LIMIT=12000000;
const cols=(spec:Col[])=>spec.map(c=>c[0]).join(',');
function validRow(r:any,spec:Col[]){
 if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).length!==spec.length)return false;
 return spec.every(([name,type,nullable,max])=>{const v=r[name];if(v===null)return !!nullable;if(type==='int')return Number.isSafeInteger(v);return typeof v==='string'&&v.length<=(max??1000)});
}
export async function metadata(){return await env.DB!.prepare(METADATA_SQL).first<{academy:number;families:string;openings:string}>()}
export async function fingerprint(value:unknown){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(b=>b.toString(16).padStart(2,'0')).join('')}
export async function readCore():Promise<Backup>{
 const result=await env.DB!.batch([
 env.DB!.prepare("SELECT payload FROM academy_state WHERE id='academy'"),
 env.DB!.prepare('SELECT user_id,email,payload FROM family_accounts ORDER BY user_id LIMIT 2001'),
 env.DB!.prepare('SELECT id,user_id,date,start,end FROM coach_openings ORDER BY id LIMIT 10001')]);
 const a=result[0].results[0] as {payload:string}|undefined,f=result[1] as D1Result<{user_id:string;email:string;payload:string}>,o=result[2] as D1Result<{id:string;user_id:string;date:string;start:string;end:string}>;
 if(f.results.length>2000||o.results.length>10000)throw Error('Backup is too large for this export tool.');
 const data:Backup={version:1,project:BACKUP_PROJECT,createdAt:new Date().toISOString(),academy:a?JSON.parse(a.payload):null,families:f.results.map(r=>({...r,payload:JSON.parse(r.payload)})),openings:o.results};
 if(JSON.stringify(data).length>1500000)throw Error('Backup is too large for this export tool.');return data;
}
// Full export: core sections plus every other business table and the audit archive.
export async function readBackup():Promise<Backup>{
 const core=await readCore(),names=Object.keys(RECORD_TABLES);
 const result=await env.DB!.batch([...names.map(t=>env.DB!.prepare(`SELECT ${cols(RECORD_TABLES[t])} FROM ${t} ORDER BY id LIMIT ${ROW_LIMIT+1}`)),
  env.DB!.prepare(`SELECT ${cols(ARCHIVE_COLS)} FROM security_events ORDER BY created_at DESC,id LIMIT ${ARCHIVE_LIMIT+1}`)]);
 const records:Record<string,Row[]>={};
 names.forEach((t,i)=>{const rows=result[i].results as Row[];if(rows.length>ROW_LIMIT)throw Error('Backup is too large for this export tool.');records[t]=rows});
 const events=result[names.length].results as Row[];
 const data:Backup={...core,version:2,records,archive:{security_events:events.slice(0,ARCHIVE_LIMIT),truncated:events.length>ARCHIVE_LIMIT}};
 if(JSON.stringify(data).length>EXPORT_LIMIT)throw Error('Backup is too large for this export tool.');return data;
}
const identifier=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9-]{1,80}$/.test(v);
export function validBackup(d:any):d is Backup{
 if(!d||(d.version!==1&&d.version!==2)||d.project!==BACKUP_PROJECT||!(d.academy===null||validState(d.academy))||!Array.isArray(d.families)||d.families.length>2000||!Array.isArray(d.openings)||d.openings.length>10000)return false;
 if(new Set(d.families.map((r:any)=>r?.user_id)).size!==d.families.length||new Set(d.openings.map((r:any)=>r?.id)).size!==d.openings.length)return false;
 if(!d.families.every((r:any)=>r&&identifier(r.user_id)&&typeof r.email==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)&&r.email.length<=254&&validFamily(r.payload)))return false;
 if(!validExtra(d))return false;
 return d.openings.every((r:any)=>r&&identifier(r.id)&&identifier(r.user_id)&&typeof r.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(r.date)&&Number.isFinite(Date.parse(r.date))&&new Date(r.date).toISOString().slice(0,10)===r.date&&typeof r.start==='string'&&typeof r.end==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(r.start)&&/^([01]\d|2[0-3]):[0-5]\d$/.test(r.end)&&(+r.end.slice(0,2)*60+(+r.end.slice(3)))-(+r.start.slice(0,2)*60+(+r.start.slice(3)))===60);
}
function validExtra(d:any){
 if(d.version===1)return d.records===undefined&&d.archive===undefined;
 const r=d.records,a=d.archive;
 if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).sort().join()!==Object.keys(RECORD_TABLES).sort().join())return false;
 for(const [t,spec] of Object.entries(RECORD_TABLES)){const rows=r[t];if(!Array.isArray(rows)||rows.length>ROW_LIMIT||new Set(rows.map((x:any)=>x?.id)).size!==rows.length||!rows.every((x:any)=>validRow(x,spec)))return false}
 return !!a&&typeof a==='object'&&typeof a.truncated==='boolean'&&Array.isArray(a.security_events)&&a.security_events.length<=ARCHIVE_LIMIT&&a.security_events.every((x:any)=>validRow(x,ARCHIVE_COLS));
}
export async function restoreBackup(backup:Backup,expectedFingerprint:string,actor:string){
 const beforeMeta=await metadata();if(await fingerprint(beforeMeta)!==expectedFingerprint)return false;
 const before=await readCore(),guard=crypto.randomUUID(),now=new Date().toISOString();
 // The checked insert and every restore write run in the same D1 batch transaction.
 const queries=[env.DB!.prepare(`INSERT INTO restore_guard(id,valid) SELECT ?,CASE WHEN academy=? AND families=? AND openings=? THEN 1 ELSE 0 END FROM (${METADATA_SQL})`).bind(guard,beforeMeta!.academy,beforeMeta!.families,beforeMeta!.openings),
 env.DB!.prepare('INSERT INTO recovery_snapshots(id,payload,created_at) VALUES (?,?,?)').bind(crypto.randomUUID(),JSON.stringify(before),now)];
 if(backup.academy!==null)queries.push(env.DB!.prepare("INSERT INTO academy_state(id,payload,revision,updated_by,updated_at) VALUES ('academy',?,1,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,revision=revision+1,updated_by=excluded.updated_by,updated_at=excluded.updated_at").bind(JSON.stringify(backup.academy),actor,now));
 if(backup.families.length)queries.push(env.DB!.prepare("INSERT INTO family_accounts(user_id,email,payload,revision,updated_at) SELECT json_extract(value,'$.user_id'),json_extract(value,'$.email'),json_extract(value,'$.payload'),1,? FROM json_each(?) WHERE 1 ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,payload=excluded.payload,revision=revision+1,updated_at=excluded.updated_at").bind(now,JSON.stringify(backup.families.map(r=>({...r,payload:cleanFamily(r.payload)})))));
 if(backup.openings.length)queries.push(env.DB!.prepare("INSERT INTO coach_openings(id,user_id,date,start,end) SELECT json_extract(value,'$.id'),json_extract(value,'$.user_id'),json_extract(value,'$.date'),json_extract(value,'$.start'),json_extract(value,'$.end') FROM json_each(?) WHERE 1 ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id,date=excluded.date,start=excluded.start,end=excluded.end").bind(JSON.stringify(backup.openings)));
 const inserted:string[]=[],insertAt:number[]=[];
 if(backup.version===2)for(const [t,spec] of Object.entries(RECORD_TABLES)){const rows=backup.records![t];if(!rows.length)continue;inserted.push(t);insertAt.push(queries.length);
  queries.push(env.DB!.prepare(`INSERT OR IGNORE INTO ${t}(${cols(spec)}) SELECT ${spec.map(c=>`json_extract(value,'$.${c[0]}')`).join(',')} FROM json_each(?)`).bind(JSON.stringify(rows)))}
 queries.push(env.DB!.prepare('INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),actor,'backup_restored',backup.version===2?'v2:'+(inserted.join('+')||'core-only'):'v1',now),env.DB!.prepare('DELETE FROM restore_guard WHERE id=?').bind(guard),env.DB!.prepare('DELETE FROM recovery_snapshots WHERE id NOT IN (SELECT id FROM recovery_snapshots ORDER BY created_at DESC LIMIT 10)'));
 const results=await env.DB!.batch(queries);
 // Report rows actually re-created per table. Existing rows, and rows the database rejects, are skipped.
 const restored:Record<string,number>={};inserted.forEach((t,i)=>{restored[t]=Number((results[insertAt[i]] as any)?.meta?.changes??0)});
 return {restored};
}
