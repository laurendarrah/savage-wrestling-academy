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

const requests=load('app/api/program-approvals/route.ts'),decisions=load('app/api/owner-approvals/route.ts'),chat=load('app/api/approval-chat/route.ts'),registration=load('app/api/registration/route.ts');
let requestCounter=0;
function req(path,method='GET',body,session='alice',origin='https://academy.test'){return new Request('https://academy.test'+path,{method,headers:{'content-type':'application/json',origin,'cf-connecting-ip':'192.0.2.'+(++requestCounter%250),cookie:'test-session='+session},...(body?{body:JSON.stringify(body)}:{})})}
const profile={parentName:'Alice',phone:'555-0100',wrestlers:[{id:'kid-7',name:'Seventh Grader',grade:'7'},{id:'kid-8',name:'Eighth Grader',grade:'8'},{id:'kid-9',name:'Ninth Grader',grade:'9'},{id:'kid-6',name:'Sixth Grader',grade:'6'}]};
sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?)').run('alice-uuid','alice@example.test',JSON.stringify(profile),1,'2026-10-16');
const month=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date()).slice(0,7);
const state={programs:[{id:'Advanced',name:'Competition Training',priceCents:20000,walkInPriceCents:4000}],seasons:[]};sqlite.prepare('INSERT INTO academy_state VALUES (?,?,?,?,?)').run('academy',JSON.stringify(state),1,'owner','2026-10-16');
const review=(kid,extra={})=>registration.POST(req('/api/registration','POST',{wrestlerId:kid,program:'Advanced',plan:'monthly',...extra}));
assert.equal((await review('kid-7',{approved:true,grade:'9',userId:'owner-uuid'})).status,403);
assert.equal((await review('kid-8')).status,403);assert.equal((await review('kid-6')).status,403);assert.equal((await review('kid-9')).status,403);
assert.equal((await review('foreign-kid')).status,404);
assert.equal((await requests.POST(req('/api/program-approvals','POST',{action:'request',wrestlerId:'kid-7',status:'approved'}))).status,200);
let data=await (await requests.GET(req('/api/program-approvals'))).json();assert.equal(data.approvals[0].status,'pending');const id=data.approvals[0].id;
assert.equal((await requests.POST(req('/api/program-approvals','POST',{action:'request',wrestlerId:'kid-7'}))).status,200);assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM program_approvals').get().n,1);
assert.equal((await requests.GET(req('/api/program-approvals','GET',null,'bob'))).status,200);assert.equal((await (await requests.GET(req('/api/program-approvals','GET',null,'bob'))).json()).approvals.length,0);
assert.equal((await chat.GET(req('/api/approval-chat?requestId='+id,'GET',null,'bob'))).status,404);
assert.equal((await chat.POST(req('/api/approval-chat','POST',{requestId:id,message:'stolen'},'bob'))).status,404);
assert.equal((await chat.POST(req('/api/approval-chat','POST',{requestId:id,message:'Three years of experience.',senderRole:'owner'}))).status,200);
assert.equal(sqlite.prepare('SELECT sender_role FROM approval_messages').get().sender_role,'parent');
assert.equal((await chat.POST(req('/api/approval-chat','POST',{requestId:id,message:'Let’s discuss partners and pace.'},'owner'))).status,200);
assert.equal((await (await chat.GET(req('/api/approval-chat?requestId='+id))).json()).messages.length,2);
assert.equal((await decisions.GET(req('/api/owner-approvals','GET',null,'alice'))).status,403);
let row=(await (await decisions.GET(req('/api/owner-approvals','GET',null,'owner'))).json()).requests[0];
assert.equal((await decisions.POST(req('/api/owner-approvals','POST',{id,status:'approved',updatedAt:row.updated_at},'alice'))).status,403);
assert.equal((await decisions.POST(req('/api/owner-approvals','POST',{id,status:'approved',updatedAt:row.updated_at},'owner','https://evil.test'))).status,403);
assert.equal((await decisions.POST(req('/api/owner-approvals','POST',{id,status:'approved',updatedAt:row.updated_at},'owner'))).status,200);
assert.equal((await decisions.POST(req('/api/owner-approvals','POST',{id,status:'declined',updatedAt:row.updated_at},'owner'))).status,409);
assert.equal((await review('kid-7')).status,200);
assert.equal((await review('kid-8')).status,403);
// A parent cannot overwrite an approval decision by resubmitting.
await requests.POST(req('/api/program-approvals','POST',{action:'request',wrestlerId:'kid-7'}));assert.equal((await review('kid-7')).status,200);
row=sqlite.prepare('SELECT * FROM program_approvals WHERE id=?').get(id);
assert.equal((await decisions.POST(req('/api/owner-approvals','POST',{id,status:'declined',updatedAt:row.updated_at},'owner'))).status,200);assert.equal((await review('kid-7')).status,403);
await requests.POST(req('/api/program-approvals','POST',{action:'request',wrestlerId:'kid-7'}));assert.equal((await review('kid-7')).status,403);
// Owner MFA cannot be bypassed for decisions or chat.
levels.owner='aal1';assert.equal((await decisions.GET(req('/api/owner-approvals','GET',null,'owner'))).status,403);assert.equal((await chat.GET(req('/api/approval-chat?requestId='+id,'GET',null,'owner'))).status,403);levels.owner='aal2';
profile.wrestlers[0].name='Different Wrestler';sqlite.prepare('UPDATE family_accounts SET payload=? WHERE user_id=?').run(JSON.stringify(profile),'alice-uuid');
assert.equal((await (await requests.GET(req('/api/program-approvals'))).json()).approvals.length,0);
assert.equal((await decisions.POST(req('/api/owner-approvals','POST',{id,status:'approved',updatedAt:sqlite.prepare('SELECT updated_at FROM program_approvals WHERE id=?').get(id).updated_at},'owner'))).status,409);
assert.equal((await chat.POST(req('/api/approval-chat','POST',{requestId:id,message:'x'.repeat(2001)}))).status,400);
assert.equal((await chat.POST(req('/api/approval-chat','POST',{requestId:id,message:'bad origin'},'alice','https://evil.test'))).status,403);
// High-school wrestlers also require a saved coach decision for both plans.
for(const grade of ['9','12']){
 profile.wrestlers[2].grade=grade;sqlite.prepare('UPDATE family_accounts SET payload=? WHERE user_id=?').run(JSON.stringify(profile),'alice-uuid');
 assert.equal((await review('kid-9')).status,403);assert.equal((await review('kid-9',{plan:'walkin'})).status,403);
 assert.equal((await requests.POST(req('/api/program-approvals','POST',{action:'request',wrestlerId:'kid-9'}))).status,200);
 const approval=sqlite.prepare('SELECT * FROM program_approvals WHERE wrestler_id=?').get('kid-9');
 assert.equal((await decisions.POST(req('/api/owner-approvals','POST',{id:approval.id,status:'approved',updatedAt:approval.updated_at},'owner'))).status,200);
 assert.equal((await review('kid-9')).status,200);
}
console.log('Passed: grade gates, forged approval rejection, parent request isolation, owner decisions and revocation, stale profile/decision protection, private chat isolation, sender-role enforcement, MFA, validation and CSRF.');

