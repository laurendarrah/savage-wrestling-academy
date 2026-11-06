import {env} from 'cloudflare:workers';
import {ownerIdentity,accountReply,sameOrigin,APP_ORIGIN} from '../../../lib/account-auth';
import {boundedBody} from '../../../lib/coach-profile';
import {idValid,validTemplate,versionHash,type DocumentTemplate} from '../../../lib/documents';
import {securityEvent} from '../../../lib/security-events';
import type {FamilyProfile} from '../../../lib/family-records';
import {parentConsentId,parentConsentTitle,parentConsentBody} from '../../../lib/parent-consent';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const auth=await ownerIdentity(request),reply=(b:unknown,s=200)=>accountReply(b,s,auth.headers);if(!auth.owner)return reply({error:'Owner access and authenticator verification required.'},403);
 const u=new URL(request.url),id=u.searchParams.get('id');
 if(id){if(!idValid(id))return reply({error:'Document not found.'},404);const template=await env.DB!.prepare('SELECT * FROM document_templates WHERE id=?').bind(id).first();if(!template)return reply({error:'Document not found.'},404);const versions=await env.DB!.prepare('SELECT id,version,source_revision,published_at FROM document_versions WHERE template_id=? ORDER BY version DESC LIMIT 100').bind(id).all();return reply({template,versions:versions.results})}
 if(u.searchParams.get('mode')==='family'){
  const userId=u.searchParams.get('family'),offset=Number(u.searchParams.get('offset')||0);
  if(!idValid(userId)||!Number.isSafeInteger(offset)||offset<0||offset>100000)return reply({error:'Choose a saved family and valid page.'},400);
  const db=env.DB!;
  const [account,records,available]=await db.batch([
   db.prepare('SELECT email,payload FROM family_accounts WHERE user_id=?').bind(userId),
   db.prepare(`SELECT a.id,a.wrestler_name,a.status,a.assigned_at,a.signed_at,a.signer,v.title,v.kind,v.version
    FROM document_assignments a JOIN document_versions v ON v.id=a.version_id
    WHERE a.user_id=? ORDER BY a.status='pending' DESC,a.assigned_at DESC,a.id DESC LIMIT 51 OFFSET ?`).bind(userId,offset),
   db.prepare(`SELECT v.id,v.title,v.kind,v.version,
    (SELECT json_group_array(a.wrestler_id) FROM document_assignments a
     WHERE a.user_id=? AND a.version_id=v.id AND a.status IN ('signed','pending')) AS assigned
    FROM document_templates t JOIN document_versions v ON v.template_id=t.id
    WHERE t.archived=0 AND t.id<>'swa-test-waiver' AND v.version=(SELECT MAX(latest.version) FROM document_versions latest WHERE latest.template_id=t.id)
    ORDER BY v.kind DESC,v.title COLLATE NOCASE,v.id LIMIT 501`).bind(userId)
  ]);
  const f=account.results[0] as {email:string;payload:string}|undefined;
  if(!f)return reply({error:'Saved family not found.'},404);
  const profile=JSON.parse(f.payload) as FamilyProfile;
  const templates=(available.results as {id:string;title:string;kind:string;version:number;assigned:string}[])
   .slice(0,500).map(v=>({...v,assigned:JSON.parse(v.assigned) as string[]}));
  return reply({email:f.email,parentName:profile.parentName,wrestlers:profile.wrestlers.map(({id,name,grade})=>({id,name,grade})),records:records.results.slice(0,50),
   hasMore:records.results.length>50,templates,moreTemplates:available.results.length>500});
 }
 if(u.searchParams.get('mode')==='records'){
 const q=(u.searchParams.get('q')||'').slice(0,120),status=u.searchParams.get('status')||'all',offset=Number(u.searchParams.get('offset')||0);if(!['all','pending','signed','void'].includes(status)||!Number.isSafeInteger(offset)||offset<0||offset>100000)return reply({error:'Invalid filter.'},400);

 const rows=await env.DB!.prepare(`SELECT a.id,a.family_email,a.parent_name,a.wrestler_name,a.status,a.assigned_at,a.signer,a.signed_at,v.title,v.kind,v.version FROM document_assignments a JOIN document_versions v ON v.id=a.version_id WHERE (?='all' OR a.status=?) AND (?='' OR instr(lower(a.family_email),lower(?))>0 OR instr(lower(a.parent_name),lower(?))>0 OR instr(lower(a.wrestler_name),lower(?))>0 OR instr(lower(v.title),lower(?))>0) ORDER BY a.assigned_at DESC,a.id DESC LIMIT 51 OFFSET ?`).bind(status,status,q,q,q,q,q,offset).all();
 const scholarships=await env.DB!.prepare(`SELECT id,wrestler_name,recipient_email,signer,accepted_at,status FROM scholarship_awards WHERE accepted_at IS NOT NULL AND (?='' OR instr(lower(recipient_email),lower(?))>0 OR instr(lower(wrestler_name),lower(?))>0) ORDER BY accepted_at DESC LIMIT 50`).bind(q,q,q).all();
 return reply({records:rows.results.slice(0,50),hasMore:rows.results.length>50,scholarships:scholarships.results});
 }
 const templates=await env.DB!.prepare("SELECT t.id,t.title,t.kind,t.revision,t.archived,t.updated_at,v.id AS version_id,v.version,v.source_revision FROM document_templates t LEFT JOIN document_versions v ON v.template_id=t.id AND v.version=(SELECT MAX(version) FROM document_versions WHERE template_id=t.id) WHERE t.id<>'swa-test-waiver' ORDER BY t.updated_at DESC LIMIT 501").all();
 const families=await env.DB!.prepare('SELECT user_id,email,payload FROM family_accounts ORDER BY email LIMIT 501').all<{user_id:string;email:string;payload:string}>();
 return reply({templates:templates.results.slice(0,500),families:families.results.slice(0,500).map(f=>{
  const {parentName,phone,wrestlers}=JSON.parse(f.payload) as FamilyProfile;
  return {userId:f.user_id,email:f.email,parentName,phone,wrestlers:wrestlers.map(({id,name,grade})=>({id,name,grade}))};
 }),truncated:templates.results.length>500||families.results.length>500});
}
export async function POST(request:Request){
 const auth=await ownerIdentity(request),reply=(b:unknown,s=200)=>accountReply(b,s,auth.headers);if(!auth.owner)return reply({error:'Owner access and authenticator verification required.'},403);
 if(!sameOrigin(request))return reply({error:'Invalid request origin.'},403);if(!request.headers.get('content-type')?.includes('application/json'))return reply({error:'JSON required.'},415);
 const raw=await boundedBody(request,140000);if(!raw)return reply({error:'Document too large.'},413);let input;try{input=JSON.parse(new TextDecoder().decode(raw))}catch{return reply({error:'Invalid request.'},400)}
 const now=new Date().toISOString(),actor=auth.owner.userId;
 if(input?.action==='ensure-parent-consent'){
 // A stable ID adds the draft once. Later edits, archives and published versions are never overwritten.
 const created=await env.DB!.prepare("INSERT INTO document_templates(id,title,kind,body,revision,archived,created_at,updated_at) SELECT ?,?,'waiver',?,1,0,?,? WHERE NOT EXISTS (SELECT 1 FROM document_templates WHERE id=?) RETURNING id").bind(parentConsentId,parentConsentTitle,parentConsentBody,now,now,parentConsentId).first();
 if(created)await securityEvent(actor,'parent_consent_draft_added',parentConsentId);
 return reply({id:parentConsentId,created:!!created});
 }
 if(input?.action==='create'){
 if(!validTemplate(input))return reply({error:'Enter a title, document type and text up to 30,000 characters.'},400);
 const id=crypto.randomUUID();await env.DB!.prepare('INSERT INTO document_templates(id,title,kind,body,revision,archived,created_at,updated_at) VALUES (?,?,?,?,1,0,?,?)').bind(id,input.title.trim(),input.kind,input.body.trim(),now,now).run();await securityEvent(actor,'document_draft_created',id);return reply({id,revision:1});
 }
 if(input?.action==='assign'){
 if(!idValid(input.versionId)||!idValid(input.userId)||!idValid(input.wrestlerId))return reply({error:'Choose a published document, a parent or guardian’s family account, and the wrestler covered by the form.'},400);
 const version=await env.DB!.prepare('SELECT v.id FROM document_versions v JOIN document_templates t ON t.id=v.template_id WHERE v.id=? AND t.archived=0').bind(input.versionId).first();if(!version)return reply({error:'Publish the document and keep it active before assigning.'},409);
 const f=await env.DB!.prepare('SELECT email,payload,revision FROM family_accounts WHERE user_id=?').bind(input.userId).first<{email:string;payload:string;revision:number}>();const profile:FamilyProfile|null=f?JSON.parse(f.payload):null,w=profile?.wrestlers.find(w=>w.id===input.wrestlerId);if(!f||!w)return reply({error:'Choose a wrestler from a saved family profile.'},400);
 const id=crypto.randomUUID();try{const saved=await env.DB!.prepare("INSERT INTO document_assignments(id,version_id,user_id,family_email,parent_name,wrestler_id,wrestler_name,wrestler_grade,status,assigned_at,assigned_by) SELECT ?,?,?,?,?,?,?,?,'pending',?,? WHERE EXISTS (SELECT 1 FROM family_accounts WHERE user_id=? AND revision=?) AND EXISTS (SELECT 1 FROM document_versions v JOIN document_templates t ON t.id=v.template_id WHERE v.id=? AND t.archived=0) RETURNING id").bind(id,input.versionId,input.userId,f.email,profile!.parentName,w.id,w.name,w.grade,now,actor,input.userId,f.revision,input.versionId).first();if(!saved)return reply({error:'The family or document changed. Reload before assigning.'},409)}catch{return reply({error:'A request or signed copy already exists for this wrestler and document version. Check Family records.'},409)}
 await securityEvent(actor,'document_assigned',id);return reply({id,url:APP_ORIGIN+'/document-sign?id='+id});
 }
 if(input?.action==='void'){
 if(!idValid(input.id))return reply({error:'Choose an assignment.'},400);const row=await env.DB!.prepare("UPDATE document_assignments SET status='void' WHERE id=? AND status='pending' RETURNING id").bind(input.id).first();if(!row)return reply({error:'Only a pending request can be withdrawn. Signed records are preserved.'},409);await securityEvent(actor,'document_request_withdrawn',input.id);return reply({ok:true});
 }
 if(!idValid(input?.id)||input.id==='swa-test-waiver'||!Number.isSafeInteger(input.revision)||input.revision<1)return reply({error:'Choose a current draft.'},400);
 const draft=await env.DB!.prepare('SELECT * FROM document_templates WHERE id=?').bind(input.id).first<DocumentTemplate>();if(!draft)return reply({error:'Document not found.'},404);if(draft.revision!==input.revision)return reply({error:'This draft changed. Reload it before continuing.'},409);
 if(input.action==='save'){
 if(!validTemplate(input))return reply({error:'Enter a title, document type and text up to 30,000 characters.'},400);
 const row=await env.DB!.prepare('UPDATE document_templates SET title=?,kind=?,body=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? RETURNING revision').bind(input.title.trim(),input.kind,input.body.trim(),now,input.id,input.revision).first();if(!row)return reply({error:'This draft changed. Reload it before saving.'},409);await securityEvent(actor,'document_draft_saved',input.id);return reply(row);
 }
 if(input.action==='archive'||input.action==='unarchive'){
 const row=await env.DB!.prepare('UPDATE document_templates SET archived=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? RETURNING revision').bind(input.action==='archive'?1:0,now,input.id,input.revision).first();if(!row)return reply({error:'This draft changed. Reload it.'},409);await securityEvent(actor,'document_'+input.action,input.id);return reply(row);
 }
 if(input.action==='publish'){
 if(draft.archived)return reply({error:'Restore this template before publishing.'},409);
 const id=crypto.randomUUID(),hash=await versionHash(draft);
 try{const row=await env.DB!.prepare('INSERT INTO document_versions(id,template_id,version,source_revision,title,kind,body,body_hash,published_at,published_by) SELECT ?,id,(SELECT COALESCE(MAX(version),0)+1 FROM document_versions WHERE template_id=?),revision,title,kind,body,?,?,? FROM document_templates WHERE id=? AND revision=? AND archived=0 RETURNING id,version').bind(id,draft.id,hash,now,actor,draft.id,draft.revision).first();if(!row)return reply({error:'This draft changed. Reload before publishing.'},409);await securityEvent(actor,'document_version_published',id);return reply(row)}catch{return reply({error:'This draft revision is already published. Save changes before publishing a new version.'},409)}
 }
 return reply({error:'Choose a valid action.'},400);
}
