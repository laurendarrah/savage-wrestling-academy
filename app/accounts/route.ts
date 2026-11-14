import { env } from 'cloudflare:workers';
import { ownerIdentity } from '../../lib/account-auth';
import { markOwnerShell } from '../../lib/owner-shell';
import { when } from '../../lib/datetime';
import { addressLines, hasMedicalNote, missingDetails, type FamilyProfile, type Wrestler } from '../../lib/family-records';
import { programDetails } from '../../lib/program-names';
import { academyToday } from '../../lib/public-schedule';
import { PROGRAM_ON } from '../../lib/transfers';
import { beforeKey, keysetPage, type SortCol } from '../../lib/paging';
import { familyMatch } from '../../lib/family-search';
import { familyLabel, DELETE_SCRIPT } from '../../lib/family-deletion';
export const dynamic='force-dynamic';
const escape=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const gradeLabel=(g:string)=>g==='Adult'?'Adult':g==='K'?'Kindergarten':'Grade '+g;
const PROGRAMS=Object.keys(programDetails);
// Each wrestler's program today: a paid membership in its term (by the program on today's date, so transfers count)
// or an active scholarship. The same rule as program announcements (lib/messages.ts).
const CURRENT=`SELECT user_id,wrestler_id,${PROGRAM_ON} AS program FROM orders WHERE status='paid' AND kind IN ('annual','monthly') AND term_start<=? AND term_end>=?
   UNION SELECT user_id,wrestler_id,program FROM scholarship_awards WHERE status='active' AND user_id IS NOT NULL AND wrestler_id IS NOT NULL`;