// Saved profile grades control every program, for membership and walk-in requests.
state.programs.push({id:'Elementary',name:'Elementary Wrestling',priceCents:20000,walkInPriceCents:4000},{id:'Intermediate',name:'Development Wrestling',priceCents:20000,walkInPriceCents:4000});sqlite.prepare('UPDATE academy_state SET payload=?').run(JSON.stringify(state));
for(const [program,allowed,blocked] of [['Elementary',['K','1','6'],['7','12','Adult']],['Intermediate',['7','12'],['K','1','6','Adult']]]){
 for(const grade of [...allowed,...blocked]){profile.wrestlers[0].grade=grade;sqlite.prepare('UPDATE family_accounts SET payload=? WHERE user_id=?').run(JSON.stringify(profile),'alice-uuid');const r=await review('kid-7',{program,grade:allowed[0],approved:true});assert.equal(r.status,allowed.includes(grade)?200:403,program+' '+grade);if(!allowed.includes(grade)){const r=await review('kid-7',{program,plan:'walkin',grade:allowed[0]});assert.equal(r.status,403)}}
}
console.log('Passed: Elementary and Development lower/upper grade boundaries, kindergarten acceptance, adult rejection, saved-profile checks, forged grade rejection and walk-in gates.');

profile.wrestlers[0].grade='7';sqlite.prepare('UPDATE family_accounts SET payload=? WHERE user_id=?').run(JSON.stringify(profile),'alice-uuid');
state.teamCodes=[{id:'team-1',name:'School team',code:'SCHOOL15',percent:15,programs:['Intermediate'],active:true}];
const date=new Date(Date.now()+3*86400000).toISOString().slice(0,10),day=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date(date+'T12:00:00Z').getUTCDay()];state.seasons=[{program:'Intermediate',start:date,end:date,weekly:[{day,start:'18:00',end:'19:30'}],excludedDates:[]}];sqlite.prepare('UPDATE academy_state SET payload=?').run(JSON.stringify(state));
const pricing=await review('kid-7',{program:'Intermediate',teamCode:' school15 ',percent:100,cents:0});assert.equal(pricing.status,200);const priced=(await pricing.json()).review;assert.equal(priced.baseCents,20000);assert.equal(priced.cents,17000);assert.equal(priced.discount.percent,15);
assert.equal((await review('kid-7',{program:'Intermediate',teamCode:'MISSING'})).status,400);
assert.equal((await review('kid-7',{program:'Intermediate',plan:'walkin',date,practiceId:'Intermediate:'+date+':18:00',teamCode:'SCHOOL15'})).status,400);
assert.equal((await review('kid-7',{program:'Intermediate',plan:'walkin',date,practiceId:'Intermediate:'+date+':18:00'})).status,200);
state.seasons.push({...state.seasons[0],program:'Advanced'});sqlite.prepare('UPDATE academy_state SET payload=?').run(JSON.stringify(state));
const advancedWalkIn={plan:'walkin',date,practiceId:'Advanced:'+date+':18:00'};
assert.equal((await review('kid-8',{...advancedWalkIn,approved:true})).status,403);
const approvedWalkIn=await review('kid-9',advancedWalkIn);assert.equal(approvedWalkIn.status,200);
const advanceReview=await approvedWalkIn.json();assert.equal(advanceReview.review.cents,4000);assert.equal(advanceReview.review.practice.date,date);assert.equal(advanceReview.paymentsEnabled,false);

