import {env} from 'cloudflare:workers';
import {accountReply,ownerIdentity,sameOrigin} from '../../../lib/account-auth';
import {idValid} from '../../../lib/documents';
import type {FamilyProfile} from '../../../lib/family-records';
import {deleteUsaCardPhoto} from '../../../lib/usa-card';
import {testWaiverTemplateId} from '../../../lib/test-family';

export const dynamic='force-dynamic';

export async function POST(request:Request){
 const auth=await ownerIdentity(request),reply=(body:unknown,status=200)=>accountReply(body,status,auth.headers);
 if(!auth.owner||!sameOrigin(request))return reply({error:'Verified owner access is required.'},403);
 if(!request.headers.get('content-type')?.includes('application/json'))return reply({error:'JSON required.'},415);
 const raw=await request.text();
 if(raw.length>1024)return reply({error:'Request too large.'},413);
 let input;
 try{input=JSON.parse(raw)}catch{return reply({error:'Invalid request.'},400)}
 if(input?.confirmation!=='DELETE'||!idValid(input.userId)||!(input.wrestlerId===null||idValid(input.wrestlerId))||
  !Number.isSafeInteger(input.revision)||input.revision<1||typeof input.updatedAt!=='string'||input.updatedAt.length>80)return reply({error:'Choose a test family or wrestler and type DELETE to confirm.'},400);
 const {userId,wrestlerId,revision,updatedAt}=input;
 const db=env.DB!,now=new Date().toISOString(),auditId=crypto.randomUUID();
 const row=await db.prepare('SELECT payload FROM family_accounts WHERE user_id=? AND revision=? AND updated_at=?').bind(userId,revision,updatedAt).first<{payload:string}>();
 if(!row)return reply({error:'The family profile changed. Reload Families and try again.'},409);
 const profile=JSON.parse(row.payload) as FamilyProfile;
 if(wrestlerId&&!profile.wrestlers.some(w=>w.id===wrestlerId))return reply({error:'This wrestler is no longer in the family profile.'},404);

 const scope='user_id=? AND (? IS NULL OR wrestler_id=?)';
 const target=[userId,wrestlerId,wrestlerId] as const;
 // Authorize the whole batch against the latest profile and active scholarships. The audit ID gates every write.
 const authorized='EXISTS (SELECT 1 FROM security_events WHERE id=?)';
 const remove=(table:string)=>db.prepare(`DELETE FROM ${table} WHERE ${scope} AND ${authorized}`).bind(...target,auditId);
 const [allowed,cards]=await db.batch([
  db.prepare(`INSERT INTO security_events(id,actor,action,target,created_at)
   SELECT ?,?,?,?,? FROM family_accounts WHERE user_id=? AND revision=? AND updated_at=?
    AND NOT EXISTS(SELECT 1 FROM scholarship_awards WHERE ${scope} AND status='active')
   RETURNING id`)
   .bind(auditId,auth.owner.userId,wrestlerId?'test_wrestler_deleted':'test_family_deleted',wrestlerId?userId+':'+wrestlerId:userId,now,
    userId,revision,updatedAt,...target),
  db.prepare(`DELETE FROM wrestler_membership_cards WHERE ${scope} AND ${authorized} RETURNING photo_key`).bind(...target,auditId),
  db.prepare(`DELETE FROM approval_messages WHERE approval_id IN
   (SELECT id FROM program_approvals WHERE ${scope}) AND ${authorized}`).bind(...target,auditId),
  remove('program_approvals'),
  db.prepare(`DELETE FROM document_assignments WHERE ${scope} AND ${authorized}
   AND (status<>'signed' OR version_id IN (SELECT id FROM document_versions WHERE template_id=?))`)
   .bind(...target,auditId,testWaiverTemplateId),
  remove('attendance_checkins'),
  remove('wrestler_passes'),
  remove('program_enrollments'),
  wrestlerId?db.prepare(`UPDATE family_accounts SET payload=?,revision=revision+1,updated_at=?
   WHERE user_id=? AND ${authorized}`).bind(JSON.stringify({...profile,wrestlers:profile.wrestlers.filter(w=>w.id!==wrestlerId)}),now,userId,auditId):
   db.prepare(`DELETE FROM family_accounts WHERE user_id=? AND ${authorized}`).bind(userId,auditId)
 ]);
 if(!allowed.results.length){
  const scholarship=await db.prepare(`SELECT 1 FROM scholarship_awards WHERE ${scope} AND status='active' LIMIT 1`)
   .bind(...target).first();
  return reply({error:scholarship?'This profile has an active scholarship. End it in Scholarships before deleting the test profile.':'The family profile changed. Reload Families and try again.'},409);
 }
 await Promise.all((cards.results as {photo_key:string}[]).map(card=>deleteUsaCardPhoto(card.photo_key)));
 return reply({message:wrestlerId?'Test wrestler deleted.':'Test family profile deleted.'});
}
