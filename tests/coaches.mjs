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
let chatgpt=null,lastSignup=null,resetTo=null,changeCount=0,emailError=null,loginError=null;
let photoDeleteFails=false;const objects=new Map();const BUCKET={async put(key,value){objects.set(key,new Uint8Array(value))},async get(key){const b=objects.get(key);return b?{body:b}:null},async delete(key){if(photoDeleteFails)throw Error('Temporary storage failure');objects.delete(key)}};
const modules=new Map();
function load(file){if(modules.has(file))return modules.get(file);const module={exports:{}};modules.set(file,module.exports);const compiled=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;vm.runInNewContext(compiled,{module,exports:module.exports,Response,Request,Headers,URL,Date,TextEncoder,TextDecoder,Uint8Array,crypto,Set,console,require(name){if(name==='cloudflare:workers')return {env:{DB,BUCKET,SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'}};if(name.endsWith('/chatgpt-auth'))return {getChatGPTUser:async()=>chatgpt};if(name==='@supabase/ssr')return {parseCookieHeader(raw){return raw?raw.split(';').map(v=>({name:v.trim().split('=')[0],value:v.trim().split('=')[1]})):[]},serializeCookieHeader(name,value,options){return `${name}=${value}; Path=/; ${options.httpOnly?'HttpOnly; ':''}${options.secure?'Secure; ':''}SameSite=${options.sameSite}`},createServerClient(url,key,options){const session=options.cookies.getAll().find(c=>c.name==='test-session')?.value;return {auth:{mfa:{async getAuthenticatorAssuranceLevel(){return {data:{currentLevel:levels[session]??'aal1'},error:null}},async listFactors(){const all=users[session]?.factors??[];return {data:{all,totp:all.filter(f=>f.factor_type==='totp'&&f.status==='verified')},error:null}},async enroll(){const user=users[session];const factor={id:'new-factor-'+session,status:'unverified',factor_type:'totp'};(user.factors??=[]).push(factor);return {data:{id:factor.id,totp:{qr_code:'<svg></svg>',secret:'TEST_ONLY'}},error:null}},async unenroll({factorId}){users[session].factors=users[session].factors.filter(f=>f.id!==factorId);return {error:null}},async challengeAndVerify({factorId,code}){const factor=users[session]?.factors?.find(f=>f.id===factorId);if(!factor||code!=='123456')return {error:{message:'invalid code'}};factor.status='verified';levels[session]='aal2';return {error:null}}},async getUser(){return {data:{user:users[session]??null},error:users[session]?null:{code:'unauthorized'}}},async signInWithPassword(input){if(loginError)return {data:{user:null},error:loginError};if(input.password!=='valid-password')return {data:{user:null},error:{code:'invalid_credentials'}};const entry=Object.entries(users).find(([id,u])=>u.email===input.email&&u.email_confirmed_at);options.cookies.setAll([{name:'test-session',value:entry?.[0]??'',options:{}}],{});return {data:{user:entry?.[1]??null},error:null}},async signUp(input){lastSignup=input;return {data:{user:null},error:null}},async resetPasswordForEmail(email,options){resetTo=options.redirectTo;return {error:emailError}},async resend(){return {error:emailError}},async updateUser(){changeCount++;return {error:null}},async signOut(){options.cookies.setAll([{name:'test-session',value:'',options:{}}],{});return {error:null}}}}}};if(name.startsWith('.')){const path=new URL(name+'.ts',new URL(file,'file://'+process.cwd()+'/')).pathname;return load(path)}return realRequire(name)}});return module.exports}

const profile=load('app/api/coach-profile/route.ts'),photo=load('app/api/coach-photo/route.ts'),staff=load('app/api/staff/route.ts'),auth=load('app/api/auth/route.ts'),confirm=load('app/auth/confirm/route.ts');
users.coach={id:'coach-id',email:'coach@example.test',email_confirmed_at:'2026-11-05',factors:[{id:'coach-factor',status:'verified',factor_type:'totp'}]};levels.coach='aal2';
users.other={id:'other-id',email:'other@example.test',email_confirmed_at:'2026-11-05',factors:[{id:'other-factor',status:'verified',factor_type:'totp'}]};levels.other='aal2';
let counter=0;
function req(path,method='GET',data,session='coach',origin='https://academy.test',headers={}){return new Request('https://academy.test'+path,{method,headers:{'content-type':'application/json',origin,cookie:session?'test-session='+session:'','cf-connecting-ip':'192.0.2.'+(++counter%250),...headers},...(data===undefined?{}:{body:typeof data==='string'||data instanceof Uint8Array?data:JSON.stringify(data)})})}
for(const session of ['', 'alice','coach'])assert.equal((await profile.GET(req('/api/coach-profile','GET',undefined,session))).status,403);
await staff.POST(req('/api/staff','POST',{action:'grant',name:'Coach Sample',email:users.coach.email,programs:['Elementary']},'owner'));
await staff.POST(req('/api/staff','POST',{action:'grant',name:'Other Sample',email:users.other.email,programs:['Advanced']},'owner'));
const blank=await (await profile.GET(req('/api/coach-profile'))).json();assert.equal(blank.revision,0);assert.equal(blank.data.name,'Coach Sample');
const data={name:'Coach Sample',phone:'555-0100',bio:'Youth coach and former wrestler.',experience:'Sample coaching history',specialties:'Neutral technique'};
for(const [session,origin,status] of [['alice','https://academy.test',403],['coach','https://evil.test',403]])assert.equal((await profile.PUT(req('/api/coach-profile','PUT',{revision:0,data},session,origin))).status,status);
levels.coach='aal1';assert.equal((await profile.PUT(req('/api/coach-profile','PUT',{revision:0,data}))).status,403);levels.coach='aal2';
for(const invalid of [{...data,bio:''},{...data,bio:'x'.repeat(3001)},{...data,phone:42},{...data,name:'  '}])assert.equal((await profile.PUT(req('/api/coach-profile','PUT',{revision:0,data:invalid}))).status,400);
assert.equal((await profile.PUT(req('/api/coach-profile','PUT',{revision:0,data,email:users.other.email,userId:'other-id',role:'owner'}))).status,200);
assert.equal(sqlite.prepare('SELECT email,user_id,revision FROM coach_profiles').get().email,users.coach.email);
assert.equal((await profile.PUT(req('/api/coach-profile','PUT',{revision:0,data}))).status,409);
assert.equal((await profile.PUT(req('/api/coach-profile','PUT',{revision:1,data:{...data,bio:'Updated bio'}}))).status,200);
assert.equal((await profile.PUT(req('/api/coach-profile','PUT',{revision:1,data}))).status,409);
assert.equal((await profile.PUT(req('/api/coach-profile','PUT','x'.repeat(16001)))).status,413);
const own=await (await profile.GET(req('/api/coach-profile?email=other@example.test'))).json();assert.equal(own.email,users.coach.email);
const other=await (await profile.GET(req('/api/coach-profile','GET',undefined,'other'))).json();assert.equal(other.revision,0);
const owner=await (await profile.GET(req('/api/coach-profile?email=coach@example.test','GET',undefined,'owner'))).json();assert.equal(owner.data.bio,'Updated bio');
const png=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
assert.equal((await photo.POST(req('/api/coach-photo','POST',png,'other','https://academy.test',{'content-type':'image/png'}))).status,409);
assert.equal((await photo.POST(req('/api/coach-photo','POST','<svg></svg>','coach','https://academy.test',{'content-type':'image/svg+xml'}))).status,415);
assert.equal((await photo.POST(req('/api/coach-photo','POST',png,'coach','https://academy.test',{'content-type':'image/png'}))).status,200);assert.equal(objects.size,1);
assert.equal((await photo.GET(req('/api/coach-photo','GET',undefined,'alice'))).status,403);
assert.equal((await photo.GET(req('/api/coach-photo?email=coach@example.test','GET',undefined,'other'))).status,404);
const image=await photo.GET(req('/api/coach-photo?email=coach@example.test','GET',undefined,'owner'));assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');assert.match(image.headers.get('cache-control'),/no-store/);
assert.equal((await photo.POST(req('/api/coach-photo','POST',png,'coach','https://academy.test',{'content-type':'image/jpeg'}))).status,415);
assert.equal((await photo.POST(req('/api/coach-photo','POST',new Uint8Array(2*1024*1024+1),'coach','https://academy.test',{'content-type':'image/png'}))).status,413);
await photo.POST(req('/api/coach-photo','POST',undefined,'coach','https://academy.test',{'x-photo-action':'remove'}));assert.equal(objects.size,0);
await auth.POST(req('/api/auth','POST',{action:'signup',context:'coach',email:users.coach.email,password:'long-enough-password'},''));assert.equal(lastSignup.options.emailRedirectTo,'https://savage-registration-preview.justinaccordino546.chatgpt.site/auth/confirm?next=coach');assert.equal(lastSignup.role,undefined);
await auth.POST(req('/api/auth','POST',{action:'signup',context:'not-a-role',email:'family@example.test',password:'long-enough-password'},''));assert.match(lastSignup.options.emailRedirectTo,/\/auth\/confirm$/);
await auth.POST(req('/api/auth','POST',{action:'reset',context:'coach',email:users.coach.email},''));assert.equal(resetTo,'https://savage-registration-preview.justinaccordino546.chatgpt.site/auth/confirm?next=change&coach=1');
await staff.POST(req('/api/staff','POST',{action:'revoke',email:users.coach.email},'owner'));assert.equal((await profile.GET(req('/api/coach-profile'))).status,403);assert.equal((await photo.GET(req('/api/coach-photo'))).status,403);assert.equal((await profile.PUT(req('/api/coach-profile','PUT',{revision:2,data}))).status,403);
// The owner can coach under the same identity without a second account or a role downgrade.
const coachApi=load('app/api/coach/route.ts'),protectedPages=load('lib/protected-page.ts'),roles=load('lib/access-control.ts');
const selfBlank=await (await profile.GET(req('/api/coach-profile','GET',undefined,'owner'))).json();assert.equal(selfBlank.owner,true);assert.equal(selfBlank.email,users.owner.email);assert.equal(selfBlank.revision,0);
const ownerData={...data,name:'Owner Example',bio:'Owner coaching bio'};
users.weakOwner={...users.owner};levels.weakOwner='aal1';
for(const handler of [profile.GET,photo.GET,coachApi.GET])assert.equal((await handler(req('/api/coach','GET',undefined,'weakOwner'))).status,403);
assert.equal((await profile.PUT(req('/api/coach-profile','PUT',{revision:0,data:ownerData},'weakOwner'))).status,403);
assert.equal((await profile.PUT(req('/api/coach-profile','PUT',{revision:0,data:ownerData,email:users.other.email,userId:users.other.id},'owner'))).status,200);
assert.equal(sqlite.prepare('SELECT user_id FROM coach_profiles WHERE email=?').get(users.owner.email).user_id,users.owner.id);
assert.equal(sqlite.prepare('SELECT payload FROM coach_profiles WHERE email=?').get(users.coach.email).payload.includes('Updated bio'),true);
const ownerStaff=await (await staff.GET(req('/api/staff','GET',undefined,'owner'))).json();assert.equal(ownerStaff.staff[0].owner,true);assert.equal(ownerStaff.staff[0].name,'Owner Example');
assert.equal((await staff.POST(req('/api/staff','POST',{action:'grant',email:users.owner.email,name:'Owner Example',programs:['Elementary','Advanced']},'owner'))).status,200);
assert.equal((await roles.accountRole(users.owner)).role,'owner');
const ownerWorkspace=await (await coachApi.GET(req('/api/coach','GET',undefined,'owner'))).json();assert.equal(ownerWorkspace.owner,true);assert.deepEqual(ownerWorkspace.programs,['Elementary','Advanced']);
assert.equal((await protectedPages.coachPage(req('/coach','GET',undefined,'owner'),'Owner coach form')).status,200);
assert.equal((await protectedPages.ownerPage(req('/','GET',undefined,'owner'),'Owner admin form')).status,200);
assert.equal((await protectedPages.coachPage(req('/coach','GET',undefined,'weakOwner'),'Owner coach form')).status,303);
assert.equal((await staff.POST(req('/api/staff','POST',{action:'revoke',email:users.owner.email},'owner'))).status,400);
assert.equal((await roles.accountRole(users.owner)).role,'owner');
const ownerPhoto=await photo.POST(req('/api/coach-photo?email=other@example.test','POST',png,'owner','https://academy.test',{'content-type':'image/png'}));assert.equal(ownerPhoto.status,200);
assert.equal((await photo.GET(req('/api/coach-photo','GET',undefined,'owner'))).status,200);
assert.equal((await photo.GET(req('/api/coach-photo?email='+users.owner.email,'GET',undefined,'other'))).status,404);
assert.equal((await profile.GET(req('/api/coach-profile?email='+users.owner.email,'GET',undefined,'other'))).status,200);const otherView=await (await profile.GET(req('/api/coach-profile?email='+users.owner.email,'GET',undefined,'other'))).json();assert.equal(otherView.email,users.other.email);assert.equal(otherView.revision,0);
assert.equal((await photo.POST(req('/api/coach-photo','POST',undefined,'owner','https://academy.test',{'x-photo-action':'remove'}))).status,200);
const ownOpening={action:'add',date:'2027-01-04',start:'16:00',end:'17:00'};assert.equal((await coachApi.POST(req('/api/coach','POST',ownOpening,'owner'))).status,200);const savedOpening=sqlite.prepare('SELECT id,user_id FROM coach_openings WHERE user_id=?').get(users.owner.id);assert.equal(savedOpening.user_id,users.owner.id);
assert.equal((await coachApi.POST(req('/api/coach','POST',{action:'remove',id:savedOpening.id},'owner'))).status,200);
// Permanent deletion requires confirmation, prior removal, and owner MFA.
const staffPost=(body,session='owner')=>staff.POST(req('/api/staff','POST',body,session));
const remove={action:'delete',email:users.coach.email,confirmed:true};
assert.equal((await staffPost(remove,'other')).status,403);
assert.equal((await staffPost(remove,'weakOwner')).status,403);
assert.equal((await staffPost({...remove,email:users.owner.email})).status,400);
assert.equal((await staffPost({...remove,confirmed:false})).status,400);
assert.equal((await staffPost({...remove,email:users.other.email})).status,409);
const grant={action:'grant',email:users.coach.email,name:'Coach Sample',programs:['Elementary']};
assert.equal((await staffPost(grant)).status,200);
assert.equal((await photo.POST(req('/api/coach-photo','POST',png,'coach','https://academy.test',{'content-type':'image/png'}))).status,200);
assert.equal((await coachApi.POST(req('/api/coach','POST',ownOpening,'coach'))).status,200);
assert.equal((await staffPost({action:'revoke',email:users.coach.email})).status,200);
photoDeleteFails=true;
assert.equal((await staffPost(remove)).status,503);
const pending=(await (await staff.GET(req('/api/staff','GET',undefined,'owner'))).json()).staff.find(row=>row.email===users.coach.email);
assert.equal(pending.active,0);
assert.equal(pending.deleting,true);
assert.equal((await staffPost(grant)).status,409);
photoDeleteFails=false;
assert.equal((await staffPost(remove)).status,200);
assert.equal(objects.size,0);
assert.equal(sqlite.prepare('SELECT email FROM staff_access WHERE email=?').get(users.coach.email),undefined);
assert.equal(sqlite.prepare('SELECT email FROM coach_profiles WHERE email=?').get(users.coach.email),undefined);
assert.equal(sqlite.prepare('SELECT id FROM coach_openings WHERE user_id=?').get(users.coach.id),undefined);
assert.equal((await profile.GET(req('/api/coach-profile?email='+users.coach.email,'GET',undefined,'owner'))).status,404);
assert.equal(sqlite.prepare("SELECT count(*) AS n FROM security_events WHERE action='coach_permanently_deleted'").get().n,1);
assert.equal((await roles.accountRole(users.coach)).role,'family');
assert.equal((await roles.accountRole(users.other)).role,'coach');
console.log('Passed: permanent coach deletion, owner protection, confirmation, storage retry, profile and opening cleanup, and preserved login.');
for(const file of ['app/coach/screen.html','app/staff/screen.html','app/coach-join/screen.html','app/login/screen.html','app/scholarships/screen.html']){const html=readFileSync(file,'utf8');for(const [,script] of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(script,{filename:file})}
const scholarship=readFileSync('app/scholarships/screen.html','utf8');assert.match(scholarship,/aria-label="Academy navigation"/);assert.match(scholarship,/aria-current="page" href="\/scholarships"/);assert.match(scholarship,/aria-controls="ownerNavigation"/);
console.log('Passed owner/coach self profile, photo, staff listing, program selection, preserved owner authorization, MFA, own openings, self-revoke prevention; coach profile ownership, MFA, revoke, validation, revisions, owner review, private photo access/type/size/delete, approved-email grants, current callback origin, coach context and sidebar/script checks.');

// Timekeeping keeps recorded timestamps, approval, and export in separate stages.
const time=load('app/api/coach-time/route.ts');
const {coachWorkDate,timePeriod}=load('lib/coach-time.ts');
const today=coachWorkDate(new Date()),month=today.slice(0,7),timePath='/api/coach-time';
const [year,monthNumber]=month.split('-').map(Number);
const priorMonth=new Date(Date.UTC(year,monthNumber-2,1)).toISOString().slice(0,7);
assert.equal(timePeriod('2028-02','full').through,'2028-02-29');
assert.equal(timePeriod('2027-02','full').through,'2027-02-28');
assert.equal(timePeriod('2026-11','second').through,'2026-11-30');
const shiftPost=(body,session='other',origin='https://academy.test')=>time.POST(req(timePath,'POST',body,session,origin));
const shiftGet=(query='',session='owner')=>time.GET(req(timePath+query,'GET',undefined,session));
const startShift={action:'start',duty:'head',program:'Advanced'};
assert.equal((await shiftPost(startShift,'alice')).status,403);
assert.equal((await shiftPost(startShift,'weakOwner')).status,403);
assert.equal((await shiftPost(startShift,'other','https://elsewhere.test')).status,403);
assert.equal((await shiftPost({...startShift,program:'Intermediate'})).status,400);
assert.equal((await shiftGet('?review=1','other')).status,403);
assert.equal((await shiftGet('?format=csv','other')).status,403);
const starts=await Promise.all([shiftPost(startShift),shiftPost(startShift)]);
assert.deepEqual(starts.map(r=>r.status).sort(),[200,409]);
let myShifts=await (await shiftGet('?month='+month,'other')).json();
const id=myShifts.active.id;
assert.equal(myShifts.active.duty,'head');
assert.equal(myShifts.active.rate,4000);
assert.equal((await (await shiftGet('?month='+month)).json()).rows.length,0);
assert.equal((await shiftPost({action:'end',id,revision:1},'owner')).status,409);
sqlite.prepare('UPDATE coach_time_entries SET started_at=? WHERE id=?').run(new Date(Date.now()-90*60000).toISOString(),id);
assert.equal((await shiftPost({action:'end',id,revision:1})).status,200);
assert.equal((await shiftPost({action:'approve',id,revision:2})).status,403);
assert.equal((await shiftPost({action:'approve',id,revision:1},'owner')).status,409);
assert.equal((await shiftPost({action:'approve',id,revision:2},'owner')).status,409);
const edit={action:'edit-draft',id,revision:2,duty:'assistant',minutes:80,note:'Corrected assistant coverage.'};
assert.equal((await shiftPost(edit,'owner')).status,409);
assert.equal((await shiftPost({...edit,note:''})).status,400);
assert.equal((await shiftPost(edit)).status,200);
const draft=(await (await shiftGet('?month='+month,'other')).json()).rows[0];
assert.equal(draft.seconds,4800);assert.equal(draft.draft_duty,'assistant');assert.equal(draft.submitted_at,null);
assert.equal(draft.duty,'head');assert.ok(draft.started_at&&draft.ended_at);
assert.equal(draft.submitted_at,null);
const currentView=await (await shiftGet('?month='+month,'other')).json();
assert.equal(currentView.submissionOpens,timePeriod(month,'full').through);
assert.equal(currentView.canSubmit,today===currentView.submissionOpens);
const submit={action:'submit',month:priorMonth,shifts:[{id,revision:3}]};
if(!currentView.canSubmit){
 const early=await shiftPost({...submit,month});
 assert.equal(early.status,409);
 assert.match((await early.json()).error,/last day/);
}
assert.equal((await shiftPost({...submit,period:'first'})).status,400);
assert.equal((await shiftPost({...submit,period:'second'})).status,400);
sqlite.prepare('UPDATE coach_time_entries SET work_date=? WHERE id=?').run(priorMonth+'-07',id);
const olderView=await (await shiftGet('?month='+priorMonth,'other')).json();
assert.equal(olderView.canSubmit,true);
const extraId='22222222-2222-2222-2222-222222222222';
sqlite.prepare(`INSERT INTO coach_time_entries (id,user_id,coach_name,coach_email,program,duty,work_date,started_at,ended_at,closed_at,rate_cents)
 SELECT ?,user_id,coach_name,coach_email,program,duty,work_date,started_at,ended_at,closed_at,rate_cents
 FROM coach_time_entries WHERE id=?`).run(extraId,id);
assert.equal((await shiftPost(submit)).status,409);
assert.equal(sqlite.prepare('SELECT submitted_at FROM coach_time_entries WHERE id=?').get(id).submitted_at,null);
sqlite.prepare('DELETE FROM coach_time_entries WHERE id=?').run(extraId);
assert.equal((await shiftPost({...submit,shifts:[{id,revision:2}]})).status,409);
assert.equal((await shiftPost({...submit,shifts:[...submit.shifts,{id:'11111111-1111-1111-1111-111111111111',revision:1}]})).status,409);
assert.equal((await shiftPost(submit)).status,200);
assert.equal((await shiftPost({...edit,revision:4})).status,409);
assert.equal((await shiftPost({action:'pull-back',id,revision:4})).status,200);
assert.equal((await shiftPost({...edit,revision:5,minutes:90})).status,200);
assert.equal((await shiftPost({...submit,shifts:[{id,revision:6}]})).status,200);
assert.equal((await shiftPost({action:'approve',id,revision:7,duty:'head',minutes:90},'owner')).status,400);
let csv=await (await shiftGet('?month='+priorMonth+'&format=csv')).text();
assert.doesNotMatch(csv,new RegExp(id));
assert.equal((await shiftPost({action:'approve',id,revision:7},'owner')).status,200);
assert.equal((await shiftPost({action:'pull-back',id,revision:8})).status,409);
const half='first';
const approved=(await (await shiftGet('?review=1&month='+priorMonth+'&period='+half)).json()).rows[0];
assert.equal(approved.approved_seconds,5400);
assert.equal(approved.gross,4500);
assert.equal(approved.duty,'head');
assert.equal(approved.approved_duty,'assistant');
assert.ok(approved.ended_at);
assert.equal((await (await shiftGet('?review=1&month='+priorMonth+'&period='+(half==='first'?'second':'first'))).json()).rows.length,0);
const exported=await shiftGet('?month='+priorMonth+'&format=csv');
assert.match(exported.headers.get('cache-control'),/no-store/);
assert.match(exported.headers.get('content-disposition'),/attachment/);
csv=await exported.text();
assert.match(csv,new RegExp(id));
assert.match(csv,/"5400","1.5000","30.00","45.00"/);
const otherExportId='33333333-3333-3333-3333-333333333333';
sqlite.prepare(`INSERT INTO coach_time_entries (id,user_id,coach_name,coach_email,program,duty,work_date,started_at,ended_at,closed_at,rate_cents,approved_seconds,approved_at)
 SELECT ?,?,?,?,program,duty,work_date,started_at,ended_at,closed_at,rate_cents,approved_seconds,approved_at FROM coach_time_entries WHERE id=?`)
 .run(otherExportId,users.coach.id,'Coach Sample',users.coach.email,id);
const coachQuery='?month='+priorMonth+'&format=csv&coach='+encodeURIComponent(users.other.email);
const coachCsv=await (await shiftGet(coachQuery)).text();
assert.match(coachCsv,new RegExp(id));
assert.doesNotMatch(coachCsv,new RegExp(otherExportId));
assert.match(await (await shiftGet('?month='+priorMonth+'&format=csv')).text(),new RegExp(otherExportId));
assert.equal((await shiftGet(coachQuery,'other')).status,403);
assert.equal((await shiftGet('?format=csv&coach=invalid')).status,400);
sqlite.prepare('DELETE FROM coach_time_entries WHERE id=?').run(otherExportId);
assert.equal((await shiftPost({action:'reopen',id,revision:8},'owner')).status,200);
assert.doesNotMatch(await (await shiftGet('?month='+priorMonth+'&format=csv')).text(),new RegExp(id));
assert.equal((await shiftPost(startShift)).status,200);
myShifts=await (await shiftGet('?month='+month,'other')).json();
const missed=myShifts.active;
assert.equal((await shiftPost({action:'approve',id:missed.id,revision:missed.revision},'owner')).status,400);
assert.equal((await shiftPost({action:'approve',id:missed.id,revision:missed.revision,minutes:45,note:'Confirmed missed clock-out.'},'owner')).status,200);
assert.equal((await (await shiftGet('?month='+month,'other')).json()).active,null);
const quoted=load('lib/coach-time.ts').timeCsv([{...approved,coach_name:'=1+1'}]);
assert.match(quoted,/"'=1\+1"/);
const timeHtml=readFileSync('app/coach-time/screen.html','utf8');
new vm.Script(timeHtml.match(/<script>([\s\S]*?)<\/script>/)[1]);
console.log('Passed: coach time isolation, single open shift, owner corrections, approval, month-end submission, half-month reporting, approved-only CSV, and reopening.');
const deleteShift={action:'delete',id:missed.id,revision:2,confirmed:true};
assert.equal((await shiftPost(deleteShift)).status,403);
assert.equal((await shiftPost({...deleteShift,confirmed:false},'owner')).status,400);
assert.equal((await shiftPost({...deleteShift,revision:1},'owner')).status,409);
assert.match(await (await shiftGet('?month='+month+'&format=csv')).text(),new RegExp(missed.id));
assert.equal((await shiftPost(deleteShift,'owner')).status,200);
assert.equal((await shiftPost(deleteShift,'owner')).status,409);
assert.doesNotMatch(await (await shiftGet('?month='+month+'&format=csv')).text(),new RegExp(missed.id));
assert(!(await (await shiftGet('?review=1&month='+month)).json()).rows.some(row=>row.id===missed.id));
assert(!(await (await shiftGet('?month='+month,'other')).json()).rows.some(row=>row.id===missed.id));
assert(sqlite.prepare('SELECT voided_at FROM coach_time_entries WHERE id=?').get(missed.id).voided_at);
assert.equal((await shiftPost(startShift)).status,200);
const openTest=(await (await shiftGet('?month='+month,'other')).json()).active;
assert.equal((await shiftPost({...deleteShift,id:openTest.id,revision:openTest.revision},'owner')).status,200);
assert.equal((await (await shiftGet('?month='+month,'other')).json()).active,null);
assert.equal((await shiftPost(startShift)).status,200);
assert.equal(sqlite.prepare("SELECT count(*) AS n FROM security_events WHERE action='coach_shift_voided'").get().n,2);
console.log('Passed: confirmed owner-only shift removal hides approved and open test shifts, excludes them from CSV, and retains an audit record.');

const leave=load('app/api/coach-time-off/route.ts');
const leavePath='/api/coach-time-off';
const leavePost=(body,session='other',origin='https://academy.test')=>leave.POST(req(leavePath,'POST',body,session,origin));
const leaveGet=(query='',session='other')=>leave.GET(req(leavePath+query,'GET',undefined,session));
const vacation={action:'request',category:'vacation',startDate:'2027-02-15',endDate:'2027-02-17',note:'Practice coverage needed.'};
assert.equal((await leavePost(vacation,'alice')).status,403);
assert.equal((await leavePost(vacation,'weakOwner')).status,403);
assert.equal((await leavePost(vacation,'other','https://elsewhere.test')).status,403);
for(const invalid of [{category:'invalid'},{startDate:'2027-02-30'},{endDate:'2027-02-14'},{note:'x'.repeat(241)}]){
 assert.equal((await leavePost({...vacation,...invalid})).status,400);
}
const requests=await Promise.all([leavePost(vacation),leavePost(vacation)]);
assert.deepEqual(requests.map(r=>r.status).sort(),[200,409]);
const ownRequest=(await (await leaveGet()).json()).requests[0];
assert.equal(ownRequest.status,'pending');
assert.equal(ownRequest.coach_name,'Other Sample');
assert.equal((await (await leaveGet('','owner')).json()).requests.length,0);
assert.equal((await leaveGet('?review=1')).status,403);
assert.equal((await (await leaveGet('?review=1','owner')).json()).requests[0].id,ownRequest.id);
const target={id:ownRequest.id,revision:ownRequest.revision};
assert.equal((await leavePost({...target,action:'approve'})).status,403);
assert.equal((await leavePost({...target,action:'withdraw'},'owner')).status,409);
const decisions=await Promise.all(['approve','decline'].map(action=>leavePost({...target,action},'owner')));
assert.deepEqual(decisions.map(r=>r.status).sort(),[200,409]);
const decision=(await (await leaveGet()).json()).requests[0];
if(decision.status==='approved'){
 assert.equal((await leavePost({...target,action:'cancel',revision:decision.revision},'owner')).status,200);
 assert.equal((await (await leaveGet('?status=cancelled')).json()).requests[0].id,ownRequest.id);
}else assert.equal((await (await leaveGet('?status=declined')).json()).requests[0].id,ownRequest.id);
assert.equal((await leavePost({...vacation,category:'sick'})).status,200);
const pendingLeave=(await (await leaveGet('?status=pending')).json()).requests[0];
assert.equal((await leavePost({action:'withdraw',id:pendingLeave.id,revision:pendingLeave.revision})).status,200);
assert.equal((await (await leaveGet('?status=withdrawn')).json()).requests[0].id,pendingLeave.id);
const leaveHtml=readFileSync('app/coach-time-off/screen.html','utf8');
new vm.Script(leaveHtml.match(/<script>([\s\S]*?)<\/script>/)[1]);
console.log('Passed: time-off privacy, date validation, overlap prevention, owner decisions, cancellation, and coach withdrawal.');

const {coachToolPage}=load('lib/coach-workspace.ts');
const panelHtml='<!doctype html><html><head></head><body><main>Coach tool</main></body></html>';
const standalone=await coachToolPage(req('/coach-time','GET',undefined,'other'),panelHtml);
assert.equal(standalone.headers.get('X-Frame-Options'),'DENY');
const embedded=await coachToolPage(req('/coach-time?embed=coach','GET',undefined,'other'),panelHtml);
assert.equal(embedded.status,200);
assert.equal(embedded.headers.get('X-Frame-Options'),'SAMEORIGIN');
assert.equal(embedded.headers.get('Content-Security-Policy'),"frame-ancestors 'self'");
assert.match(await embedded.text(),/class="coach-embedded"/);
assert.equal((await coachToolPage(req('/coach-time?embed=coach','GET',undefined,'alice'),panelHtml)).status,403);
assert.equal((await coachToolPage(req('/coach-time?embed=coach','GET',undefined,'weakOwner'),panelHtml)).status,303);

// All new private lesson formats use the collected session total and owner approval.
const openBefore=(await (await shiftGet('','other')).json()).active;
assert.equal((await shiftPost({action:'delete',id:openBefore.id,revision:openBefore.revision,confirmed:true},'owner')).status,200);
const privateLesson={action:'start',duty:'private_lesson'};
assert.equal((await shiftPost(privateLesson)).status,400);
assert.equal((await staffPost({action:'set-private-lesson-rate',email:users.other.email,rateCents:7250})).status,400);
for(const [lessonFormat,label,amount,coachPay,businessPay] of [
 ['one-on-one','One-on-one',10000,6500,3500],['partner','Two-on-one',12000,7800,4200],['small-group','Small group',16001,10401,5600]
]){
 assert.equal((await shiftPost({...privateLesson,lessonFormat})).status,200);
 const lesson=(await (await shiftGet('','other')).json()).active;
 assert.equal(lesson.lessonFormatName,label);
 assert.equal(lesson.rate,null);
 assert.equal(lesson.gross,null);
 const approve={action:'approve',id:lesson.id,revision:lesson.revision,minutes:60,note:'Confirmed lesson and missed clock-out.'};
 assert.equal((await shiftPost({...approve,lessonGrossCents:amount},'other')).status,403);
 assert.equal((await shiftPost(approve,'owner')).status,400);
 assert.equal((await shiftPost({...approve,lessonGrossCents:-1},'owner')).status,400);
 assert.equal((await shiftPost({...approve,lessonGrossCents:amount},'owner')).status,200);
 const row=(await (await shiftGet('?review=1')).json()).rows.find(s=>s.id===lesson.id);
 assert.equal(row.gross,coachPay);
 assert.deepEqual(row.lessonSplit,{grossCents:amount,coachCents:coachPay,businessCents:businessPay});
}
assert.match(await (await shiftGet('?format=csv')).text(),/"65.00".*"One-on-one","100.00","35.00"/);
assert.equal((await shiftPost({...privateLesson,lessonFormat:'partner'})).status,200);
const draftLesson=(await (await shiftGet('','other')).json()).active;
sqlite.prepare('UPDATE coach_time_entries SET started_at=? WHERE id=?').run(new Date(Date.now()-60*60000).toISOString(),draftLesson.id);
assert.equal((await shiftPost({action:'end',id:draftLesson.id,revision:1})).status,200);
assert.equal((await shiftPost({action:'edit-draft',id:draftLesson.id,revision:2,duty:'private_lesson',lessonGrossCents:10001})).status,200);
const savedLesson=(await (await shiftGet('','other')).json()).rows.find(s=>s.id===draftLesson.id);
assert.equal(savedLesson.lesson_gross_cents,10001);
assert.equal(savedLesson.gross,6501);
const {shiftView}=load('lib/coach-time.ts');
assert.equal(shiftView({...savedLesson,lesson_format:null,lesson_gross_cents:null,approved_seconds:3600,approved_rate_cents:7250}).gross,7250);
console.log('Passed: all three private lesson splits, coach draft revenue, owner confirmation, scoped payroll, and preserved hourly history.');

const {coachPracticeContext,practiceTimeReview}=load('lib/coach-practice-time.ts');
const scheduleFixture={
 programs:[{id:'Elementary',name:'Development'},{id:'Intermediate',name:'Intermediate'},{id:'Advanced',name:'Advanced'}],
 seasons:[
  {program:'Elementary',start:'2026-11-01',end:'2026-11-30',weekly:[{day:'Monday',start:'18:00',end:'19:30'}],excludedDates:['2026-11-09']},
  {program:'Intermediate',start:'2026-11-01',end:'2026-11-30',weekly:[{day:'Monday',start:'19:45',end:'21:15'}]},
  {program:'Advanced',start:'2026-11-01',end:'2026-11-30',weekly:[{day:'Sunday',start:'10:00',end:'12:00'}]}
 ]
};
const firstClock='2026-11-16T23:00:00Z';
const context=coachPracticeContext(scheduleFixture,new Date(firstClock),'Elementary',['Elementary','Intermediate']);
const shiftWith=(ended,extra={})=>({started_at:firstClock,ended_at:ended,practice_context:JSON.stringify(context),...extra});
assert.equal(context.practice.start,Date.parse('2026-11-16T23:00:00Z'));
assert.equal(context.next.start,Date.parse('2026-11-17T00:45:00Z'));
assert.deepEqual(JSON.parse(JSON.stringify(practiceTimeReview(shiftWith('2026-11-17T00:30:00Z')))),{limitMinutes:90,reasons:[]});
assert.match(practiceTimeReview(shiftWith('2026-11-17T00:40:00Z',{started_at:'2026-11-16T22:49:00Z'})).reasons.join(' '),/Clocked in before.*90 scheduled minutes/);
assert.match(practiceTimeReview(shiftWith('2026-11-17T02:25:00Z')).reasons.join(' '),/Clocked out.*90 scheduled minutes.*Possible back-to-back coverage/);
assert.match(practiceTimeReview(shiftWith('2026-11-17T00:30:00Z',{draft_seconds:91*60})).reasons.join(' '),/90 scheduled minutes/);
assert.equal(coachPracticeContext(scheduleFixture,new Date(firstClock),'Elementary',['Elementary']).next,null);
assert.equal(coachPracticeContext(scheduleFixture,new Date('2026-11-09T23:00:00Z'),'Elementary',['Elementary']).practice,null);
const sunday=coachPracticeContext(scheduleFixture,new Date('2026-11-15T14:50:00Z'),'Advanced',['Advanced']);
assert.equal(practiceTimeReview({...shiftWith('2026-11-15T17:10:00Z'),started_at:'2026-11-15T14:50:00Z',practice_context:JSON.stringify(sunday)}).limitMinutes,120);
assert.equal(practiceTimeReview({...shiftWith(null),practice_context:null}),null);
assert.match(openTest.practiceReview.reasons.join(' '),/No published practice/);
assert.match(timeHtml,/Time flag · needs review/);
console.log('Passed: scheduled 90- and 120-minute windows, early and late flags, submitted-duration flags, schedule days off, and back-to-back assignment hints.');

const demoNodes=new Map(),demoRequests=[];
function demoNode(id){
 if(!demoNodes.has(id))demoNodes.set(id,{
  value:'',hidden:true,selectedOptions:[{textContent:'Full month'}],options:[],
  focus(){this.focused=true},showModal(){this.open=true},close(){this.open=false},removeAttribute(key){delete this[key]}
 });
 return demoNodes.get(id);
}
const demoCtx=vm.createContext({
 Intl,Date,URLSearchParams,window:{},location:{search:'?review=1&demo=1'},document:{getElementById:demoNode},
 fetch:async (url,options)=>{demoRequests.push({url,options});return {ok:true,json:async()=>({rows:[]})}}
});
vm.runInContext(readFileSync('public/month-controls.js','utf8'),demoCtx);
vm.runInContext(timeHtml.match(/<script>([\s\S]*?)<\/script>/)[1],demoCtx);
const sampleRun=code=>vm.runInContext(code,demoCtx);
assert.equal(demoRequests.length,0);
assert.equal(demoNode('download').hidden,true);
assert.match(demoNode('payrollDemoEstimate').textContent,/Estimated gross if all shown shifts are approved: \$/);
assert.match(demoNode('coachSummaryRows').innerHTML,/Jordan Avery \(sample\)/);
assert.ok(sampleRun('state.rows.length')>=16);
assert.match(demoNode('shifts').innerHTML,/Possible back-to-back coverage with SWA Intermediate/);
assert.match(demoNode('payrollCoach').innerHTML,/Jordan Avery \(sample\)/);
demoNode('payrollCoach').value='jordan@example.test';
demoNode('payrollCoach').onchange();
assert.equal(demoNode('coachSummaryHeading').textContent,'Breakdown by program and role');
assert.match(demoNode('coachSummaryRows').innerHTML,/SWA Development · Head coach/);
assert.match(demoNode('coachPeriodTotal').textContent,/total entered.*estimated gross/);
const backToBackSample=sampleRun('state.rows.find(row=>row.practiceReview)');
assert.equal(backToBackSample.seconds,180*60);
assert.match(sampleRun('clock(state.rows.find(row=>row.practiceReview).ended_at)'),/9:00 PM/);
assert.match(backToBackSample.draft_note,/7:30–9:00 p.m./);
const pendingBefore=Number(demoNode('pending').textContent);
demoNode('shifts').onclick({target:{closest:()=>({dataset:{review:backToBackSample.id}})}});
assert.equal(demoNode('reviewDialog').open,true);
assert.equal(demoNode('resetReviewTime').textContent,'Use submitted time');
assert.equal(sampleRun('reviewTimeMinutes()'),null);
demoNode('reviewHours').value='24';
demoNode('reviewMinutes').value='1';
const submitReview=()=>demoNode('reviewForm').onsubmit({preventDefault(){}});
submitReview();
assert.match(demoNode('reviewError').textContent,/1 minute to 24 hours/);
assert.equal(demoNode('reviewHours').focused,true);
demoNode('resetReviewTime').onclick();
assert.equal(sampleRun('reviewTimeMinutes()'),null);
demoNode('reviewHours').value='2';
demoNode('reviewMinutes').value='45';
demoNode('reviewNote').value='Corrected example clock-out.';
submitReview();
await new Promise(resolve=>setImmediate(resolve));
assert.equal(sampleRun('state.rows.find(row=>row.practiceReview).approved_seconds'),165*60);
assert.equal(Number(demoNode('pending').textContent),pendingBefore-1);
assert.match(demoNode('status').textContent,/Sample only/);
assert.equal(demoRequests.length,0);
demoNode('togglePayrollDemo').onclick();
await new Promise(resolve=>setImmediate(resolve));
assert.equal(demoRequests.length,1);
assert.equal(demoRequests[0].options.method,undefined);
assert.doesNotMatch(demoNode('shifts').innerHTML,/Jordan Avery/);
console.log('Passed: full-month sample payroll, local approval, review flags, hidden live exports, and return to live timesheets.');

const liveFixture={rows:[
 {...approved,coach_name:'Coach One',coach_email:'one@example.test'},
 {...approved,id:'second',coach_name:'Coach Two',coach_email:'two@example.test'}
],coaches:[{email:'three@example.test',name:'Coach Three'}]};
demoCtx.fixture=liveFixture;
sampleRun('state=fixture;renderCoachFilter();render()');
assert.match(demoNode('payrollCoach').innerHTML,/Coach Three/);
demoNode('payrollCoach').value='one@example.test';
demoNode('payrollCoach').onchange();
assert.match(demoNode('shifts').innerHTML,/Coach One/);
assert.doesNotMatch(demoNode('shifts').innerHTML,/Coach Two/);
assert.equal(demoNode('hours').textContent,'1h 30m');
assert.equal(demoNode('gross').textContent,'$45.00');
assert.match(demoNode('download').href,/coach=one%40example.test/);
demoNode('payrollCoach').value='three@example.test';
demoNode('payrollCoach').onchange();
assert.match(demoNode('shifts').innerHTML,/No shifts for this coach/);
assert.equal(demoNode('download').hidden,true);
console.log('Passed: coach selector, program and role breakdown, totals for selected coach, empty periods, and owner-only scoped payroll exports.');
