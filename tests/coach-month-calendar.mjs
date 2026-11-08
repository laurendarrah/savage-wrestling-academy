// Issue #191: the coach's month calendar on /practice-plans, from the server's month to the page that draws it.
// Runs the real route against the real migrations; the page's inline script runs in a fake DOM (not typechecked).
import {readFileSync,readdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';
const realRequire=createRequire(import.meta.url);
const sqlite=new DatabaseSync(':memory:');
for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')&&!f.includes('_starter_')).sort().map(f=>'drizzle/'+f))sqlite.exec(readFileSync(file,'utf8'));
const DB={prepare(sql){let args=[];return {_sql:sql,bind(...v){args=v;return this},async first(){return sqlite.prepare(sql).get(...args)??null},async run(){return sqlite.prepare(sql).run(...args)},async all(){return {results:sqlite.prepare(sql).all(...args)}},_execute(){const stmt=sqlite.prepare(sql);return {results:stmt.columns().length?stmt.all(...args):[],...(!stmt.columns().length?{meta:stmt.run(...args)}:{})}}}},async batch(statements){sqlite.exec('BEGIN');try{const results=statements.map(s=>s._execute());sqlite.exec('COMMIT');return results}catch(e){sqlite.exec('ROLLBACK');throw e}}};
const users={owner:{id:'owner-uuid',email:'savagewrestlingclub@gmail.com',email_confirmed_at:'2026-10-15',factors:[{id:'factor-owner',status:'verified',factor_type:'totp'}]},alice:{id:'alice-uuid',email:'alice@example.test',email_confirmed_at:'2026-10-15'},bob:{id:'bob-uuid',email:'bob@example.test',email_confirmed_at:'2026-10-15'},unverified:{id:'unverified-uuid',email:'savagewrestlingclub@gmail.com'}};
const levels={owner:'aal2'};
const b64url=s=>Buffer.from(s).toString('base64url'),tokenFor=session=>users[session]?[b64url('{"alg":"HS256"}'),b64url(JSON.stringify({sub:users[session].id,aal:levels[session]??'aal1'})),b64url('sig')].join('.'):null;
let chatgpt=null,lastSignup=null,resetTo=null,changeCount=0,emailError=null;
const modules=new Map();
function load(file){if(modules.has(file))return modules.get(file);const module={exports:{}};modules.set(file,module.exports);const compiled=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;vm.runInNewContext(compiled,{module,exports:module.exports,Response,Request,Headers,URL,Date,TextEncoder,Uint8Array,crypto,Set,console,require(name){if(name==='cloudflare:workers')return {env:{DB,SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',APP_ORIGIN:'https://register.savagewrestling.example'}};if(name.endsWith('/chatgpt-auth'))return {getChatGPTUser:async()=>chatgpt};if(name==='@supabase/ssr')return {parseCookieHeader(raw){return raw?raw.split(';').map(v=>({name:v.trim().split('=')[0],value:v.trim().split('=')[1]})):[]},serializeCookieHeader(name,value,options){return `${name}=${value}; Path=/; ${options.httpOnly?'HttpOnly; ':''}${options.secure?'Secure; ':''}SameSite=${options.sameSite}`},createServerClient(url,key,options){const session=options.cookies.getAll().find(c=>c.name==='test-session')?.value;return {auth:{async getSession(){return {data:{session:users[session]?{access_token:tokenFor(session)}:null},error:null}},mfa:{async getAuthenticatorAssuranceLevel(){return {data:{currentLevel:levels[session]??'aal1'},error:null}},async listFactors(){const all=users[session]?.factors??[];return {data:{all,totp:all.filter(f=>f.factor_type==='totp'&&f.status==='verified')},error:null}},async enroll(){const user=users[session];const factor={id:'new-factor-'+session,status:'unverified',factor_type:'totp'};(user.factors??=[]).push(factor);return {data:{id:factor.id,totp:{qr_code:'<svg></svg>',secret:'TEST_ONLY'}},error:null}},async unenroll({factorId}){users[session].factors=users[session].factors.filter(f=>f.id!==factorId);return {error:null}},async challengeAndVerify({factorId,code}){const factor=users[session]?.factors?.find(f=>f.id===factorId);if(!factor||code!=='123456')return {error:{message:'invalid code'}};factor.status='verified';levels[session]='aal2';return {error:null}}},async getUser(){return {data:{user:users[session]??null},error:users[session]?null:{code:'unauthorized'}}},async signInWithPassword(input){if(input.password!=='valid-password')return {data:{user:null},error:{code:'invalid_credentials'}};const entry=Object.entries(users).find(([id,u])=>u.email===input.email&&u.email_confirmed_at);options.cookies.setAll([{name:'test-session',value:entry?.[0]??'',options:{}}],{});return {data:{user:entry?.[1]??null},error:null}},async signUp(input){lastSignup=input;return {data:{user:null},error:null}},async resetPasswordForEmail(email,options){resetTo=options.redirectTo;return {error:emailError}},async resend(){return {error:emailError}},async updateUser(){changeCount++;return {error:null}},async signOut(){options.cookies.setAll([{name:'test-session',value:'',options:{}}],{});return {error:null}}}}}};if(name.startsWith('.')){const path=new URL(name+'.ts',new URL(file,'file://'+process.cwd()+'/')).pathname;return load(path)}return realRequire(name)}});return module.exports}

const plans=load('app/api/practice-plans/route.ts');
let ip=0;
const request=(session,query,body)=>new Request('https://academy.test/api/practice-plans'+query,{method:body?'POST':'GET',headers:{'content-type':'application/json',origin:'https://academy.test',cookie:'test-session='+session,'cf-connecting-ip':'198.51.100.'+(++ip%250)},...(body?{body:JSON.stringify(body)}:{})});
async function get(session,query='?month=2026-12'){const r=await plans.GET(request(session,query));assert.equal(r.status,200,session+' GET');return r.json()}
users.coachA={id:'coach-a',email:'a@coach.test',email_confirmed_at:'2026-10-15',factors:[{id:'mfa-a',status:'verified',factor_type:'totp'}]};users.coachB={...users.coachA,id:'coach-b',email:'b@coach.test'};levels.coachA='aal2';levels.coachB='aal2';
sqlite.prepare('INSERT INTO staff_access(email,name,programs,active,updated_at) VALUES (?,?,?,?,?)').run('a@coach.test','Coach A','["Elementary"]',1,'2026-10-16');sqlite.prepare('INSERT INTO staff_access(email,name,programs,active,updated_at) VALUES (?,?,?,?,?)').run('b@coach.test','Coach B','["Advanced"]',1,'2026-10-16');
const state={programs:[{id:'Elementary',name:'SWA Development',priceCents:20000},{id:'Advanced',name:'SWA Advance',priceCents:20000}],
 seasons:[{program:'Elementary',start:'2026-12-01',end:'2026-12-31',weekly:[{day:'Monday',start:'18:00',end:'19:30'}],excludedDates:['2026-12-28']},{program:'Advanced',start:'2026-12-01',end:'2026-12-31',weekly:[{day:'Monday',start:'19:30',end:'21:00'}],excludedDates:[]}],
 events:[{id:'winter-camp',name:'Winter camp',type:'Camp',dates:['2026-12-19','2026-12-20'],schedule:[{date:'2026-12-19',start:'09:00',end:'12:00'}],price:160,slots:20},{id:'ref-clinic',name:'Referee',type:'Clinic',dates:['2026-12-02'],price:40,slots:10}],
 extraPractices:[{id:'friday-live',name:'Friday Night Live',enabled:true,gradeRange:'7–12',description:'',dates:['2026-12-04'],start:'19:00',end:'20:30',memberCents:1000,nonMemberCents:2000}]};
sqlite.prepare('INSERT INTO academy_state VALUES (?,?,?,?,?)').run('academy',JSON.stringify(state),1,'owner','2026-10-16');
const plan={title:'<img src=x onerror=alert(1)> Leg attacks',objective:'Finish cleanly',sections:[{id:'warmup',kind:'warmup',title:'Warm-up',minutes:10,notes:'Movement'}],notes:''};
async function ownerSave(body){const r=await plans.POST(request('owner','',{action:'save',revision:0,...body,data:plan}));assert.equal(r.status,200);return r.json()}
await ownerSave({program:'Elementary',date:'2026-12-07',published:true});
await ownerSave({program:'Elementary',date:'2026-12-14',published:false});// a private owner plan is not marked for coaches
await ownerSave({program:'Advanced',date:'2026-12-07',published:true});

// 1. The server builds the coach's month: their practices with shared-plan marks, extras, camps, clinics, holidays.
const a=await get('coachA'),cal=a.calendar,day=d=>cal.days.find(x=>x.date===d);
assert.equal(cal.month,'2026-12');assert.equal(cal.lead,1,'December 2026 starts on a Tuesday; weeks start on Monday');assert.equal(cal.days.length,31);
assert.deepEqual(day('2026-12-07').items.map(i=>[i.kind,i.title,i.start,i.end,i.plan]),[['practice','SWA Development','18:00','19:30',true]]);
assert.equal(day('2026-12-14').items[0].plan,false,'a private plan is not shown to coaches');
assert.equal(cal.days.flatMap(d=>d.items).some(i=>i.program==='Advanced'),false,'only the coach’s programs');
assert.equal(day('2026-12-28').items.length,0,'a day off');
assert.deepEqual(day('2026-12-04').items.map(i=>[i.kind,i.title,i.start]),[['extra','Friday Night Live (extra practice)','19:00']]);
assert.deepEqual(day('2026-12-19').items.map(i=>[i.kind,i.title,i.start,i.end]),[['event','Winter camp','09:00','12:00']]);
assert.deepEqual(day('2026-12-20').items.map(i=>[i.title,i.start]),[['Winter camp',null]],'a camp day without a time yet');
assert.deepEqual(day('2026-12-02').items.map(i=>i.title),['Referee (clinic)']);
assert.deepEqual(day('2026-12-25').holidays,['Christmas Day']);
assert.ok(cal.days.filter(d=>d.today).length<=1);assert.match(a.today,/^\d{4}-\d{2}-\d{2}$/);
assert.equal((await get('coachB')).calendar.days.find(d=>d.date==='2026-12-07').items[0].plan,true);
assert.equal((await get('owner')).calendar,undefined,'the owner keeps the owner calendar');assert.equal((await get('coachA','?month=2026-12&summary=1')).calendar,undefined);
// Coaches still cannot write plans.
assert.equal((await plans.POST(request('coachA','',{action:'save',program:'Elementary',date:'2026-12-21',revision:0,published:true,data:plan}))).status,403);
// Losing a program takes it off the calendar.
sqlite.prepare('UPDATE staff_access SET programs=? WHERE email=?').run('["Advanced"]','a@coach.test');
assert.equal((await get('coachA')).calendar.days.flatMap(d=>d.items).some(i=>i.program==='Elementary'),false);
sqlite.prepare('UPDATE staff_access SET programs=? WHERE email=?').run('["Elementary"]','a@coach.test');

// 2. The page draws it (inline script in a fake DOM; its fetch calls go to the real route).
const script=readFileSync('app/practice-plans/screen.html','utf8').match(/<script>([\s\S]*)<\/script>/)[1];
async function page(session,search){
 const nodes=new Map();
 function el(id){if(!nodes.has(id)){let html='';nodes.set(id,{id,value:'',hidden:false,textContent:'',className:'',style:{},disabled:false,focus(){},scrollIntoView(){},replaceChildren(...options){this.options=options;this.value=options[0]?.value||''},set innerHTML(v){html=v},get innerHTML(){return html}})}return nodes.get(id)}
 el('planForm').elements=new Proxy({},{get(target,name){return target[name]??={value:'',checked:false,focus(){}}}});
 const fetch=async(url,options)=>{const r=await (options?.method==='POST'?plans.POST:plans.GET)(new Request('https://academy.test'+url,{method:options?.method||'GET',headers:{'content-type':'application/json',origin:'https://academy.test',cookie:'test-session='+session,'cf-connecting-ip':'198.51.100.'+(++ip%250)},...(options?.body?{body:options.body}:{})}));return {ok:r.ok,status:r.status,json:()=>r.json()}};
 const ctx=vm.createContext({URL,URLSearchParams,Intl,Date,console,crypto,structuredClone,fetch,location:{search,pathname:'/practice-plans'},confirm:()=>true,window:{addEventListener(){},print(){}},requestAnimationFrame:()=>1,cancelAnimationFrame(){},
  document:{getElementById:el,createElement:()=>({}),querySelectorAll:()=>[],querySelector:s=>s==='h1'?el('heading'):null}});
 vm.runInContext(script,ctx);const settle=async()=>{for(let i=0;i<20;i++)await new Promise(r=>setImmediate(r))};await settle();
 return {el,settle,run:async s=>{const v=vm.runInContext(s,ctx);await settle();return v}};
}
const coach=await page('coachA','?month=2026-12');
assert.equal(coach.el('calendarSection').hidden,false);assert.equal(coach.el('ownerEditor').hidden,true);
let grid=coach.el('calendar').innerHTML;
assert.match(coach.el('calendarTitle').textContent,/December 2026/);assert.equal((grid.match(/class="cal-blank"/g)||[]).length,1);assert.equal((grid.match(/class="cal-dow"/g)||[]).length,7);
// A shared plan (issue #223): ringed and ticked (has-plan); its name is the visible text with the date before it, and no
// aria-label that could drift from what is on screen (axe label-content-name-mismatch).
assert.match(grid,/<button type="button" class="cal-item has-plan p-Elementary" data-practice="Elementary\|2026-12-07"><span class="vh">Mon, Dec 7, 2026: <\/span><b>6:00 PM–7:30 PM<\/b><span>SWA Development<\/span><small>Plan shared<\/small><span class="vh">, open the plan<\/span><\/button>/);
assert.doesNotMatch(grid,/aria-label/);
assert.match(grid,/<div class="cal-item p-Elementary"><b>6:00 PM–7:30 PM<\/b><span>SWA Development<\/span><small>No plan yet<\/small><\/div>/,'no plan: not a button');
assert.doesNotMatch(grid,/Advanced/,'only the coach’s programs');
assert.match(grid,/<div class="cal-item p-extra"><b>9:00 AM–12:00 PM<\/b><span>Winter camp<\/span><\/div>/);assert.match(grid,/Time to be announced<\/b><span>Winter camp/);
assert.match(grid,/Friday Night Live \(extra practice\)/);assert.match(grid,/holiday-tag">Christmas Day/);assert.match(grid,/<span class="d-long">Mon, Dec 7<\/span>/);
assert.match(coach.el('calendarKey').innerHTML,/p-Elementary"><\/i>SWA Development/);assert.doesNotMatch(coach.el('calendarKey').innerHTML,/SWA Advance/);
assert.match(coach.el('intro').textContent,/Your month at a glance/);
// A practice marked Plan shared opens its plan, with its text escaped.
coach.el('calendar').onclick({target:{closest:()=>({dataset:{practice:'Elementary|2026-12-07'}})}});
assert.equal(coach.el('detail').hidden,false);assert.match(coach.el('detail').innerHTML,/&lt;img src=x onerror=alert\(1\)&gt; Leg attacks/);assert.doesNotMatch(coach.el('detail').innerHTML,/<img/);
// The program filter applies to the calendar; extras stay.
coach.el('filter').value='Advanced';coach.el('filter').onchange();assert.doesNotMatch(coach.el('calendar').innerHTML,/SWA Development/);assert.match(coach.el('calendar').innerHTML,/Winter camp/);coach.el('filter').value='';coach.el('filter').onchange();
// Month buttons move a month at a time.
coach.el('nextMonth').onclick();await coach.settle();assert.match(coach.el('calendarTitle').textContent,/January 2027/);
assert.match(coach.el('calendar').innerHTML,/Nothing is scheduled for your programs this month/);
coach.el('prevMonth').onclick();await coach.settle();assert.match(coach.el('calendarTitle').textContent,/December 2026/);
coach.el('thisMonth').onclick();await coach.settle();assert.equal(await coach.run('state.month'),await coach.run('state.today.slice(0,7)'));
// Phones (issue #286): in the month that holds today, the list is this week (Monday to Sunday) and the other days with
// something on fold behind "Show the whole month". Other months, and the desktop grid, show every day.
{
 const day=(date,o={})=>({date,today:false,holidays:[],items:[],...o}),practice={kind:'practice',program:'Elementary',title:'SWA Development',start:'18:00',end:'19:30',plan:false};
 // Thursday Nov 5, 2026 is today: its week runs Mon Nov 2 to Sun Nov 8. Nov 1 (a Sunday) is the only other day with something on.
 globalThis.__cal={month:'2026-11',lead:6,days:[day('2026-11-01',{items:[practice]}),day('2026-11-02'),day('2026-11-03',{holidays:['Election Day']}),day('2026-11-04',{items:[{...practice,program:'Advanced'}]}),day('2026-11-05',{today:true}),day('2026-11-06',{items:[practice]}),day('2026-11-09',{items:[practice]}),day('2026-11-10',{holidays:['Day off']})]};
 await coach.run('var cal='+JSON.stringify(globalThis.__cal));
 let html=await coach.run('calendarHtml(cal,"",false)');
 assert.match(html,/<button type="button" class="cal-earlier" data-earlier aria-expanded="false">Show the whole month \(3 more days\)<\/button>/,'three days outside this week have something on');
 assert.deepEqual([...html.matchAll(/<div class="cal-day[^"]*folded[^"]*"[^>]*><h3><span class="d-num">(\d+)/g)].map(m=>+m[1]),[1,9,10],'days outside this week with something on are folded, before and after');
 assert.doesNotMatch(html,/class="cal-day[^"]*folded[^"]*"[^>]*aria-current/,'today is never folded');
 assert.match(html,/<div class="cal-day empty"><h3><span class="d-num">2</,'a quiet day stays a quiet day');
 assert.ok(html.indexOf('cal-earlier')>html.lastIndexOf('cal-day'),'the toggle comes after the week');
 assert.equal((await coach.run('otherDays(cal,d=>d.items.filter(i=>i.program!=="Advanced"))')).length,3,'the program filter changes what folds');
 assert.equal((await coach.run('otherDays(cal,d=>d.items.filter(i=>i.program==="Advanced"))')).length,1,'with only SWA Advance shown, just the holiday folds');
 html=await coach.run('calendarHtml(cal,"",true)');
 assert.match(html,/aria-expanded="true">Show this week only<\/button>/);assert.doesNotMatch(html,/folded/);
 await coach.run('cal.days.forEach(d=>d.today=false)');assert.doesNotMatch(await coach.run('calendarHtml(cal,"",false)'),/cal-earlier|folded/,'a month without today folds nothing');
 await coach.run('cal.days[0].today=true');html=await coach.run('calendarHtml(cal,"",false)');
 assert.match(html,/<button type="button" class="cal-earlier" data-earlier aria-expanded="false">Show the whole month \(5 more days\)<\/button>/,'a Sunday today: its week ended with it, so every later day with something on folds');
 await coach.run('cal.days[0].today=false;cal.days[6].today=true;[0,2,3].forEach(i=>{cal.days[i].items=[];cal.days[i].holidays=[]})');assert.match(await coach.run('calendarHtml(cal,"",false)'),/\(1 more day\)/,'one other day reads in the singular');
 // The toggle re-draws the month with the other days open, and back.
 await coach.run('state.calendar=cal;cal.days.forEach(d=>d.today=d.date==="2026-11-05")');await coach.run('renderCalendar()');
 assert.match(coach.el('calendar').innerHTML,/Show the whole month/);
 coach.el('calendar').onclick({target:{closest:()=>({dataset:{earlier:''}})}});assert.match(coach.el('calendar').innerHTML,/Show this week only/);assert.doesNotMatch(coach.el('calendar').innerHTML,/folded/);
 coach.el('calendar').onclick({target:{closest:()=>({dataset:{earlier:''}})}});assert.match(coach.el('calendar').innerHTML,/Show the whole month/);
 coach.el('calendar').onclick({target:{closest:()=>null}});
 // Today's shared plan opens under the calendar by itself, without taking focus (issue #286); the month and program
 // selects stay away for a coach with one program.
 assert.equal(coach.el('monthTools').hidden,true,'one program: no month or program selects');
 {
  let focused=0;coach.el('detail').focus=()=>{focused++};
  await coach.run('state.month=state.today.slice(0,7);state.plans=[{program:"Elementary",date:state.today,published:true,revision:1,scheduled:true,updatedAt:"2026-11-05T12:00:00Z",data:{title:"Today only",objective:"",sections:[],notes:""}}];showCoachMonth(state)');
  assert.equal(coach.el('detail').hidden,false);assert.match(coach.el('detail').innerHTML,/Today only/);assert.equal(focused,0,'drawn quietly');
  await coach.run('state.plans=[];load("2026-12")');
 }
 // CSS: folded days and the toggle only on phones; the shared-plan mark everywhere.
 const css=readFileSync('app/practice-plans/screen.html','utf8');
 assert.match(css,/@media\(max-width:760px\)\{\.cal\{grid-template-columns:1fr\}\.cal-dow,\.cal-blank,\.cal-day\.empty,\.cal-day\.folded\{display:none\}html body \.cal \.cal-earlier\{display:flex/);
 assert.match(css,/html body \.cal \.cal-earlier\{display:none\}/);assert.match(css,/html body \.cal \.cal-item\.has-plan\{border-color:var\(--swa-red\)/);
 assert.doesNotMatch(css,/id="reload"|Refresh plans/,'no Refresh button for coaches');
}
// The owner's plan editor shows no coach calendar.
const owner=await page('owner','?program=Elementary&date=2026-12-07');assert.equal(owner.el('calendarSection').hidden,true);assert.equal(owner.el('ownerEditor').hidden,false);
console.log('Passed: coach month calendar with their practices, shared-plan links, extra practices, camps and clinics with times, holidays and today; program filter; month paging; owner and coach access unchanged.');
