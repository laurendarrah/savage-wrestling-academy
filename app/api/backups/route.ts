import {env} from 'cloudflare:workers';
import {ownerIdentity,accountReply,sameOrigin} from '../../../lib/account-auth';
import {readBackup,validBackup,metadata,fingerprint,restoreBackup,readSnapshot,BackupTooLarge,SNAPSHOT_LIST} from '../../../lib/backup-records';
import {securityEvent} from '../../../lib/security-events';
import {cleanupRemovedCoaches} from '../../../lib/coach-retention';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const auth=await ownerIdentity(request),reply=(b:unknown,s=200)=>accountReply(b,s,auth.headers);if(!auth.owner)return reply({error:'Owner sign-in and authenticator verification required.'},403);
 const params=new URL(request.url).searchParams;
 if(params.get('mode')==='preview')return reply({fingerprint:await fingerprint(await metadata())});
 // The site keeps the last 10 recovery snapshots (each saved in parts, issue #46).
 if(params.get('mode')==='snapshots'){const rows=await env.DB!.prepare(SNAPSHOT_LIST).all();return reply({snapshots:rows.results})}
 if(params.has('snapshot')){const id=params.get('snapshot')!;const backup=/^[A-Za-z0-9-]{1,80}$/.test(id)?await readSnapshot(id):null;return backup?reply({backup}):reply({error:'Recovery snapshot not found.'},404)}
 try{const backup=await readBackup();await securityEvent(auth.user!.id,'backup_exported');return reply({backup})}catch(e){
  // Never a partial file: a backup that is too big for one download says so.
  if(e instanceof BackupTooLarge)return reply({error:`The academy's records are too large for one backup download (${e.what}). No records were changed. Ask whoever maintains the site for a full database export.`},507);
  return reply({error:'Backup export could not finish. No records were changed.'},502)}
}
export async function POST(request:Request){
 const auth=await ownerIdentity(request),reply=(b:unknown,s=200)=>accountReply(b,s,auth.headers);if(!auth.owner)return reply({error:'Owner sign-in and authenticator verification required.'},403);
 if(!sameOrigin(request))return reply({error:'Invalid request origin.'},403);
 if(!request.headers.get('content-type')?.includes('application/json'))return reply({error:'JSON required.'},415);
 const raw=await request.text();if(raw.length>13000000)return reply({error:'Backup is too large.'},413);let input;try{input=JSON.parse(raw)}catch{return reply({error:'Invalid backup.'},400)}
 if(input?.action!=='restore'||typeof input.fingerprint!=='string'||!validBackup(input.backup))return reply({error:'This is not a supported backup for this academy.'},400);
 try{const result=await restoreBackup(input.backup,input.fingerprint,auth.user!.id);if(!result)return reply({error:'Records changed after preview. Preview the backup again before restoring.'},409);
  // A file can bring back records of a coach removed more than 3 years ago (#212): clean them again straight away. If
  // this does not finish, the daily job does.
  try{await cleanupRemovedCoaches({maxStatements:400})}catch{}
  return reply({ok:true,restored:result.restored})}catch{return reply({error:'Restore could not finish or records changed during the restore. No partial restore was applied. Preview again before retrying.'},409)}
}
