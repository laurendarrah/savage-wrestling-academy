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
const modules=new Map();
function load(file){if(modules.has(file))return modules.get(file);const module={exports:{}};modules.set(file,module.exports);const compiled=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;vm.runInNewContext(compiled,{module,exports:module.exports,Response,Request,Headers,URL,Date,TextEncoder,Uint8Array,crypto,Set,console,require(name){if(name==='cloudflare:workers')return {env:{DB,SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'}};if(name.endsWith('/chatgpt-auth'))return {getChatGPTUser:async()=>chatgpt};if(name==='@supabase/ssr')return {parseCookieHeader(raw){return raw?raw.split(';').map(v=>({name:v.trim().split('=')[0],value:v.trim().split('=')[1]})):[]},serializeCookieHeader(name,value,options){return `${name}=${value}; Path=/; ${options.httpOnly?'HttpOnly; ':''}${options.secure?'Secure; ':''}SameSite=${options.sameSite}`},createServerClient(url,key,options){const session=options.cookies.getAll().find(c=>c.name==='test-session')?.value;return {auth:{mfa:{async getAuthenticatorAssuranceLevel(){return {data:{currentLevel:levels[session]??'aal1'},error:null}},async listFactors(){const all=users[session]?.factors??[];return {data:{all,totp:all.filter(f=>f.factor_type==='totp'&&f.status==='verified')},error:null}},async enroll(){const user=users[session];const factor={id:'new-factor-'+session,status:'unverified',factor_type:'totp'};(user.factors??=[]).push(factor);return {data:{id:factor.id,totp:{qr_code:'<svg></svg>',secret:'TEST_ONLY'}},error:null}},async unenroll({factorId}){users[session].factors=users[session].factors.filter(f=>f.id!==factorId);return {error:null}},async challengeAndVerify({factorId,code}){const factor=users[session]?.factors?.find(f=>f.id===factorId);if(!factor||code!=='123456')return {error:{message:'invalid code'}};factor.status='verified';levels[session]='aal2';return {error:null}}},async getUser(){return {data:{user:users[session]??null},error:users[session]?null:{code:'unauthorized'}}},async signInWithPassword(input){if(loginError)return {data:{user:null},error:loginError};if(input.password!=='valid-password')return {data:{user:null},error:{code:'invalid_credentials'}};const entry=Object.entries(users).find(([id,u])=>u.email===input.email&&u.email_confirmed_at);options.cookies.setAll([{name:'test-session',value:entry?.[0]??'',options:{}}],{});return {data:{user:entry?.[1]??null},error:null}},async signUp(input){lastSignup=input;return {data:{user:null},error:null}},async resetPasswordForEmail(email,options){resetTo=options.redirectTo;return {error:emailError}},async resend(){return {error:emailError}},async updateUser(){changeCount++;return {error:null}},async signOut(){options.cookies.setAll([{name:'test-session',value:'',options:{}}],{});return {error:null}}}}}};if(name.startsWith('.')){const path=new URL(name+'.ts',new URL(file,'file://'+process.cwd()+'/')).pathname;return load(path)}return realRequire(name)}});return module.exports}
const auth=load('app/api/auth/route.ts'),family=load('app/api/family/route.ts'),academy=load('app/api/academy/route.ts');
let requestCounter=0;
function request(path,method='GET',body,session='',origin='https://academy.test'){return new Request('https://academy.test'+path,{method,headers:{'content-type':'application/json',origin,'cf-connecting-ip':'192.0.2.'+(++requestCounter%250),cookie:session?'test-session='+session:''},...(body?{body:JSON.stringify(body)}:{})})}
assert.equal((await family.GET(request('/api/family'))).status,401);
assert.equal((await academy.GET(request('/api/academy','GET',null,'alice'))).status,403);
assert.equal((await academy.GET(request('/api/academy','GET',null,'unverified'))).status,403);
assert.equal((await academy.GET(request('/api/academy','GET',null,'owner'))).status,200);
chatgpt={userId:'owner-chatgpt',email:'savagewrestlingclub@gmail.com'};
assert.equal((await academy.GET(request('/api/academy'))).status,403);
assert.equal((await academy.GET(request('/api/academy','GET',null,'alice'))).status,403);chatgpt=null;
assert.equal((await auth.POST(request('/api/auth','POST',{action:'login',email:'alice@example.test',password:'valid-password'},'','https://evil.test'))).status,403);
assert.equal((await auth.POST(request('/api/auth','POST',{action:'signup',email:'alice@example.test',password:'short'}))).status,400);
assert.equal((await auth.POST(request('/api/auth','POST',{action:'signup',email:'alice@example.test',password:'long-enough-password',role:'owner'}))).status,200);
assert.equal(lastSignup.role,undefined);assert.match(lastSignup.options.emailRedirectTo,/\/auth\/confirm$/);
const signed=await auth.POST(request('/api/auth','POST',{action:'login',email:'alice@example.test',password:'valid-password'}));assert.equal((await signed.json()).redirect,'/family');assert.match(signed.headers.get('set-cookie'),/HttpOnly/);assert.match(signed.headers.get('set-cookie'),/Secure/);
const bad=await auth.POST(request('/api/auth','POST',{action:'login',email:'bob@example.test',password:'bad-password'}));assert.equal(bad.status,401);
for(const error of [{status:540},{status:503,code:'unexpected_failure'},{status:0,name:'AuthRetryableFetchError'}]){loginError=error;const r=await auth.POST(request('/api/auth','POST',{action:'login',email:'alice@example.test',password:'valid-password'}));assert.equal(r.status,503);assert.match((await r.json()).error,/password has not been checked/)}
loginError={code:'email_not_confirmed'};assert.equal((await auth.POST(request('/api/auth','POST',{action:'login',email:'alice@example.test',password:'valid-password'}))).status,401);
loginError={status:429};assert.equal((await auth.POST(request('/api/auth','POST',{action:'login',email:'alice@example.test',password:'valid-password'}))).status,429);loginError=null;

assert.equal((await auth.POST(request('/api/auth','POST',{action:'change',password:'long-enough-password'}))).status,401);assert.equal(changeCount,0);
await auth.POST(request('/api/auth','POST',{action:'reset',email:'bob@example.test'}));assert.match(resetTo,/\/auth\/confirm\?next=/);
emailError={code:'over_email_send_rate_limit',status:429};
for(const action of ['reset','resend']){const r=await auth.POST(request('/api/auth','POST',{action,email:'limited@example.test'}));assert.equal(r.status,429);const body=await r.json();assert.equal(body.message,undefined);assert.match(body.error,/could not be sent/)}
emailError={code:'smtp_error',status:500};
for(const action of ['reset','resend']){const r=await auth.POST(request('/api/auth','POST',{action,email:'unavailable@example.test'}));assert.equal(r.status,502);assert.equal((await r.json()).message,undefined)}
emailError=null;
const state={parentName:'Alice',phone:'555-0100',wrestlers:[{id:'athlete-a',name:'Wrestler A',grade:'5'}]};
assert.equal((await family.PUT(request('/api/family','PUT',{revision:0,userId:'bob-uuid',data:state},'alice'))).status,200);
assert.equal(sqlite.prepare('SELECT user_id FROM family_accounts').get().user_id,'alice-uuid');
const alice=(await (await family.GET(request('/api/family','GET',null,'alice'))).json());assert.equal(alice.data.parentName,'Alice');
const bob=(await (await family.GET(request('/api/family','GET',null,'bob'))).json());assert.equal(bob.data.parentName,'');assert.equal(bob.data.wrestlers.length,0);
assert.equal((await family.PUT(request('/api/family','PUT',{revision:0,data:state},'alice'))).status,409);
assert.equal((await family.PUT(request('/api/family','PUT',{revision:1,data:state},'alice','https://evil.test'))).status,403);
assert.equal((await family.PUT(request('/api/family','PUT',{revision:1,data:{...state,wrestlers:[{id:'bad',name:'',grade:'5'}]}},'alice'))).status,400);
assert.equal((await family.PUT(request('/api/family','PUT',{revision:1,data:{...state,role:'owner',membership:'paid'}},'alice'))).status,200);
const stored=JSON.parse(sqlite.prepare('SELECT payload FROM family_accounts').get().payload);assert.equal(stored.role,undefined);assert.equal(stored.membership,undefined);
let status;for(let i=0;i<12;i++)status=(await auth.POST(request('/api/auth','POST',{action:'login',email:'attack@example.test',password:'invalid'}))).status;assert.equal(status,429);
const response=await auth.GET(request('/api/auth','GET',null,'owner'));assert.equal((await response.json()).user.role,'owner');assert.match(response.headers.get('Cache-Control'),/no-store/);
console.log('Passed: verified owner authorization, family isolation, forged IDs/roles rejected, private cookies, CSRF checks, validation, stale-write protection, auth rate limits, reset URL, password change protection, existing owner access.');

export {load,request,DB,sqlite,users,levels};
