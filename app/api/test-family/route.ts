import {env} from 'cloudflare:workers';
import {accountReply,ownerIdentity,sameOrigin} from '../../../lib/account-auth';
import {idValid,versionHash} from '../../../lib/documents';
import {emptyFamily,validFamily,type FamilyProfile} from '../../../lib/family-records';
import {programDetails} from '../../../lib/program-names';
import {testFamilyParentName,testWrestlers,testWaiverTemplateId as templateId} from '../../../lib/test-family';

export const dynamic='force-dynamic';
export async function POST(request:Request){
 const auth=await ownerIdentity(request),reply=(body:unknown,status=200)=>accountReply(body,status,auth.headers);
 if(!auth.owner||!sameOrigin(request))return reply({error:'Verified owner access is required.'},403);
 const user=auth.user!,db=env.DB!,now=new Date().toISOString(),actor=auth.owner.userId;
 const raw=await request.text();
 if(raw.length>512)return reply({error:'Request too large.'},413);
 let selection:unknown;
 try{selection=JSON.parse(raw)?.selection}catch{return reply({error:'Choose your saved Parent Consent Form.'},400)}
 if(typeof selection!=='string')return reply({error:'Choose your saved Parent Consent Form.'},400);
 const parts=selection.split(':'),[source,id,revision]=parts;
 if(!idValid(id)||!(source==='published'&&parts.length===2||
  source==='draft'&&parts.length===3&&Number.isSafeInteger(Number(revision))&&Number(revision)>0))return reply({error:'Choose a saved waiver to test.'},400);
 const consent=await (source==='published'?
  db.prepare(`SELECT title,body FROM document_versions WHERE id=? AND kind='waiver' AND template_id<>?`).bind(id,templateId):
  db.prepare(`SELECT title,body FROM document_templates WHERE id=? AND kind='waiver' AND id<>? AND revision=?`).bind(id,templateId,Number(revision))
 ).first<{title:string;body:string}>();
 if(!consent)return reply({error:'That version is unavailable or the draft changed. Reload Families and select it again.'},409);
 const row=await db.prepare('SELECT payload,revision FROM family_accounts WHERE user_id=?')
  .bind(user.id).first<{payload:string;revision:number}>();
 const profile:FamilyProfile=row?JSON.parse(row.payload):{...emptyFamily(),parentName:testFamilyParentName};
 const existing=profile.wrestlers.filter(w=>!testWrestlers.some(sample=>sample.id===w.id));
 const sampleWrestlers=testWrestlers.map(({id,name,grade})=>({id,name,grade}));
 const payload={...profile,wrestlers:[...existing,...sampleWrestlers]};
 if(!validFamily(payload))return reply({error:'Your family profile needs room for three additional test wrestlers.'},409);
 const nextRevision=(row?.revision??0)+1,serialized=JSON.stringify(payload);
 const saved=row?db.prepare(`UPDATE family_accounts SET payload=?,revision=?,updated_at=?
  WHERE user_id=? AND revision=? RETURNING revision`).bind(serialized,nextRevision,now,user.id,row.revision):
  db.prepare(`INSERT INTO family_accounts (user_id,email,payload,revision,updated_at)
   VALUES (?,?,?,1,?) ON CONFLICT(user_id) DO NOTHING RETURNING revision`).bind(user.id,user.email!,serialized,now);
 // Only create enrollments and signing requests if the profile write in this batch succeeded.
 const current='EXISTS (SELECT 1 FROM family_accounts WHERE user_id=? AND revision=? AND updated_at=?)';
 const waiver={title:'TEST — '+consent.title,kind:'waiver',
  body:'TEST COPY — For checking the signing workflow only. Signing this copy does not give consent for an actual wrestler.\n\n'+consent.body};
 const hash=await versionHash(waiver),versionId='swa-test-'+hash;

 const [result]=await db.batch([
  saved,
  db.prepare(`INSERT INTO document_templates (id,title,kind,body,revision,archived,created_at,updated_at)
   VALUES (?,?,?,?,1,1,?,?) ON CONFLICT(id) DO NOTHING`).bind(templateId,waiver.title,waiver.kind,waiver.body,now,now),
  db.prepare(`INSERT INTO document_versions (id,template_id,version,source_revision,title,kind,body,body_hash,published_at,published_by)
   SELECT ?,?,next_version,next_version,?,?,?,?,?,? FROM
   (SELECT COALESCE(MAX(version),0)+1 AS next_version FROM document_versions WHERE template_id=?)
   WHERE 1 ON CONFLICT(id) DO NOTHING`).bind(versionId,templateId,waiver.title,waiver.kind,waiver.body,hash,now,actor,templateId),
  db.prepare(`UPDATE document_assignments SET status='void' WHERE user_id=? AND status='pending' AND version_id<>?
   AND version_id IN (SELECT id FROM document_versions WHERE template_id=?) AND ${current}`)
   .bind(user.id,versionId,templateId,user.id,nextRevision,now),
  ...testWrestlers.flatMap(w=>[
   db.prepare(`INSERT INTO program_enrollments (id,user_id,wrestler_id,program,kind,starts_on,ends_on,created_at,created_by)
    SELECT ?,?,?,?,'membership','2000-01-01','2099-12-31',?,? WHERE ${current} ON CONFLICT(id) DO NOTHING`)
    .bind(user.id+'-'+w.id,user.id,w.id,w.program,now,actor,user.id,nextRevision,now),
   db.prepare(`INSERT INTO document_assignments
    (id,version_id,user_id,family_email,parent_name,wrestler_id,wrestler_name,wrestler_grade,status,assigned_at,assigned_by)
    SELECT ?,?,?,?,?,?,?,?,'pending',?,? WHERE ${current} ON CONFLICT DO NOTHING`)
    .bind(crypto.randomUUID(),versionId,user.id,user.email!,profile.parentName,w.id,w.name,w.grade,now,actor,user.id,nextRevision,now)
  ])
 ]);
 if(!result.results.length)return reply({error:'Your family profile changed. Try creating the test family again.'},409);
 const rows=await db.prepare(`SELECT id,wrestler_id,status FROM document_assignments
  WHERE user_id=? AND version_id=? AND status IN ('pending','signed')`).bind(user.id,versionId).all<{id:string;wrestler_id:string;status:string}>();
 return reply({formTitle:consent.title,wrestlers:testWrestlers.map(w=>({...w,programName:programDetails[w.program].name,waiver:rows.results.find(r=>r.wrestler_id===w.id)}))});
}
