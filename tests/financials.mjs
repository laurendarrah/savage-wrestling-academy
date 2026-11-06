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
const objects=new Map();const BUCKET={async put(key,value){objects.set(key,new Uint8Array(value))},async get(key){const b=objects.get(key);return b?{body:b}:null},async delete(key){objects.delete(key)}};
const modules=new Map();
function load(file){if(modules.has(file))return modules.get(file);const module={exports:{}};modules.set(file,module.exports);const compiled=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;vm.runInNewContext(compiled,{module,exports:module.exports,Response,Request,Headers,URL,Date,TextEncoder,TextDecoder,Uint8Array,crypto,Set,console,require(name){if(name==='cloudflare:workers')return {env:{DB,BUCKET,SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'}};if(name.endsWith('/chatgpt-auth'))return {getChatGPTUser:async()=>chatgpt};if(name==='@supabase/ssr')return {parseCookieHeader(raw){return raw?raw.split(';').map(v=>({name:v.trim().split('=')[0],value:v.trim().split('=')[1]})):[]},serializeCookieHeader(name,value,options){return `${name}=${value}; Path=/; ${options.httpOnly?'HttpOnly; ':''}${options.secure?'Secure; ':''}SameSite=${options.sameSite}`},createServerClient(url,key,options){const session=options.cookies.getAll().find(c=>c.name==='test-session')?.value;return {auth:{mfa:{async getAuthenticatorAssuranceLevel(){return {data:{currentLevel:levels[session]??'aal1'},error:null}},async listFactors(){const all=users[session]?.factors??[];return {data:{all,totp:all.filter(f=>f.factor_type==='totp'&&f.status==='verified')},error:null}},async enroll(){const user=users[session];const factor={id:'new-factor-'+session,status:'unverified',factor_type:'totp'};(user.factors??=[]).push(factor);return {data:{id:factor.id,totp:{qr_code:'<svg></svg>',secret:'TEST_ONLY'}},error:null}},async unenroll({factorId}){users[session].factors=users[session].factors.filter(f=>f.id!==factorId);return {error:null}},async challengeAndVerify({factorId,code}){const factor=users[session]?.factors?.find(f=>f.id===factorId);if(!factor||code!=='123456')return {error:{message:'invalid code'}};factor.status='verified';levels[session]='aal2';return {error:null}}},async getUser(){return {data:{user:users[session]??null},error:users[session]?null:{code:'unauthorized'}}},async signInWithPassword(input){if(loginError)return {data:{user:null},error:loginError};if(input.password!=='valid-password')return {data:{user:null},error:{code:'invalid_credentials'}};const entry=Object.entries(users).find(([id,u])=>u.email===input.email&&u.email_confirmed_at);options.cookies.setAll([{name:'test-session',value:entry?.[0]??'',options:{}}],{});return {data:{user:entry?.[1]??null},error:null}},async signUp(input){lastSignup=input;return {data:{user:null},error:null}},async resetPasswordForEmail(email,options){resetTo=options.redirectTo;return {error:emailError}},async resend(){return {error:emailError}},async updateUser(){changeCount++;return {error:null}},async signOut(){options.cookies.setAll([{name:'test-session',value:'',options:{}}],{});return {error:null}}}}}};if(name.startsWith('.')){const path=new URL(name+'.ts',new URL(file,'file://'+process.cwd()+'/')).pathname;return load(path)}return realRequire(name)}});return module.exports}


const api=load('app/api/financials/route.ts');users.weakOwner={...users.owner};levels.weakOwner='aal1';
function req(path='/api/financials',method='GET',body,session='owner',origin='https://academy.test'){return new Request('https://academy.test'+path,{method,headers:{'content-type':'application/json',origin,cookie:session?'test-session='+session:''},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})})}
async function post(body,expect=200){const r=await api.POST(req('/api/financials','POST',body));assert.equal(r.status,expect,await r.clone().text());return r.json()}
for(const user of ['', 'alice','weakOwner','unverified']){assert.equal((await api.GET(req('/api/financials','GET',undefined,user))).status,403);assert.equal((await api.POST(req('/api/financials','POST',{action:'add'},user))).status,403)}
const income={action:'add',kind:'income',category:'Memberships',date:'2026-10-01',description:'Synthetic income',amount:'200.10'};
assert.equal((await api.POST(req('/api/financials','POST',income,'owner','https://evil.test'))).status,403);await post('x'.repeat(4097),413);
for(const bad of [{amount:'0.00'},{amount:'1.234'},{amount:'2e3'},{amount:'1000000.01'},{amount:-1},{category:'Rent'},{date:'2026-02-29'},{date:'2099-01-01'},{description:''}])await post({...income,...bad},400);
const a=await post(income),b=await post({...income,kind:'expense',category:'Rent',amount:'59.99',date:'2026-10-31'});await post({...income,date:'2026-09-30',amount:'20'});
let r=await api.GET(req('/api/financials?month=2026-10')),d=await r.json();assert.match(r.headers.get('cache-control'),/no-store/);assert.deepEqual(d.totals,{income:20010,expenses:5999,count:2,net:14011});assert.equal(d.entries.length,2);
await post({...income,action:'edit',id:a.id,revision:1,amount:'201.32'});await post({...income,action:'edit',id:a.id,revision:1,amount:'25.00'},409);await post({action:'void',id:a.id,revision:2});await post({...income,action:'edit',id:a.id,revision:3},409);
d=await (await api.GET(req('/api/financials?month=2026-10'))).json();assert.deepEqual(d.totals,{income:0,expenses:5999,count:1,net:-5999});assert(d.entries.find(e=>e.id===a.id).voided_at);assert.equal(sqlite.prepare("SELECT count(*) AS n FROM security_events WHERE action LIKE 'financial_entry_%'").get().n,5);
const laterPage=await (await api.GET(req('/api/financials?month=2026-10&offset=50'))).json();
assert.equal(laterPage.entries.length,0);
assert.deepEqual(laterPage.categoryTotals,[{kind:'expense',category:'Rent',cents:5999}]);
await post({...income,date:'2025-12-31',amount:'100'});
await post({...income,date:'2026-01-01',amount:'50.01'});
const yearly='/api/financials?year=2026';
for(const session of ['', 'alice', 'weakOwner'])assert.equal((await api.GET(req(yearly,'GET',undefined,session))).status,403);
const annual=await (await api.GET(req(yearly))).json();
assert.equal(annual.year,'2026');
assert.equal(annual.months.length,12);
assert.deepEqual(annual.months[0],{month:'2026-01',income:5001,expenses:0,count:1,net:5001});
assert.deepEqual(annual.months[9],{month:'2026-10',income:0,expenses:5999,count:1,net:-5999});
assert.deepEqual(annual.months[11],{month:'2026-12',income:0,expenses:0,count:0,net:0});
assert.deepEqual(annual.totals,{income:7001,expenses:5999,count:3,net:1002});
assert.deepEqual(annual.categoryTotals,[
 {kind:'income',category:'Memberships',cents:7001},
 {kind:'expense',category:'Rent',cents:5999}
]);
for(const query of ['year=','year=1899','year=2026-01','year=2026&month=2026-01'])assert.equal((await api.GET(req('/api/financials?'+query))).status,400);
for(const url of ['/api/financials?month=2026-13','/api/financials?offset=-1'])assert.equal((await api.GET(req(url))).status,400);
const month={Intl,Date};vm.runInNewContext(readFileSync('public/month-controls.js','utf8'),month);const m=month.SwaMonths;assert.equal(m.label('2026-11'),'November 2026');assert.equal(m.move('2026-12',1),'2027-01');assert.equal(m.move('2027-01',-1),'2026-12');assert.equal(m.move('1900-01',-1),'');assert.equal(m.move('9999-12',1),'');assert.match(m.options('2026-11'),/November 2026/);
for(const f of ['app/financials/screen.html','app/coach/screen.html','app/private-lessons/screen.html','app/practice-plans/screen.html','app/portal.html']){const html=readFileSync(f,'utf8');assert.doesNotMatch(html,/type=["']month/);assert.match(html,/Previous month/);assert.match(html,/Next month/);for(const [,script] of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(script,{filename:f})}
console.log('Passed private owner ledger, exact cents, monthly and calendar-year totals, validation, edits, void history, audit, named month labels and year rollover.');

const lessonEntry=sqlite.prepare(`INSERT INTO coach_time_entries
 (id,user_id,coach_name,coach_email,program,duty,work_date,started_at,closed_at,rate_cents,lesson_format,approved_lesson_gross_cents,approved_at,voided_at)
 VALUES (?, 'sample', 'Sample Coach', 'sample@example.test', 'Private lesson', 'private_lesson', ?, '2026-10-01T12:00:00Z', '2026-10-01T13:00:00Z', 0, 'small-group', ?, ?, ?)`);
lessonEntry.run('lesson-oct-1','2026-10-01',10001,'2026-10-31',null);
lessonEntry.run('lesson-oct-2','2026-10-02',10001,'2026-10-31',null);
lessonEntry.run('lesson-unapproved','2026-10-02',10001,null,null);
lessonEntry.run('lesson-voided','2026-10-02',10001,'2026-10-31','2026-10-31');
lessonEntry.run('lesson-sep','2026-09-02',10000,'2026-09-30',null);
const splitMonth=await (await api.GET(req('/api/financials?month=2026-10'))).json();
assert.deepEqual(splitMonth.lessonTotals,{count:2,grossCents:20002,coachCents:13002,businessCents:7000});
assert.deepEqual(splitMonth.totals,{income:0,expenses:5999,count:1,net:-5999});
const splitYear=await (await api.GET(req(yearly))).json();
assert.deepEqual(splitYear.lessonTotals,{count:3,grossCents:30002,coachCents:19502,businessCents:10500});
console.log('Passed: approved lesson revenue, per-session cent rounding, monthly and yearly splits, and separate ledger totals.');