const publicCatalog=await (await registration.GET(req('/api/registration'))).json();assert.equal(JSON.stringify(publicCatalog).includes('SCHOOL15'),false);assert.equal(publicCatalog.teamCodes,undefined);
state.teamCodes[0].active=false;sqlite.prepare('UPDATE academy_state SET payload=?').run(JSON.stringify(state));assert.equal((await review('kid-7',{program:'Intermediate',teamCode:'SCHOOL15'})).status,400);state.teamCodes[0].active=true;state.teamCodes[0].programs=['Elementary'];sqlite.prepare('UPDATE academy_state SET payload=?').run(JSON.stringify(state));assert.equal((await review('kid-7',{program:'Intermediate',teamCode:'SCHOOL15'})).status,400);
console.log('Passed: real registration review uses saved team code percentage, rejects forged prices/inactive/wrong-program/walk-in codes and keeps codes out of customer catalogs.');

// The website sees a deliberately public projection, never the private academy state.
const publicApi=load('app/api/public-schedule/route.ts'),booking=load('app/api/booking-review/route.ts');
state.events=[{id:'camp-live',name:'Winter Camp',type:'Camp',dates:[date,new Date(Date.parse(date+'T12:00:00Z')+86400000).toISOString().slice(0,10)],price:125.50,day:70.25,slots:20},{id:'old',name:'Old clinic',type:'Clinic',dates:['2020-01-01'],price:10,slots:5},{id:'hidden',name:'Hidden event',type:'Event',dates:[date],price:10,slots:5,archived:true}];state.kids=[{name:'PRIVATE_CHILD'}];state.contact={email:'PRIVATE_PARENT'};state.messages=[{body:'PRIVATE_MESSAGE'}];state.programs[0].secret='PRIVATE_PROGRAM_FIELD';sqlite.prepare('UPDATE academy_state SET payload=?').run(JSON.stringify(state));
const publicRes=await publicApi.GET(new Request('https://academy.test/api/public-schedule?month='+date.slice(0,7))),publicData=await publicRes.json();assert.equal(publicRes.status,200);assert.equal(publicRes.headers.get('Access-Control-Allow-Origin'),'*');assert.equal(publicData.events.length,1);assert.equal(publicData.events[0].cents,12550);assert.equal(publicData.events[0].dayCents,7025);assert.equal(publicData.privateFormats.length,3);assert.doesNotMatch(JSON.stringify(publicData),/PRIVATE_|SCHOOL15|user_id|wrestler_name|sender_role/);assert.equal(publicData.practices.length,2);assert.equal((await publicApi.GET(new Request('https://academy.test/api/public-schedule?month=bad'))).status,400);
const bReq=(body,session='alice',origin='https://academy.test')=>req('/api/booking-review','POST',body,session,origin),bBody={type:'event',id:'camp-live',wrestlerId:'kid-7',option:'full'};
let b=await booking.POST(bReq({...bBody,cents:0,price:0}));assert.equal(b.status,200);let br=await b.json();assert.equal(br.review.cents,12550);assert.equal(br.paymentsEnabled,false);assert.match(br.review.message,/No enrollment|no payment/i);assert.equal((await booking.POST(bReq({...bBody,wrestlerId:'foreign'}))).status,404);assert.equal((await booking.POST(bReq(bBody,'bob'))).status,404);assert.equal((await booking.POST(bReq(bBody,'none'))).status,401);assert.equal((await booking.POST(bReq(bBody,'alice','https://evil.test'))).status,403);assert.equal((await booking.POST(bReq({...bBody,id:'hidden'}))).status,409);assert.equal((await booking.POST(bReq({...bBody,option:'2020-01-01'}))).status,400);b=await booking.POST(bReq({...bBody,option:date}));assert.equal((await b.json()).review.cents,7025);b=await booking.POST(bReq({type:'lesson',format:'one-on-one',wrestlerId:'kid-7',price:1}));br=await b.json();assert.equal(br.review.cents,null);assert.equal(br.review.status,'inquiry_review');assert.match(br.review.message,/No lesson is reserved/);assert.equal((await booking.POST(bReq({type:'lesson',format:'invented',wrestlerId:'kid-7'}))).status,400);state.events[0].slots=0;sqlite.prepare('UPDATE academy_state SET payload=?').run(JSON.stringify(state));assert.equal((await booking.POST(bReq(bBody))).status,409);assert.equal(sqlite.prepare('SELECT revision FROM family_accounts WHERE user_id=?').get('alice-uuid').revision,1);
console.log('Passed: anonymous public calendar projection and CORS without family data/codes; archived events omitted; family-isolated booking reviews, server prices, camp days, full events, unavailable lessons, MFA/CSRF and no reservations/payments.');

