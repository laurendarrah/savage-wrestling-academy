import {env} from 'cloudflare:workers';
import {ownerWorkspaceMarkup,ownerWorkspacePanel} from '../../lib/owner-workspace';
import {ownerIdentity} from '../../lib/account-auth';
import {escapeHtml as escape} from '../../lib/documents';
import {programDetails,upgradeProgramNames} from '../../lib/program-names';
import {isTestWrestler,sampleFamilies,testWaiverTemplateId} from '../../lib/test-family';
import type {FamilyProfile} from '../../lib/family-records';
import {usaCardRenewalThrough} from '../../lib/usa-card';
import {attendanceToday} from '../../lib/program-attendance';

export const dynamic='force-dynamic';
const programs=['Elementary','Intermediate','Advanced'];
const pageSize=50;
type FamilyRow={user_id:string;email:string;payload:string;revision:number;updated_at:string;enrollments:string};
const birthDateLabel=(value:string)=>new Date(value+'T12:00:00Z').toLocaleDateString('en-US',{timeZone:'UTC',dateStyle:'long'});
function familyDetails(family:FamilyProfile,email:string,userId:string){
 const locality=[family.homeCity,[family.homeState,family.homeZip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
 const address=[family.homeAddress,locality].filter(Boolean).join('\n');
 const emergency=[family.emergencyContactName,family.emergencyContactPhone].filter(Boolean).join(' · ');
 const field=(label:string,value:string|undefined)=>`<p><strong>${label}:</strong> ${escape(value||'Not provided')}</p>`;
 return `<details class="family-documents"><summary>Family details</summary>
  ${field('Parent / guardian',family.parentName)}${field('Account email',email)}${field('Phone',family.phone)}
  ${field('Home address',address)}${field('Emergency contact',emergency)}
  ${family.wrestlers.map(w=>`<div class="wrestler-details"><h3>${escape(w.name)} · ${w.grade==='Adult'?'Adult':'Grade '+escape(w.grade)}</h3>
   ${field('Date of birth',w.birthDate?birthDateLabel(w.birthDate):undefined)}
   ${field('Allergies and safety notes',w.allergies)}${isTestWrestler(w.id)?'':`<p><a href="/usa-card?account=${encodeURIComponent(userId)}&amp;wrestler=${encodeURIComponent(w.id)}">Review USA Wrestling card →</a></p>`}</div>`).join('')}
 </details>`;
}
type Enrollment={wrestlerId:string;program:string;kind:string;date:string|null};

export async function GET(request:Request){
 const auth=await ownerIdentity(request);
 if(!auth.owner){
  auth.headers.set('Location',auth.mfaRequired?'/security':auth.user?'/family':'/login');
  return new Response(null,{status:303,headers:auth.headers});
 }
 const query=new URL(request.url).searchParams,requested=query.get('program')??'all';
 const filter=[...programs,'none'].includes(requested)?requested:'all';
 const requestedPage=Number(query.get('page')??1);
 const page=Number.isSafeInteger(requestedPage)&&requestedPage>=1&&requestedPage<=10000?requestedPage:1;

 const active=`FROM active a WHERE a.user_id=f.user_id
  AND a.program IN ('Elementary','Intermediate','Advanced')
  AND EXISTS(SELECT 1 FROM json_each(f.payload,'$.wrestlers') w WHERE json_extract(w.value,'$.id')=a.wrestler_id)`;
 const where=filter==='all'?'':filter==='none'?`WHERE NOT EXISTS(SELECT 1 ${active})`:`WHERE EXISTS(SELECT 1 ${active} AND a.program=?)`;
 const today=attendanceToday();
 const [families,settings,templates,renewals]=await env.DB!.batch([
  env.DB!.prepare(`WITH active AS (
   SELECT user_id,wrestler_id,program,'Scholarship' AS kind,NULL AS date FROM scholarship_awards WHERE status='active'
   UNION ALL
   SELECT user_id,wrestler_id,program,CASE kind WHEN 'walkin' THEN 'Walk-in' ELSE 'Membership' END,starts_on
   FROM program_enrollments WHERE voided_at IS NULL AND ends_on>=?
  ) SELECT f.user_id,f.email,f.payload,f.revision,f.updated_at,
   (SELECT json_group_array(json_object('wrestlerId',a.wrestler_id,'program',a.program,'kind',a.kind,'date',a.date)) ${active}) AS enrollments
   FROM family_accounts f ${where} ORDER BY f.updated_at DESC,f.user_id LIMIT ? OFFSET ?`)
   .bind(today,...(programs.includes(filter)?[filter]:[]),pageSize+1,(page-1)*pageSize),
  env.DB!.prepare("SELECT payload FROM academy_state WHERE id='academy'"),
  env.DB!.prepare(`SELECT t.id,t.title,t.revision,t.kind,v.id AS version_id,v.title AS version_title,v.kind AS version_kind,v.version,v.source_revision
   FROM document_templates t LEFT JOIN document_versions v ON v.template_id=t.id AND v.version=
    (SELECT MAX(version) FROM document_versions WHERE template_id=t.id)
   WHERE t.id<>? AND (t.kind='waiver' OR v.kind='waiver')
   ORDER BY (lower(t.title) LIKE '%parent%consent%') DESC,t.updated_at DESC LIMIT 200`).bind(testWaiverTemplateId),
  env.DB!.prepare(`SELECT c.user_id,c.wrestler_id,c.expires_on,json_extract(w.value,'$.name') AS wrestler_name
   FROM wrestler_membership_cards c JOIN family_accounts f ON f.user_id=c.user_id
   JOIN json_each(f.payload,'$.wrestlers') w ON json_extract(w.value,'$.id')=c.wrestler_id
   WHERE c.verified_at IS NOT NULL AND c.expires_on BETWEEN ? AND ? ORDER BY c.expires_on,wrestler_name,c.user_id LIMIT 501`)
   .bind(today,usaCardRenewalThrough(today))
 ]);
 const savedSettings=settings.results[0] as {payload:string}|undefined;
 const configured=savedSettings?upgradeProgramNames(JSON.parse(savedSettings.payload))?.programs:null;
 const names=Object.fromEntries(programs.map(id=>[id,(Array.isArray(configured)?configured.find((item:{id:string})=>item.id===id)?.name:null)||programDetails[id].name]));
 const options=[['all','All families'],...programs.map(id=>[id,names[id]]),['none','No current or upcoming signup']]
  .map(([id,label])=>`<option value="${id}"${id===filter?' selected':''}>${escape(label)}</option>`).join('');
 const forms=(templates.results as {
  id:string;title:string;revision:number;kind:string;version_id:string|null;version_title:string|null;version_kind:string|null;version:number|null;source_revision:number|null;
 }[]).flatMap(t=>[
  ...(t.version_id&&t.version_title&&t.version_kind==='waiver'?[{value:'published:'+t.version_id,title:t.version_title,label:'Published v'+t.version}]:[]),
  ...(t.kind==='waiver'&&t.revision!==t.source_revision?[{value:'draft:'+t.id+':'+t.revision,title:t.title,label:'Saved draft'}]:[])
 ]);
 const consentForms=forms.filter(form=>/parent.*consent/i.test(form.title));
 const defaultForm=consentForms.length===1?consentForms[0].value:'';
 const formOptions=forms.map(form=>`<option value="${escape(form.value)}"${form.value===defaultForm?' selected':''}>${escape(form.title)} · ${form.label}</option>`).join('');
 const samples=sampleFamilies.filter(sample=>filter==='all'||sample.wrestler.program===filter);
 const renewalRows=renewals.results as {user_id:string;wrestler_id:string;expires_on:string;wrestler_name:string}[];
 const renewalLinks=renewalRows.slice(0,500).map(r=>`<li><strong>${escape(r.wrestler_name)}</strong> · Expires ${escape(birthDateLabel(r.expires_on))}
  · <a href="/usa-card?account=${encodeURIComponent(r.user_id)}&amp;wrestler=${encodeURIComponent(r.wrestler_id)}">Review card or open reminder email</a></li>`).join('');
 const sampleRows=samples.map(({slug,parentName,wrestler})=>`<article class="sample-family-card">
  <h3>${escape(parentName)} family</h3>
  <p><strong>${escape(wrestler.name)}</strong> · Grade ${escape(wrestler.grade)} <span class="tag active">${escape(names[wrestler.program])} · Test enrollment</span></p>
  <a href="/family?sample=${slug}">Preview family account →</a>
 </article>`).join('');
 const data=families.results as FamilyRow[];
 const rows=data.slice(0,pageSize).map(row=>{
  const family=JSON.parse(row.payload) as FamilyProfile;
  const enrollments=(JSON.parse(row.enrollments) as Enrollment[]).filter(e=>!programs.includes(filter)||e.program===filter);
  const wrestlers=programs.includes(filter)?family.wrestlers.filter(w=>enrollments.some(e=>e.wrestlerId===w.id)):family.wrestlers;
  return `<article><h2>${escape(family.parentName||row.email)}</h2><p>${escape(row.email)}${family.phone?' · '+escape(family.phone):''}</p>
   ${wrestlers.length?`<ul class="wrestlers">${wrestlers.map(w=>{
    const matches=enrollments.filter(e=>e.wrestlerId===w.id);
    return `<li><strong>${escape(w.name)}</strong> · ${w.grade==='Adult'?'Adult':'Grade '+escape(w.grade)}
    ${matches.length?matches.map(e=>`<span class="tag active">${escape(names[e.program])} · ${isTestWrestler(w.id)?'Test enrollment':e.kind}${e.kind==='Walk-in'||(e.kind==='Membership'&&e.date&&e.date>today)?' · '+escape(e.date):''}</span>`).join(''):'<span class="tag">No current or upcoming signup</span>'}
    ${isTestWrestler(w.id)?'<a href="/attendance?test=1">Test attendance</a>':`<a href="/attendance?account=${encodeURIComponent(row.user_id)}&amp;wrestler=${encodeURIComponent(w.id)}">Record confirmed signup</a>`}</li>`;
   }).join('')}</ul>`:'<p>No wrestlers added.</p>'}
   <small>Profile saved: ${escape(row.updated_at)}</small>
   ${familyDetails({...family,wrestlers},row.email,row.user_id)}
   <details class="family-documents" data-family="${escape(row.user_id)}">
    <summary>Waivers &amp; contracts <span class="sr-only">for ${escape(family.parentName||row.email)}</span></summary>
    <div class="document-panel"></div><noscript><p><a href="/documents?q=${encodeURIComponent(row.email)}">Open family document records</a></p></noscript>
   </details>
   <details class="family-documents"><summary>Delete test data</summary>
    <form class="test-cleanup" data-family-id="${escape(row.user_id)}" data-revision="${row.revision}" data-updated-at="${escape(row.updated_at)}">
     <p>Only use this for test records. Deleting a profile also removes its related test data. Signed academy documents stay on file. An active scholarship must be ended before its profile can be removed.</p>
     <label>Delete<select name="target" required><option value="">Choose a test record</option>
      <option value="family">Entire family profile and its wrestlers</option>
      ${wrestlers.map(w=>`<option value="wrestler:${escape(w.id)}">Wrestler: ${escape(w.name)}</option>`).join('')}
     </select></label>
     <label>Type DELETE to confirm <input name="confirmation" autocomplete="off" maxlength="6" pattern="DELETE" required></label>
     <button type="submit">Delete test record</button>
     <p role="status"></p>
    </form>
   </details></article>`;
 }).join('');
 const pageLink=(pageNumber:number)=>`/accounts?program=${encodeURIComponent(filter)}&amp;page=${pageNumber}`;
 const empty=filter==='all'&&page===1?'No family profiles have been saved yet.':'No families match this program filter on this page.';
 auth.headers.set('Content-Type','text/html; charset=utf-8');
 return ownerWorkspacePanel(request,new Response(ownerWorkspaceMarkup(request,`<!doctype html><html lang="en"><head><script defer src="/navigation.js"></script><script defer src="/family-waivers.js"></script><script defer src="/test-family.js"></script><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Family accounts | Savage</title>
 <style>
 body{font:15px Arial;line-height:1.6;color:#18191c;background:#f5f5f6;margin:0}
 main{max-width:850px;margin:auto;padding:24px}
 article,form{background:white;border:1px solid #ddd;padding:20px;border-radius:10px;margin:18px 0}
 a{color:#a92330}small,.muted{color:#62656e}
 form,.pages{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
 select,button,input{font:inherit;min-height:44px;padding:8px 12px;border:1px solid #aaa;border-radius:6px}
 button{background:#b72332;color:white;border-color:#b72332;cursor:pointer;font-weight:700}
 .wrestlers{padding-left:20px}.wrestlers li{margin:8px 0}
 .tag{display:inline-block;background:#eeeef1;border-radius:4px;font-size:.83rem;margin-left:4px;padding:2px 7px}
 .tag.active{background:#e3f2e8;color:#17552f}
 .sample-family-card{border-left:4px solid #b72332}.sample-family-card h3{margin:0}
 .tag.pending{background:#fff0ca;color:#795200}
 .family-documents>p,.wrestler-details p{white-space:pre-wrap;overflow-wrap:anywhere}.wrestler-details h3{margin-bottom:0}
 .family-documents{border-top:1px solid #ddd;margin-top:16px;padding-top:10px}
 summary{font-weight:bold;cursor:pointer;padding:8px 0}
 .test-cleanup{border:0;padding:0}.test-cleanup p{flex-basis:100%;margin:0}.test-cleanup select{max-width:100%}
 .document-panel form{border:0;padding:0}.document-panel h3{margin-bottom:6px}.document-panel ul{padding-left:20px}.document-panel li{margin-bottom:12px}
 .document-actions,.directory-links{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
 .document-actions button,.document-panel button.secondary{background:white;color:#a92330}
 .request-fields{width:100%;display:flex;gap:12px;flex-wrap:wrap}.request-fields label{display:grid;gap:4px;min-width:0}
 .request-fields select{width:100%;max-width:100%}.family-link{width:min(100%,32rem);padding:8px}
 .sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
 </style><link rel="stylesheet" href="/responsive.css"></head><body><main>
 <nav class="directory-links" aria-label="Owner workspace"><a href="/#workspace=Dashboard">← Dashboard</a><a href="/attendance">Attendance</a><a href="/documents">Waivers &amp; Contracts</a></nav><h1>Families</h1>
 <p>Filter by program, then open a family’s waivers and contracts to review signatures or request one.</p>
 <p class="muted">Program filters include current and upcoming memberships, active scholarships and upcoming walk-ins. Record signups here after confirming them outside the platform.</p>
 <p id="testCleanupStatus" role="status" hidden></p>
 <form action="/accounts" method="get"><label for="familyProgram">Program</label><select id="familyProgram" name="program">${options}</select><button type="submit">Show families</button></form>
 <article><details><summary>USA Wrestling cards expiring in the next 30 days (${renewalRows.length>500?'500+':renewalRows.length})</summary>
 ${renewalLinks?`<ul>${renewalLinks}</ul>`:'<p>No verified cards expire in the next 30 days.</p>'}</details></article>
 ${sampleRows?`<section aria-labelledby="sampleFamiliesHeading"><h2 id="sampleFamiliesHeading">Sample families</h2>
 <p class="muted">Fictional family accounts for previewing each program. These examples are separate from the saved family directory and attendance.</p>${sampleRows}</section>`:''}
 <article aria-labelledby="testFamilyHeading"><h2 id="testFamilyHeading">Test family on my owner login</h2>
 <p>Add one sample wrestler per program and a test copy of the Parent Consent Form for each to your own family account. Sample check-ins are separate from live attendance.</p>
 <label for="testConsentSource">Saved Parent Consent Form</label>
 <select id="testConsentSource"><option value="">Choose your saved form and version</option>${formOptions}</select>
 <button type="button" id="setupTestFamily"${forms.length?'':' disabled'}>Set up or refresh test family</button>
 ${forms.length?'':'<p>Save your Parent Consent Form in <a href="/documents">Waivers &amp; Contracts</a>, then return here.</p>'}
 <p id="testFamilyStatus" role="status"></p><ul id="testFamilyWrestlers" hidden></ul>
 <p class="directory-links"><a href="/family">Open my family account and QR passes</a><a href="/attendance?test=1">Open test attendance</a></p>
 </article>
 ${rows||`<article>${empty}</article>`}
 ${page>1||data.length>pageSize?`<nav class="pages" aria-label="Family results pages">${page>1?`<a href="${pageLink(page-1)}">Previous page</a>`:''}<span>Page ${page}</span>${data.length>pageSize?`<a href="${pageLink(page+1)}">Next page</a>`:''}</nav>`:''}
 <p><a href="/documents">Family waivers, contracts &amp; signed agreements →</a></p>
 <p><a href="/approvals">SWA Advance approvals &amp; conversations →</a></p>
 <p><a href="/account-setup">Account setup &amp; email links</a> · <a href="/login">Try email sign-in</a></p>
 </main></body></html>`),{headers:auth.headers}));
}