// The programs of the families on this page only (issue #46).
async function programsToday(today:string,userIds:string[]){
 const rows=(await env.DB!.prepare(`SELECT * FROM (${CURRENT}) WHERE user_id IN (SELECT value FROM json_each(?))`)
  .bind(today,today,today,JSON.stringify(userIds)).all<{user_id:string;wrestler_id:string;program:string}>()).results;
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
// Delete this family account (issue #259; lib/family-deletion.ts). The owner types the family's name to confirm.
function deleteForm(row:Row,n:number){
 const label=familyLabel(row);
 return `<details class="delete-family"><summary>Delete this family account</summary><p>For a test account, or a family who asked to close their account. This removes the profile, wrestlers, bookings, USA Wrestling card details, entry passes, messages and notices, and can’t be undone. Their payments stay on Payments and Income and expenses as “Deleted family”. Signed waivers and forms, scholarship records, check-ins and SWA Advance approvals are kept unless you tick “This is a test account”. Refund, void or cancel anything still to come first.</p><form class="delete-form" data-user="${escape(row.user_id)}" data-label="${escape(label)}"><label for="confirm${n}">Type <strong>${escape(label)}</strong> to confirm</label><input id="confirm${n}" name="confirm" autocomplete="off" spellcheck="false"><label class="check"><input type="checkbox" name="test"> This is a test account: also delete its signed waivers and forms, scholarship records, check-ins and SWA Advance approvals</label><button type="submit" class="danger" disabled>Delete this family account</button><p class="delete-status" role="status" aria-live="polite"></p></form></details>`;
}

// Paging, search and the program filter run in the database (issue #46), so every family can be found however many
// there are: 50 a page, newest changes first, with Previous and Next links that keep the search and filter.
const PAGE=50;
const COLS:SortCol[]=[{expr:'f.updated_at',desc:true},{expr:'f.user_id',desc:true}];
type Filters={q:string;program:string;after:string|null;before:string|null};
type Row={user_id:string;email:string;payload:string;updated_at:string};
function filters(p:URLSearchParams):Filters{
 const program=p.get('program')??'';
 return {q:(p.get('q')??'').trim().slice(0,100),program:PROGRAMS.includes(program)||program==='none'?program:'',after:p.get('after'),before:p.get('before')};
}
// Families with a wrestler in one of these programs today, by the same rule as the program pills. Not correlated with
// the outer row, so the database works it out once per query.
const inProgram=(list:string)=>`f.user_id IN (SELECT c.user_id FROM (${CURRENT}) c JOIN family_accounts g ON g.user_id=c.user_id JOIN json_each(g.payload,'$.wrestlers') w ON json_extract(w.value,'$.id')=c.wrestler_id WHERE c.program IN (${list}))`;
function where(f:Filters,today:string){
 const parts:string[]=[],args:unknown[]=[],m=familyMatch(f.q);
 if(m){parts.push(m.sql);args.push(...m.args)}
 if(f.program==='none'){parts.push('NOT '+inProgram(PROGRAMS.map(()=>'?').join(',')));args.push(today,today,today,...PROGRAMS)}
 else if(f.program){parts.push(inProgram('?'));args.push(today,today,today,f.program)}
 return {sql:parts.join(' AND '),args};
}
async function familyPage(f:Filters,today:string){
 const w=where(f,today),count=async(sql:string,args:unknown[])=>Number((await env.DB!.prepare(`SELECT count(*) AS n FROM family_accounts f${sql?' WHERE '+sql:''}`).bind(...args).first<{n:number}>())?.n??0);
 const page=await keysetPage<Row>({select:'f.user_id,f.email,f.payload,f.updated_at',from:'FROM family_accounts f',where:w.sql||undefined,args:w.args,cols:COLS,keyOf:r=>[r.updated_at,r.user_id],cursor:f.after,before:f.before,limit:PAGE});
 const first=page.rows[0],ahead=first?beforeKey(COLS,[first.updated_at,first.user_id]):null;
 const [totals,matched,skipped]=await Promise.all([
  env.DB!.prepare("SELECT count(*) AS families,COALESCE(sum(CASE WHEN json_valid(payload) THEN json_array_length(payload,'$.wrestlers') END),0) AS wrestlers FROM family_accounts").first<{families:number;wrestlers:number}>(),
  w.sql?count(w.sql,w.args):null,
  ahead?count([w.sql,ahead.sql].filter(Boolean).join(' AND '),[...w.args,...ahead.args]):0]);
 const families=Number(totals?.families??0);
 return {...page,families,wrestlers:Number(totals?.wrestlers??0),matched:matched??families,from:skipped+1};
}
// A page link that keeps the search and filter. Cursors are URL-safe already.
const link=(f:Filters,k:'after'|'before',cursor:string)=>'?'+[f.q&&'q='+encodeURIComponent(f.q),f.program&&'program='+encodeURIComponent(f.program),k+'='+cursor].filter(Boolean).join('&');
export async function GET(request:Request){
 const auth=await ownerIdentity(request);if(!auth.owner)return new Response('Sign in as the owner and enter your authenticator code to see family accounts.',{status:403,headers:auth.headers});
 const today=academyToday(),url=new URL(request.url),f=filters(url.searchParams),list=await familyPage(f,today);
 const programOf=await programsToday(today,list.rows.map(r=>r.user_id));
 const rows=list.rows.map((row,n)=>{
  const family=JSON.parse(row.payload) as FamilyProfile,wrestlers=family.wrestlers??[];
  const programs=new Set<string>();
  const lines=wrestlers.map(w=>{
   const mine=programOf(row.user_id,w.id);mine.forEach(p=>programs.add(p));
   const tags=mine.map(p=>`<span class="pill">${escape(programDetails[p].name)}</span>`).join('')+(hasMedicalNote(w.allergies)?'<span class="pill bad">Medical note</span>':'');
   // Approvals and transfers act on a wrestler, so each row links to them (issue #283).
   return `<li><span>${escape(w.name)} · ${escape(gradeLabel(w.grade))}</span>${tags}<span class="kid-links"><a href="/approvals">Approvals</a><a href="/transfers">Transfer</a></span></li>`;
  }).join('');
  return `<article class="card" data-programs="${programs.size?[...programs].join(' '):'none'}"><h2>${escape(family.parentName||row.email)}</h2>${missingDetails(family).length?'<p><span class="pill warn">Details missing</span></p>':''}<p>${escape(row.email)}${family.phone?' · '+escape(family.phone):''}</p>${lines?`<ul class="kids">${lines}</ul>`:'<p>No wrestlers added yet.</p>'}${details(family,today)}${deleteForm(row,n)}<small>Profile last saved ${escape(when(row.updated_at))}</small></article>`;
 }).join(''),count=list.families,kids=list.wrestlers,filtered=!!(f.q||f.program);
 const opt=(v:string,label:string)=>`<option value="${v}"${f.program===v?' selected':''}>${escape(label)}</option>`;
 const options=opt('','All programs')+PROGRAMS.map(p=>opt(p,programDetails[p].name)).join('')+opt('none','No current program');
 const plural=(n:number,one:string,many:string)=>`${n.toLocaleString('en-US')} ${n===1?one:many}`;
 const summary=filtered?`${list.matched.toLocaleString('en-US')} of ${plural(count,'family','families')} match`:`${plural(count,'family','families')} · ${plural(kids,'wrestler','wrestlers')}`;
 const to=list.from+list.rows.length-1;
 const pager=list.rows.length&&(list.prev||list.next)?`<nav class="pager" aria-label="Pages of families"><p>Showing ${list.from.toLocaleString('en-US')}–${to.toLocaleString('en-US')} of ${plural(list.matched,'family','families')}</p><div class="pager-links">${list.prev?`<a class="button" href="${escape(link(f,'before',list.prev))}" rel="prev">← Previous ${PAGE}</a>`:''}${list.next?`<a class="button" href="${escape(link(f,'after',list.next))}" rel="next">Next ${Math.min(PAGE,list.matched-to)} →</a>`:''}</div></nav>`:'';
 const empty=filtered?'No family matches that search and program.':list.prev||f.after||f.before?'No families on this page. <a href="/accounts">Back to the first page</a>.':'';
 auth.headers.set('Content-Type','text/html; charset=utf-8');markOwnerShell(auth.headers);
 return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Families | Savage Wrestling Academy</title><style>/* Families (issue #341): on the design system in public/savage.css; this is the page's own layout. A family is a card: the parent, how to reach them, each wrestler on a row with their program as a pill, and two folded sections. The pills, the disclosures, the danger button and the empty state are the shared ones. */*{box-sizing:border-box}body{margin:0}main{max-width:900px;margin:auto;padding:24px 16px 56px}label{display:block;margin:0 0 6px}.filters{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr) auto;align-items:end;gap:var(--swa-s-12);margin:0}.filters input,.filters select{display:block;width:100%}.filters .actions{display:flex;align-items:center;gap:var(--swa-s-12)}#count{margin:var(--swa-s-12) 0 var(--swa-s-16);color:var(--swa-muted);font-size:var(--swa-t-15);font-weight:600}#families{display:grid;gap:var(--swa-s-16)}article h2{margin:0 0 var(--swa-s-4);overflow-wrap:anywhere}article>p{margin:0 0 var(--swa-s-8);overflow-wrap:anywhere;font-size:var(--swa-t-15)}article>small{display:block;margin-top:var(--swa-s-8);color:var(--swa-muted);font-size:var(--swa-t-13)}.kids{list-style:none;padding:0;margin:var(--swa-s-8) 0 0}.kids li{display:flex;flex-wrap:wrap;align-items:center;gap:6px var(--swa-s-8);min-height:44px;padding:var(--swa-s-4) 0;border-top:1px solid var(--swa-line);font-size:var(--swa-t-15)}.kids li>span:first-child{margin-right:var(--swa-s-4);font-weight:600}.kid-links{margin-left:auto;display:inline-flex;gap:var(--swa-s-16)}html body .kid-links a{display:inline-flex;align-items:center;min-height:44px;color:var(--swa-muted);font-weight:600;text-decoration-color:var(--swa-line)}html body .kid-links a:hover{color:var(--swa-red);text-decoration-color:var(--swa-red)}.family-details,.delete-family{border-top:1px solid var(--swa-line)}.family-details dl{display:grid;grid-template-columns:1fr 1fr;gap:var(--swa-s-8) var(--swa-s-16);margin:var(--swa-s-4) 0 var(--swa-s-12)}.family-details dt{font-size:var(--swa-t-13);color:var(--swa-muted)}.family-details dd{margin:2px 0 0;font-weight:600;font-size:var(--swa-t-15);overflow-wrap:anywhere}.family-details .notes{white-space:pre-line}.family-details .none{color:var(--swa-muted);font-weight:400}.family-details .kid{border-top:1px solid var(--swa-line);padding-top:var(--swa-s-4)}.family-details h3{margin:var(--swa-s-8) 0 0}.delete-family p{margin:0 0 var(--swa-s-12);font-size:var(--swa-t-15)}form.delete-form input[name=confirm]{display:block;width:100%;max-width:380px;margin:0 0 var(--swa-s-12)}html body .delete-form label.check{display:flex;gap:10px;align-items:flex-start;font-weight:400;margin:0 0 var(--swa-s-12)}.delete-form label.check input{flex:none;margin-top:2px}.delete-status{margin:var(--swa-s-8) 0 0;font-weight:600;font-size:var(--swa-t-15)}.delete-status:empty{display:none}#none{color:var(--swa-muted)}@media(max-width:640px){.filters{grid-template-columns:1fr}.filters button{flex:1}.family-details dl{grid-template-columns:1fr}.kid-links{margin-left:0;flex-basis:100%}}</style><link rel="stylesheet" href="/responsive.css"></head><body><main><h1>Family accounts</h1><p><a href="/approvals">SWA Advance approvals & conversations →</a></p><p><a href="/account-setup">Account setup &amp; email links</a></p><p>Every family that has created an account, newest changes first. Passwords are never shown. Families must add a home address, an emergency contact, and each wrestler’s birth date and allergies or medical notes. Coaches see allergies and emergency contacts on the check-in roster for their own programs.</p>${count?`<form class="filters" id="filters" method="get" action="/accounts" role="search"><div><label for="find">Find a family</label><input id="find" name="q" type="search" value="${escape(f.q)}" placeholder="Parent, email, phone or wrestler" autocomplete="off"></div><div><label for="program">Program</label><select id="program" name="program">${options}</select></div><div class="actions"><button type="submit">Search</button>${filtered?'<a href="/accounts">Clear</a>':''}</div></form><p id="count" role="status" aria-live="polite">${summary}</p><div id="families">${rows}</div><p id="none"${rows?' hidden':''}>${empty}</p>${pager}<script>document.getElementById('program').onchange=e=>e.target.form.requestSubmit()</script><script>${DELETE_SCRIPT}</script>`:'<div class="empty"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="7" r="4"/><path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2M16 3.13a4 4 0 0 1 0 7.75M22 21v-2a4 4 0 0 0-3-3.87"/></svg><p>No family has created an account yet. Each family that signs up is listed here with their wrestlers.</p></div>'}</main></body></html>`,{headers:auth.headers});
}