levels.owner='aal1';assert.equal((await booking.POST(bReq(bBody,'owner'))).status,403);levels.owner='aal2';

// A named practice is offered only on selected dates, with server-owned dual pricing.
const fridayDate='2026-12-04';state.extraPractices=[{id:'fnl',name:'Friday Night Live',dates:[fridayDate],start:'18:00',end:'19:00',memberCents:1000,nonMemberCents:2000,enabled:true}];sqlite.prepare('UPDATE academy_state SET payload=?').run(JSON.stringify(state));
const liveBody={type:'live',id:'fnl',date:fridayDate,wrestlerId:'kid-7',member:true,cents:0};
b=await booking.POST(bReq(liveBody));assert.equal(b.status,200);br=(await b.json()).review;assert.equal(br.memberCents,1000);assert.equal(br.nonMemberCents,2000);assert.equal(br.cents,2000);assert.equal(br.memberEligible,false);assert.equal(br.includedInMembership,false);assert.equal(br.title,'Friday Night Live');assert.equal(br.dates[0],fridayDate);assert.match(br.message,/Separate purchase/);assert.match(br.message,/Non-member price applies/);
assert.equal((await booking.POST(bReq({...liveBody,wrestlerId:'foreign'}))).status,404);assert.equal((await booking.POST(bReq({...liveBody,date:'2020-01-01'}))).status,400);assert.equal((await booking.POST(bReq({...liveBody,date:'2026-12-11'}))).status,409);assert.equal((await booking.POST(bReq({...liveBody,id:'other'}))).status,409);
state.extraPractices.push({...state.extraPractices[0],id:'clinic',name:'Live Clinic',memberCents:2500,nonMemberCents:3500});sqlite.prepare('UPDATE academy_state SET payload=?').run(JSON.stringify(state));b=await booking.POST(bReq({...liveBody,id:'clinic'}));br=(await b.json()).review;assert.equal(br.memberCents,2500);assert.equal(br.title,'Live Clinic');
state.extraPractices[0].enabled=false;sqlite.prepare('UPDATE academy_state SET payload=?').run(JSON.stringify(state));assert.equal((await booking.POST(bReq(liveBody))).status,409);state.extraPractices=[];sqlite.prepare('UPDATE academy_state SET payload=?').run(JSON.stringify(state));assert.equal((await booking.POST(bReq(liveBody))).status,409);
console.log('Passed: named practice/date lookup, same-day offerings use their own prices, forged membership/amount ignored, saved wrestler isolation, unselected dates, hide and removal.');

