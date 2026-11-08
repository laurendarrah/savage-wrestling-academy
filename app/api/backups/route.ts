import {env} from 'cloudflare:workers';
import {ownerIdentity,accountReply,sameOrigin} from '../../../lib/account-auth';
import {readBackup,backupLines,validBackup,metadata,fingerprint,restoreBackup,readSnapshot,BackupTooLarge,SNAPSHOT_LIST,beginRestore,stageRestore,commitRestore,discardRestore,STAGE_REQUEST_BYTES} from '../../../lib/backup-records';
import {securityEvent} from '../../../lib/security-events';
import {cleanupRemovedCoaches} from '../../../lib/coach-retention';
import {withApi} from '../../../lib/api';
export const dynamic='force-dynamic';
const tooLarge=(e:BackupTooLarge)=>`The academy's records are too large for one backup download (${e.what}). No records were changed. Ask whoever maintains the site for a full database export.`;
export const GET = withApi(GET_); async function GET_(request:Request){
 const auth=await ownerIdentity(request),reply=(b:unknown,s=200)=>accountReply(b,s,auth.headers);if(!auth.owner)return reply({error:'Owner sign-in and authenticator verification required.'},403);
 const params=new URL(request.url).searchParams;
 if(params.get('mode')==='preview')return reply({fingerprint:await fingerprint(await metadata())});
 // The site keeps the last 10 recovery snapshots (each saved in parts, issue #46).
 if(params.get('mode')==='snapshots'){const rows=await env.DB!.prepare(SNAPSHOT_LIST).all();return reply({snapshots:rows.results})}
 if(params.has('snapshot')){const id=params.get('snapshot')!;const backup=/^[A-Za-z0-9-]{1,80}$/.test(id)?await readSnapshot(id):null;return backup?reply({backup}):reply({error:'Recovery snapshot not found.'},404)}
 // The Backups page's download (issue #221): the backup as lines of JSON, sent one batch at a time so neither the Worker
 // nor the response holds the whole file. The last line is the end line, sent only after every row; if the export cannot
 // finish, the last line is {"error": ...} instead, so the page never saves a partial file.
 if(params.get('mode')==='lines'){
  const lines=backupLines(),encoder=new TextEncoder(),actor=auth.user!.id;
  const body=new ReadableStream<Uint8Array>({
   async pull(controller){
    try{
     const next=await lines.next();
     if(next.done){controller.close();return}
     if('end' in next.value)await securityEvent(actor,'backup_exported');
     controller.enqueue(encoder.encode(JSON.stringify(next.value)+'\n'));
    }catch(e){
     controller.enqueue(encoder.encode(JSON.stringify({error:e instanceof BackupTooLarge?tooLarge(e):'Backup export could not finish. No records were changed.'})+'\n'));controller.close();
    }
   },
   async cancel(){await lines.return(undefined)}
  });
  const headers=new Headers(auth.headers);headers.set('Content-Type','application/x-ndjson; charset=utf-8');headers.set('Cache-Control','private, no-store');
  return new Response(body,{headers});
 }
 // The whole backup as one object, for files up to 12 MB (the checks and older pages use it).
 try{const backup=await readBackup();await securityEvent(auth.user!.id,'backup_exported');return reply({backup})}catch(e){
  // Never a partial file: a backup that is too big for one download says so.
  if(e instanceof BackupTooLarge)return reply({error:tooLarge(e)},507);
  return reply({error:'Backup export could not finish. No records were changed.'},502)}
}
const CHANGED='Records changed after preview. Preview the backup again before restoring.',UNSUPPORTED='This is not a supported backup for this academy.',FAILED='Restore could not finish or records changed during the restore. No partial restore was applied. Preview again before retrying.';
const uploadId=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f-]{36}$/.test(v);
export const POST = withApi(POST_); async function POST_(request:Request){
 const auth=await ownerIdentity(request),reply=(b:unknown,s=200)=>accountReply(b,s,auth.headers);if(!auth.owner)return reply({error:'Owner sign-in and authenticator verification required.'},403);
 if(!sameOrigin(request))return reply({error:'Invalid request origin.'},403);
 if(!request.headers.get('content-type')?.includes('application/json'))return reply({error:'JSON required.'},415);
 const raw=await request.text();if(raw.length>13000000)return reply({error:'Backup is too large.'},413);let input;try{input=JSON.parse(raw)}catch{return reply({error:'Invalid backup.'},400)}
 const user=auth.user!.id;
 // A restore in parts (issue #221): begin, stage the rows a few megabytes at a time, then commit them in one batch.
 if(input?.action==='begin')return reply({upload:await beginRestore(user)});
 if(input?.action==='stage'){
  if(!uploadId(input.upload))return reply({error:UNSUPPORTED},400);
  if(raw.length>STAGE_REQUEST_BYTES)return reply({error:'Backup part is too large.'},413);
  const r=await stageRestore(input.upload,user,input.sections);
  if('ok' in r)return reply({ok:true});
  await discardRestore(input.upload,user);
  if(r.error==='expired')return reply({error:'This restore was started more than a day ago or was replaced by another one. Preview the backup again before restoring.'},409);
  if(r.error==='too-large')return reply({error:'This backup is too large to restore from the Backups page. No records were changed. Ask whoever maintains the site to restore it from a full database export.'},413);
  return reply({error:UNSUPPORTED},400);
 }
 if(input?.action==='commit'){
  if(!uploadId(input.upload)||typeof input.fingerprint!=='string')return reply({error:UNSUPPORTED},400);
  try{
   const r=await commitRestore(input.upload,user,input,input.fingerprint,user);
   if(!r||'error' in r){await discardRestore(input.upload,user);return !r?reply({error:CHANGED},409):r.error==='expired'?reply({error:'This restore was started more than a day ago or was replaced by another one. Preview the backup again before restoring.'},409):reply({error:UNSUPPORTED},400)}
   try{await cleanupRemovedCoaches({maxStatements:400})}catch{}
   return reply({ok:true,restored:r.restored});
  }catch{try{await discardRestore(input.upload,user)}catch{}return reply({error:FAILED},409)}
 }
 if(input?.action!=='restore'||typeof input.fingerprint!=='string'||!validBackup(input.backup))return reply({error:UNSUPPORTED},400);
 try{const result=await restoreBackup(input.backup,input.fingerprint,user);if(!result)return reply({error:CHANGED},409);
  // A file can bring back records of a coach removed more than 3 years ago (#212): clean them again straight away. If
  // this does not finish, the daily job does.
  try{await cleanupRemovedCoaches({maxStatements:400})}catch{}
  return reply({ok:true,restored:result.restored})}catch{return reply({error:FAILED},409)}
}
