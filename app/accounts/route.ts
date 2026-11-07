import { env } from 'cloudflare:workers';
import { ownerIdentity } from '../../lib/account-auth';
import { when } from '../../lib/datetime';
import { addressLines, hasMedicalNote, missingDetails, type FamilyProfile, type Wrestler } from '../../lib/family-records';
import { programDetails } from '../../lib/program-names';
import { academyToday } from '../../lib/public-schedule';
import { PROGRAM_ON } from '../../lib/transfers';
export const dynamic='force-dynamic';
const escape=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const gradeLabel=(g:string)=>g==='Adult'?'Adult':g==='K'?'Kindergarten':'Grade '+g;
const PROGRAMS=Object.keys(programDetails);
// Each wrestler's program today: a paid membership in its term (by the program on today's date, so transfers count)
// or an active scholarship. The same rule as program announcements (lib/messages.ts).
async function programsToday(today:string){
 const rows=(await env.DB!.prepare(`SELECT user_id,wrestler_id,${PROGRAM_ON} AS program FROM orders WHERE status='paid' AND kind IN ('annual','monthly') AND term_start<=? AND term_end>=?
   UNION SELECT user_id,wrestler_id,program FROM scholarship_awards WHERE status='active' AND user_id IS NOT NULL AND wrestler_id IS NOT NULL`)
  .bind(today,today,today).all<{user_id:string;wrestler_id:string;program:string}>()).results;
 const map=new Map<string,Set<string>>();
 for(const r of rows)if(PROGRAMS.includes(r.program)){const k=r.user_id+'\n'+r.wrestler_id;if(!map.has(k))map.set(k,new Set());map.get(k)!.add(r.program)}
 return (userId:string,wrestlerId:string)=>[...(map.get(userId+'\n'+wrestlerId)??[])];
}
// "April 18, 2012 · age 14", worked out on the academy's date.
function birthLabel(date:string,today:string){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return escape(date);
 const [y,m,d]=date.split('-').map(Number),[ty,tm,td]=today.split('-').map(Number),age=ty-y-((tm<m||(tm===m&&td<d))?1:0);
 return escape(new Date(date+'T12:00:00Z').toLocaleDateString('en-US',{timeZone:'UTC',month:'long',day:'numeric',year:'numeric'}))+(age>=0?' · age '+age:'');
}
const field=(label:string,value:string)=>`<div><dt>${label}</dt><dd>${value||'<span class="none">Not provided</span>'}</dd></div>`;
// Contact and safety details (issue #188), folded away so the list stays short and medical notes are not on screen
// by default. Only the owner can open this page; coaches see allergies and emergency contacts on the roster.
function details(family:FamilyProfile,today:string){
 const address=addressLines(family).map(escape).join('<br>'),emergency=[family.emergencyContactName,family.emergencyContactPhone].filter(Boolean).map(escape).join(' · ');
 const kids=(family.wrestlers??[]).map((w:Wrestler)=>`<div class="kid"><h3>${escape(w.name)}</h3><dl>${field('Birth date',w.birthDate?birthLabel(w.birthDate,today):'')}${field('Allergies or medical notes',w.allergies?`<span class="notes">${escape(w.allergies)}</span>`:'')}</dl></div>`).join('');
 return `<details class="family-details"><summary>Contact and safety details</summary><dl>${field('Home address',address)}${field('Emergency contact',emergency)}</dl>${kids}</details>`;
}
export async function GET(request:Request){
 const auth=await ownerIdentity(request);if(!auth.owner)return new Response('Sign in as the owner and enter your authenticator code to see family accounts.',{status:403,headers:auth.headers});
 const today=academyToday();
 const result=await env.DB!.prepare('SELECT user_id,email,payload,updated_at FROM family_accounts ORDER BY updated_at DESC LIMIT 500').all<{user_id:string;email:string;payload:string;updated_at:string}>();
 const programOf=await programsToday(today);
 const rows=result.results.map(row=>{
  const family=JSON.parse(row.payload) as FamilyProfile,wrestlers=family.wrestlers??[];
  const search=[family.parentName,row.email,family.phone,...(family.wrestlers??[]).map((w:{name:string})=>w.name)].filter(Boolean).join(' ').toLowerCase();
  const programs=new Set<string>();
  const lines=wrestlers.map(w=>{
   const mine=programOf(row.user_id,w.id);mine.forEach(p=>programs.add(p));
   const tags=mine.map(p=>`<span class="pill">${escape(programDetails[p].name)}</span>`).join('')+(hasMedicalNote(w.allergies)?'<span class="pill alert">Medical note</span>':'');
   return `<li><span>${escape(w.name)} · ${escape(gradeLabel(w.grade))}</span>${tags}</li>`;
  }).join('');
  return `<article data-search="${escape(search)}" data-programs="${programs.size?[...programs].join(' '):'none'}"><h2>${escape(family.parentName||row.email)}</h2>${missingDetails(family).length?'<p><span class="pill warn">Details missing</span></p>':''}<p>${escape(row.email)}${family.phone?' · '+escape(family.phone):''}</p>${lines?`<ul class="kids">${lines}</ul>`:'<p>No wrestlers added yet.</p>'}${details(family,today)}<small>Profile last saved ${escape(when(row.updated_at))}</small></article>`;
 }).join(''),kids=result.results.reduce((n,row)=>{try{return n+(JSON.parse(row.payload).wrestlers??[]).length}catch{return n}},0),count=result.results.length;
 const options=`<option value="">All programs</option>${PROGRAMS.map(p=>`<option value="${p}">${escape(programDetails[p].name)}</option>`).join('')}<option value="none">No current program</option>`;
 auth.headers.set('Content-Type','text/html; charset=utf-8');
 return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Family accounts | Savage</title><style>body{font:15px Arial;line-height:1.6;color:#18191c;background:#f5f5f6;margin:0}main{max-width:850px;margin:auto;padding:24px 16px}article{background:white;border:1px solid #ddd;padding:20px;border-radius:10px;margin:18px 0}a{color:#b12c38}small{color:#5f626b}label{display:block;font-weight:600;margin:0 0 6px}.filters{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:14px;max-width:720px;margin:20px 0 0}.filters input,.filters select{display:block;width:100%}#count{margin:10px 0 0}article h2{margin:0 0 4px}article>p{margin:0 0 8px;overflow-wrap:anywhere}.kids{list-style:none;padding:0;margin:8px 0 12px}.kids li{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;padding:4px 0}.kids li>span:first-child{margin-right:4px}html body .pill{background:#EEF0F3;color:#1C1D21;padding:3px 9px;font-size:11px}html body .pill.alert{background:#FDECEC;color:#8E1A22}html body .pill.warn{background:#FFF4D6;color:#6B4A00}.family-details{border-top:1px solid #E4E6EA;margin:4px 0 10px;padding-top:4px}.family-details summary{cursor:pointer;font-weight:700;min-height:44px;display:flex;align-items:center;list-style:none}.family-details summary::-webkit-details-marker{display:none}.family-details summary::after{content:"";width:8px;height:8px;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(45deg) translateY(-3px);margin-left:12px}.family-details[open] summary::after{transform:rotate(-135deg) translateY(-1px)}.family-details dl{display:grid;grid-template-columns:1fr 1fr;gap:10px 18px;margin:6px 0 12px}.family-details dt{font-size:13px;color:#55585F}.family-details dd{margin:2px 0 0;font-weight:600;overflow-wrap:anywhere}.family-details .notes{white-space:pre-line}.family-details .none{color:#6B7076;font-weight:400}.family-details .kid{border-top:1px solid #EEF0F2;padding-top:6px}.family-details h3{margin:8px 0 0;font-size:17px}@media(max-width:640px){.filters{grid-template-columns:1fr}.family-details dl{grid-template-columns:1fr}article{padding:16px}}</style><link rel="stylesheet" href="/responsive.css"></head><body><main><a href="/">← Owner workspace</a><h1>Family accounts</h1><p><a href="/approvals">SWA Advance approvals & conversations →</a></p><p><a href="/account-setup">Account setup &amp; email links</a></p><p>Every family that has created an account, newest changes first. Passwords are never shown. Families must add a home address, an emergency contact, and each wrestler’s birth date and allergies or medical notes. Coaches see allergies and emergency contacts on the check-in roster for their own programs.</p>${count?`<div class="filters"><div><label for="find">Find a family</label><input id="find" type="search" placeholder="Parent, email, phone or wrestler" autocomplete="off"></div><div><label for="program">Program</label><select id="program">${options}</select></div></div><p id="count" role="status" aria-live="polite">${count} famil${count===1?'y':'ies'} · ${kids} wrestler${kids===1?'':'s'}</p><div id="families">${rows}</div><p id="none" hidden>No family matches that search and program.</p><script>const f=document.getElementById('find'),p=document.getElementById('program'),all=[...document.querySelectorAll('#families article')],total=document.getElementById('count').textContent;function show(){const q=f.value.trim().toLowerCase(),g=p.value;let shown=0;for(const a of all){const hit=(!q||a.dataset.search.includes(q))&&(!g||a.dataset.programs.split(' ').includes(g));a.hidden=!hit;if(hit)shown++}document.getElementById('none').hidden=shown>0;document.getElementById('count').textContent=q||g?shown+' of '+all.length+' families match':total}f.oninput=show;p.onchange=show</script>`:'<article>No family has created an account yet.</article>'}</main></body></html>`,{headers:auth.headers});
}