// Annual totals and commitment length come from saved prices, not browser input.
const annual=await review('kid-7',{program:'Intermediate',plan:'annual',cents:1,totalCents:1,paymentCount:999,termMonths:1});
assert.equal(annual.status,200);
const annualBody=await annual.json();
assert.equal(annualBody.review.cents,240000);
assert.equal(annualBody.review.totalCents,240000);
assert.equal(annualBody.review.paymentCount,1);
assert.equal(annualBody.review.termMonths,12);
assert.equal(annualBody.review.renewal,'manual');
assert.equal(annualBody.review.termsStatus,'draft');
assert.equal(annualBody.paymentsEnabled,false);
const installments=await (await review('kid-7',{program:'Intermediate'})).json();
assert.equal(installments.review.paymentCount,12);
assert.equal(installments.review.totalCents,240000);
assert.equal((await review('kid-7',{program:'Intermediate',plan:'annual',teamCode:'SCHOOL15'})).status,400);
assert.equal((await review('kid-7',{program:'Advanced',plan:'annual',approved:true})).status,403);
assert.equal((await review('kid-7',{program:'Intermediate',plan:'month-to-month'})).status,400);
assert.equal((await review('foreign-kid',{program:'Intermediate',plan:'annual'})).status,404);
console.log('Passed: annual upfront price, 12 installment total, term/renewal controls, forged-price rejection, draft/payment gate and annual approval/account isolation.');
