import {readFileSync} from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const html=readFileSync('app/portal.html','utf8');let code=html.match(/<script>([\s\S]*)<\/script>/)[1];code=code.slice(0,code.indexOf("if(location.hash.startsWith('#coaches'))"));
const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',value:'',style:{},classList:{add(){},remove(){},toggle(){return false}},setAttribute(){},focus(){}});return nodes.get(id)};
const team=[{email:'owner@example.test',name:'Owner Example',active:1,owner:true,programs:'[]'},{email:'coach@example.test',name:'Coach <Example>',active:1,programs:'["Advanced"]'}],copied=[],requests=[];
const ctx=vm.createContext({console,structuredClone,crypto,Intl,Date,JSON,Set,Map,URL,URLSearchParams,FormData,location:{hash:'',origin:'https://academy.test'},document:{querySelector:node,addEventListener(){}},window:{addEventListener(){}},setTimeout(){},confirm:()=>true,navigator:{clipboard:{async writeText(text){copied.push(text)}}},async fetch(url,options){requests.push(url);if(url==='/api/staff'){
 if(options?.method==='POST'){
  const body=JSON.parse(options.body);
  assert.deepEqual(body,{action:'revoke',email:'coach@example.test'});
  team[1].active=0;
  return Response.json({ok:true});
 }
 return Response.json({staff:team});
}if(url.startsWith('/api/coach-profile')){const c=team.find(c=>url.includes(encodeURIComponent(c.email)));return Response.json({email:c.email,data:{name:c.name,phone:'555-0100',bio:'<img src=x onerror=alert(1)>',experience:'Experience',specialties:'Neutral'},owner:!!c.owner,revision:1,hasPhoto:false})}throw Error('Unexpected request '+url)}});
vm.runInContext(code,ctx);const run=s=>vm.runInContext(s,ctx);run("mode='admin';page='Coaches';hydratePrograms()");await run('loadOwnerCoaches()');assert.equal(run('coachDirectoryRows.length'),2);assert.match(node('#nav').innerHTML,/Coach &lt;Example&gt;/);assert.match(node('#main').innerHTML,/&lt;img src=x onerror=alert\(1\)&gt;/);assert.doesNotMatch(node('#main').innerHTML,/<img src=x/);
await run('openDirectoryCoach(1)');assert.equal(run('coachDirectoryEmail'),'coach@example.test');assert.match(node('#main').innerHTML,/Copy profile invitation/);assert.match(node('#main').innerHTML,/mailto:/);await run('copyDirectoryInvitation()');assert.deepEqual(copied,['https://academy.test/coach-join']);assert.match(run('lessons()'),/Open coaches/);assert.match(run('lessons()'),/View parent availability page/);
assert.match(node('#nav').innerHTML,/<details data-owner-group="3" open><summary>Team &amp; Settings/);
assert.match(node('#main').innerHTML,/Remove coach/);
run(`coachDirectoryRows[1].programs='["Elementary","Advanced"]';editDirectoryCoach(true)`);
const assignments=node('#overlay').innerHTML;
assert.match(assignments,/One coach can be assigned to multiple programs/);
assert.match(assignments,/value="Elementary" checked/);
assert.match(assignments,/value="Advanced" checked/);
assert.doesNotMatch(assignments,/value="Intermediate" checked/);
await run('revokeDirectoryCoach()');
assert.equal(run('coachDirectoryEmail'),'owner@example.test');
assert.doesNotMatch(node('#nav').innerHTML,/Coach &lt;Example&gt;/);
assert.match(node('#main').innerHTML,/<details class="removed-coaches"\s*><summary>Removed coaches<\/summary>.*Coach &lt;Example&gt;/);
await run('openDirectoryCoach(1)');
assert.match(node('#main').innerHTML,/Restore coach/);
assert.doesNotMatch(node('#main').innerHTML,/Copy profile invitation/);
const before=requests.length;run("mode='family'");await run('loadOwnerCoaches()');await run('openDirectoryCoach(0)');assert.equal(requests.length,before);assert.match(run('lessons()'),/href="\/private-lessons"/);
console.log('Passed integrated sidebar names, existing profile loading, HTML escaping, invitation copy/email draft, shared lesson links and owner-only directory fetching.');
