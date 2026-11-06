import {readFileSync,readdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';
const realRequire=createRequire(import.meta.url);
const sqlite=new DatabaseSync(':memory:');
for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort().map(f=>'drizzle/'+f))sqlite.exec(readFileSync(file,'utf8'));
const DB={prepare(sql){let args=[];return {_sql:sql,bind(...v){args=v;return this},async first(){return sqlite.prepare(sql).get(...args)??null},async run(){return sqlite.prepare(sql).run(...args)},async all(){return {results:sqlite.prepare(sql).all(...args)}},_execute(){const stmt=sqlite.prepare(sql);return {results:stmt.columns().length?stmt.all(...args):[],...(!stmt.columns().length?{meta:stmt.run(...args)}:{})}}}},async batch(statements){sqlite.exec('BEGIN');try{const results=statements.map(s=>s._execute());sqlite.exec('COMMIT');return results}catch(e){sqlite.exec('ROLLBACK');throw e}}};
const users={owner:{id:'owner-uuid',email:'savagewrestlingclub@gmail.com',email_confirmed_at:'2026-10-15',factors:[{id:'factor-owner',status:'verified',factor_type:'totp'}]},alice:{id:'alice-uuid',email:'alice@example.test',email_confirmed_at:'2026-10-15'},bob:{id:'bob-uuid',email:'bob@example.test',email_confirmed_at:'2026-10-15'},unverified:{id:'unverified-uuid',email:'savagewrestlingclub@gmail.com'}};
const levels={owner:'aal2'};
let chatgpt=null,lastSignup=null,resetTo=null,changeCount=0,emailError=null;
const modules=new Map();
function load(file){if(modules.has(file))return modules.get(file);const module={exports:{}};modules.set(file,module.exports);const compiled=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;vm.runInNewContext(compiled,{module,exports:module.exports,Response,Request,Headers,URL,Date,TextEncoder,Uint8Array,crypto,Set,console,require(name){if(name==='cloudflare:workers')return {env:{DB,SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'}};if(name.endsWith('/chatgpt-auth'))return {getChatGPTUser:async()=>chatgpt};if(name==='@supabase/ssr')return {parseCookieHeader(raw){return raw?raw.split(';').map(v=>({name:v.trim().split('=')[0],value:v.trim().split('=')[1]})):[]},serializeCookieHeader(name,value,options){return `${name}=${value}; Path=/; ${options.httpOnly?'HttpOnly; ':''}${options.secure?'Secure; ':''}SameSite=${options.sameSite}`},createServerClient(url,key,options){const session=options.cookies.getAll().find(c=>c.name==='test-session')?.value;return {auth:{mfa:{async getAuthenticatorAssuranceLevel(){return {data:{currentLevel:levels[session]??'aal1'},error:null}},async listFactors(){const all=users[session]?.factors??[];return {data:{all,totp:all.filter(f=>f.factor_type==='totp'&&f.status==='verified')},error:null}},async enroll(){const user=users[session];const factor={id:'new-factor-'+session,status:'unverified',factor_type:'totp'};(user.factors??=[]).push(factor);return {data:{id:factor.id,totp:{qr_code:'<svg></svg>',secret:'TEST_ONLY'}},error:null}},async unenroll({factorId}){users[session].factors=users[session].factors.filter(f=>f.id!==factorId);return {error:null}},async challengeAndVerify({factorId,code}){const factor=users[session]?.factors?.find(f=>f.id===factorId);if(!factor||code!=='123456')return {error:{message:'invalid code'}};factor.status='verified';levels[session]='aal2';return {error:null}}},async getUser(){return {data:{user:users[session]??null},error:users[session]?null:{code:'unauthorized'}}},async signInWithPassword(input){if(input.password!=='valid-password')return {data:{user:null},error:{code:'invalid_credentials'}};const entry=Object.entries(users).find(([id,u])=>u.email===input.email&&u.email_confirmed_at);options.cookies.setAll([{name:'test-session',value:entry?.[0]??'',options:{}}],{});return {data:{user:entry?.[1]??null},error:null}},async signUp(input){lastSignup=input;return {data:{user:null},error:null}},async resetPasswordForEmail(email,options){resetTo=options.redirectTo;return {error:emailError}},async resend(){return {error:emailError}},async updateUser(){changeCount++;return {error:null}},async signOut(){options.cookies.setAll([{name:'test-session',value:'',options:{}}],{});return {error:null}}}}}};if(name.startsWith('.')){const path=new URL(name+'.ts',new URL(file,'file://'+process.cwd()+'/')).pathname;return load(path)}return realRequire(name)}});return module.exports}

const plans=load('app/api/practice-plans/route.ts');
let n=0;
function req(method='GET',body,session='owner',origin='https://academy.test',month='2026-12'){return new Request('https://academy.test/api/practice-plans?month='+month,{method,headers:{'content-type':'application/json',origin,cookie:'test-session='+session,'cf-connecting-ip':'192.0.2.'+(++n)},...(body?{body:JSON.stringify(body)}:{})})}
users.coachA={id:'coach-a',email:'a@coach.test',email_confirmed_at:'2026-10-15',factors:[{id:'mfa-a',status:'verified',factor_type:'totp'}]};users.coachB={...users.coachA,id:'coach-b',email:'b@coach.test'};levels.coachA='aal2';levels.coachB='aal2';
sqlite.prepare('INSERT INTO staff_access VALUES (?,?,?,?,?)').run('a@coach.test','Coach A','["Elementary"]',1,'2026-10-16');sqlite.prepare('INSERT INTO staff_access VALUES (?,?,?,?,?)').run('b@coach.test','Coach B','["Advanced"]',1,'2026-10-16');
const state={programs:[{id:'Elementary',name:'Youth',priceCents:20000},{id:'Advanced',name:'Competition',priceCents:20000}],seasons:[{program:'Elementary',start:'2026-12-01',end:'2026-12-31',weekly:[{day:'Monday',start:'18:00',end:'19:30'}],excludedDates:['2026-12-28']},{program:'Advanced',start:'2026-12-01',end:'2026-12-31',weekly:[{day:'Monday',start:'19:30',end:'21:00'}],excludedDates:[]}]};
sqlite.prepare('INSERT INTO academy_state VALUES (?,?,?,?,?)').run('academy',JSON.stringify(state),1,'owner','2026-10-16');
const plan={title:'Leg attacks',objective:'Finish cleanly',sections:[{id:'warmup',kind:'warmup',title:'Warm-up',minutes:10,notes:'Movement'},{id:'live',kind:'live',title:'Live',minutes:20,notes:'Situational goes'},{id:'drill',kind:'drill',title:'Drill',minutes:10,notes:'Partner drilling'}],notes:'Bring bands'};
const body={action:'save',date:'2026-12-07',program:'Elementary',revision:0,published:false,data:plan};
assert.equal((await plans.GET(new Request('https://academy.test/api/practice-plans',{headers:{cookie:'test-session=owner'}}))).status,200);assert.equal((await plans.GET(req('GET',null,'alice'))).status,403);assert.equal((await plans.POST(req('POST',body,'coachA'))).status,403);assert.equal((await plans.POST(req('POST',body,'alice'))).status,403);
assert.equal((await plans.POST(req('POST',body,'owner','https://evil.test'))).status,403);
assert.equal((await plans.POST(req('POST',{...body,date:'2026-12-28'}))).status,409);assert.equal((await plans.POST(req('POST',{...body,date:'2026-12-08'}))).status,409);assert.equal((await plans.POST(req('POST',{...body,date:'2026-02-30'}))).status,400);
assert.equal((await plans.POST(req('POST',body))).status,200);
assert.equal((await (await plans.GET(req('GET',null,'coachA'))).json()).plans.length,0);assert.equal((await (await plans.GET(req())).json()).plans[0].data.notes,'Bring bands');
assert.equal((await plans.POST(req('POST',body))).status,409);
assert.equal((await plans.POST(req('POST',{...body,revision:1,published:true,data:{...plan,userId:'forged',secret:'should not persist'}}))).status,200);
let a=await (await plans.GET(req('GET',null,'coachA'))).json();assert.equal(a.owner,false);assert.equal(a.plans.length,1);assert.equal(a.plans[0].data.title,'Leg attacks');assert.equal(a.plans[0].data.secret,undefined);assert.deepEqual(a.programs.map(p=>p.id),['Elementary','Advanced']);assert.ok(a.practices.some(p=>p.program==='Advanced'));
assert.deepEqual((await (await plans.GET(req('GET',null,'coachB'))).json()).plans.map(p=>p.program),['Elementary']);
sqlite.prepare('INSERT INTO staff_access VALUES (?,?,?,?,?)').run(users.owner.email,'Owner','["Elementary"]',1,'2026-10-16');
assert.equal((await plans.POST(req('POST',{...body,program:'Advanced',published:false}))).status,200);
const coachView=(await (await plans.GET(req('GET',null,'owner','https://academy.test','2026-12&coachView=1'))).json());
assert.equal(coachView.owner,false);
assert.deepEqual(coachView.programs.map(p=>p.id),['Elementary','Advanced']);
assert.deepEqual(coachView.plans.map(p=>p.program),['Elementary']);
sqlite.prepare("DELETE FROM practice_plans WHERE program='Advanced'").run();
const hidden={action:'unpublish',program:'Elementary',date:'2026-12-07',revision:2};assert.equal((await plans.POST(req('POST',hidden))).status,200);assert.equal((await (await plans.GET(req('GET',null,'coachA'))).json()).plans.length,0);
assert.equal((await plans.POST(req('POST',{...body,revision:3,published:true}))).status,200);
// Removing a practice hides its plan from coaches, but leaves the owner history intact.
state.seasons[0].excludedDates.push('2026-12-07');sqlite.prepare('UPDATE academy_state SET payload=?').run(JSON.stringify(state));assert.equal((await (await plans.GET(req('GET',null,'coachA'))).json()).plans.length,0);const retained=await (await plans.GET(req())).json();assert.equal(retained.plans.length,1);assert.equal(retained.plans[0].scheduled,false);
assert.equal((await plans.POST(req('POST',{...body,revision:4,published:true}))).status,409);
levels.owner='aal1';assert.equal((await plans.GET(req())).status,403);assert.equal((await plans.POST(req('POST',{...hidden,revision:4}))).status,403);levels.owner='aal2';
levels.coachA='aal1';assert.equal((await plans.GET(req('GET',null,'coachA'))).status,403);levels.coachA='aal2';sqlite.prepare('UPDATE staff_access SET active=0 WHERE email=?').run('a@coach.test');assert.equal((await plans.GET(req('GET',null,'coachA'))).status,403);
assert.equal((await plans.GET(req('GET',null,'owner','https://academy.test','not-a-month'))).status,400);
console.log('Passed: owner-only editing, shared plans across programs, drafts, share/unshare, live role revocation, MFA, CSRF, stale saves, scheduled dates/holidays, retained owner history and sanitized plan payloads.');

const otherDay={...body,date:'2026-12-14',published:true,data:{...plan,sections:[plan.sections[0],plan.sections[2],plan.sections[1]]}};assert.equal((await plans.POST(req('POST',otherDay))).status,200);const stored=await (await plans.GET(req())).json();assert.equal(stored.plans.length,2);assert.equal(stored.plans.find(p=>p.date==='2026-12-07').data.sections[1].kind,'live');assert.equal(stored.plans.find(p=>p.date==='2026-12-14').data.sections[1].kind,'drill');
assert.equal((await plans.POST(req('POST',{...otherDay,revision:1,data:{...plan,sections:[{...plan.sections[0],minutes:-1}]}}))).status,400);
assert.equal((await plans.POST(req('POST',{...otherDay,revision:1,data:{...plan,sections:[plan.sections[0],plan.sections[0]]}}))).status,400);
console.log('Passed: independent saved section order per practice date and invalid duration/duplicate-section rejection.');
const summaryRequest=new Request('https://academy.test/api/practice-plans?month=2026-12&summary=1',{headers:{cookie:'test-session=owner'}});const summaries=await (await plans.GET(summaryRequest)).json();assert.equal(summaries.plans.length,2);assert.equal(summaries.plans[0].data,undefined);assert.equal(summaries.plans[0].title,'Leg attacks');console.log('Passed: calendar summaries include plan state without section content.');

const capped={...otherDay,revision:1,data:{...plan,sections:[{...plan.sections[0],minutes:90}]}};
assert.equal((await plans.POST(req('POST',{...capped,data:{...capped.data,sections:[{...plan.sections[0],minutes:45},{...plan.sections[1],minutes:46}]}}))).status,400);
assert.equal((await plans.POST(req('POST',{...capped,data:{...capped.data,sections:[{...plan.sections[0],minutes:null}]}}))).status,400);
assert.equal((await plans.POST(req('POST',{...capped,data:{...capped.data,sections:[{...plan.sections[0],minutes:1.5}]}}))).status,400);
assert.equal((await plans.POST(req('POST',capped))).status,200);
const after=await (await plans.GET(req())).json();assert.equal(after.plans.find(p=>p.date==='2026-12-14').revision,2);assert.equal(after.plans.find(p=>p.date==='2026-12-14').data.sections[0].minutes,90);
console.log('Passed: server rejects total above 90, missing and fractional minutes without saving; accepts exactly 90.');

state.events=[
 {id:'camp',name:'Winter Camp',type:'Camp',dates:['2026-12-20','2027-01-02'],
  schedule:[{date:'2026-12-20',start:'09:00',end:'13:00'},{date:'2027-01-02',start:'10:00',end:'13:00'}],description:'Camp notes'},
 {id:'clinic',name:'Single-Leg Clinic',type:'Clinic',dates:['2026-12-18'],schedule:[{date:'2026-12-18',start:'17:00',end:'18:30'}]},
 {id:'event',name:'Team Event',type:'Event',dates:['2026-12-19']},
 {id:'archived',name:'Archived Clinic',type:'Clinic',dates:['2026-12-18'],archived:true}
];
state.extraPractices=[{id:'extra',name:'Friday Practice',dates:['2026-12-18'],start:'18:30',end:'20:00',memberCents:1000,nonMemberCents:2000,enabled:true}];
sqlite.prepare('UPDATE academy_state SET payload=?').run(JSON.stringify(state));
const fullCoachCalendar=await (await plans.GET(req('GET',null,'coachB'))).json();
assert.deepEqual(fullCoachCalendar.activities.map(a=>[a.type,a.date,a.start]),[
 ['Clinic','2026-12-18','17:00'],['Additional practice','2026-12-18','18:30'],['Event','2026-12-19',null],['Camp','2026-12-20','09:00']]);
const nextCoachMonth=await (await plans.GET(req('GET',null,'coachB','https://academy.test','2027-01'))).json();
assert.deepEqual(nextCoachMonth.activities.map(a=>[a.name,a.date,a.start]),[['Winter Camp','2027-01-02','10:00']]);
assert.equal((await (await plans.GET(req())).json()).activities.length,0);
console.log('Passed: coach calendar includes camps, clinics, events, and additional practices on their scheduled dates.');

// Coach submissions are private until submitted and never overwrite the official plan without owner publication.
sqlite.prepare('UPDATE staff_access SET active=1 WHERE email=?').run('a@coach.test');
const post=async (input,session='owner')=>plans.POST(req('POST',input,session));
const get=async session=>(await plans.GET(req('GET',null,session))).json();
const draft={...otherDay,action:'coachDraft',revision:0,data:{...plan,title:'Coach draft'}};
assert.equal((await post(draft,'coachB')).status,403);
assert.equal((await post({...draft,date:'2026-12-28'},'coachA')).status,409);
assert.equal((await post(draft,'coachA')).status,200);
assert.equal((await post(draft,'coachA')).status,409);
assert.equal((await get('owner')).submissions.length,0);
assert.equal((await get('coachB')).submissions.length,0);
const privateDraft=(await get('coachA')).submissions[0];
assert.equal(privateDraft.status,'draft');
assert.equal(privateDraft.data.title,'Coach draft');
const submit={...draft,action:'coachSubmit',revision:1,data:{...plan,title:'Coach submission'}};
assert.equal((await post(submit,'coachA')).status,200);
assert.equal((await post({...submit,revision:2},'coachA')).status,409);
assert.equal((await get('coachA')).plans.find(p=>p.date===draft.date).data.title,'Leg attacks');
const submitted=(await get('owner')).submissions[0];
assert.equal(submitted.coachName,'Coach A');
assert.equal(submitted.data.title,'Coach submission');
assert.equal((await get('coachB')).submissions.length,0);
const review={...submit,action:'reviewSave',submissionId:submitted.id,revision:submitted.revision,data:{...plan,title:'Owner-edited draft'}};
assert.equal((await post(review,'coachA')).status,403);
assert.equal((await post(review)).status,200);
assert.equal((await get('coachB')).plans.find(p=>p.date===draft.date).data.title,'Leg attacks');
const publish={...review,action:'reviewPublish',revision:review.revision+1,planRevision:2,data:{...plan,title:'Approved and published'}};
assert.equal((await post({...publish,planRevision:1})).status,409);
assert.equal((await get('owner')).submissions[0].status,'submitted');
assert.equal((await post(publish)).status,200);
assert.equal((await get('owner')).submissions.length,0);
assert.equal((await get('coachA')).submissions[0].status,'published');
assert.equal((await get('coachB')).plans.find(p=>p.date===draft.date).data.title,'Approved and published');
assert.equal((await post({...publish,planRevision:3,data:{...plan,title:'Must not overwrite'}})).status,409);
assert.equal((await get('coachB')).plans.find(p=>p.date===draft.date).data.title,'Approved and published');

// First publication also creates the official plan if none exists.
const firstSubmission={...submit,date:'2026-12-21',revision:0};
assert.equal((await post(firstSubmission,'coachA')).status,200);
const newProposal=(await get('owner')).submissions[0];
assert.equal((await post({...publish,date:firstSubmission.date,revision:newProposal.revision,submissionId:newProposal.id,planRevision:0})).status,200);
assert.ok((await get('coachB')).plans.some(p=>p.date===firstSubmission.date));
sqlite.prepare('UPDATE staff_access SET programs=? WHERE email=?').run('["Elementary","Advanced"]','a@coach.test');
assert.deepEqual((await get('coachA')).draftPrograms,['Elementary','Advanced']);
assert.equal((await post({...draft,program:'Advanced'},'coachA')).status,200);
assert.deepEqual((await get('coachA')).submissions.map(p=>p.program),['Advanced','Elementary','Elementary']);
sqlite.prepare('UPDATE staff_access SET programs=? WHERE email=?').run('[]','a@coach.test');
assert.equal((await post(firstSubmission,'coachA')).status,403);
assert.equal((await get('coachA')).submissions.length,0);
console.log('Passed: assigned coach draft and submit, private access, owner editing and publication, stale updates, replay protection, and live assignment revocation.');

const preview=async ()=>(await plans.GET(req('GET',null,'owner','https://academy.test','2026-12&coachView=1'))).json();
assert.deepEqual((await preview()).draftPrograms,['Elementary','Intermediate','Advanced']);
assert.equal((await post({...draft,program:'Advanced'},'owner')).status,200);
assert.equal((await preview()).submissions[0].status,'draft');
assert.equal((await get('coachB')).submissions.length,0);
assert.equal((await get('owner')).submissions.length,0);
assert.equal((await post({...submit,program:'Advanced'},'owner')).status,200);
assert.equal((await get('owner')).submissions[0].coachName,'Academy owner');
console.log('Passed: owner can draft and submit in Coach View while other coaches retain assignment-scoped access.');
