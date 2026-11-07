import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
import {portalCode} from './fixtures/portal-script.mjs';

const db=new DatabaseSync(':memory:');
db.exec(readFileSync('drizzle/0000_jazzy_silvermane.sql','utf8'));
const DB={prepare(sql){let values=[];return {bind(...args){values=args;return this},async first(){return db.prepare(sql).get(...values)??null}}}};
let identity=null;
function loadTs(path){const module={exports:{}};const source=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(source,{module,exports:module.exports,Response,Request,URL,console,require(name){if(name==='../../../lib/account-auth')return {ownerIdentity:async()=>({owner:identity?.email==='savagewrestlingclub@gmail.com'?{userId:identity.id,displayName:identity.email}:null,headers:new Headers({'Cache-Control':'private, no-store'})})};if(name==='cloudflare:workers')return {env:{DB}};if(name==='next/headers')return {headers:async()=>new Headers(identity?{'oai-authenticated-user-id':identity.id,'oai-authenticated-user-email':identity.email}:{})};if(name==='next/navigation')return {redirect(){throw Error('redirect')}};if(name==='../../chatgpt-auth')return loadTs('app/chatgpt-auth.ts');if(name.endsWith('/friday-live'))return loadTs('lib/friday-live.ts');if(name==='./event-schedule')return loadTs('lib/event-schedule.ts');if(name==='../../../lib/program-names')return loadTs('lib/program-names.ts');if(name==='../../../lib/academy-validation')return loadTs('lib/academy-validation.ts');throw Error(name)}});return module.exports}
const module={exports:loadTs('app/api/academy/route.ts')};
const {GET,PUT}=module.exports;
const code=portalCode;
const nodes=new Map();
const node=s=>{if(!nodes.has(s))nodes.set(s,{textContent:'',style:{},innerHTML:'',value:'',className:''});return nodes.get(s)};
const ctx=vm.createContext({console,structuredClone,crypto,URL,Intl,Date,JSON,Set,FormData,location:{hash:''},document:{querySelector:node,addEventListener(){}},window:{addEventListener(){}},setTimeout(){},confirm:()=>true});
vm.runInContext(code,ctx);
const run=s=>vm.runInContext(s,ctx);
run('hydratePrograms()');
assert.equal(run('calendarMonthKey()'),run('academyToday().slice(0,7)'));assert.equal(run('publishedCalendarUrl()'),'/calendar?month='+run('calendarMonthKey()'));
const state=JSON.parse(run('JSON.stringify(data)'));
const request=(body,origin='https://academy.test')=>new Request('https://academy.test/api/academy',{method:'PUT',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
assert.equal((await GET(new Request('https://academy.test/api/academy'))).status,403);
assert.equal((await PUT(request({revision:0,data:state}))).status,403);
identity={id:'other',email:'other@example.com'};assert.equal((await GET(new Request('https://academy.test/api/academy'))).status,403);
identity={id:'owner-stable',email:'savagewrestlingclub@gmail.com'};
assert.equal((await GET(new Request('https://academy.test/api/academy'))).status,200);
assert.equal((await PUT(request({revision:0,data:state},'https://other.test'))).status,403);
assert.equal((await PUT(request({revision:0,data:{}}))).status,400);
const created=await PUT(request({revision:0,data:state}));assert.equal(created.status,200);assert.equal((await created.json()).revision,1);
assert.equal((await PUT(request({revision:0,data:state}))).status,409);
const changed=structuredClone(state);changed.programs[0].name='New elementary';changed.programs[0].priceCents=22500;
assert.equal((await PUT(request({revision:1,data:changed}))).status,200);
assert.equal((await PUT(request({revision:1,data:state}))).status,409);
assert.equal((await (await GET(new Request('https://academy.test/api/academy'))).json()).data.programs[0].priceCents,22500);
const invalid=structuredClone(changed);invalid.programs[0].priceCents=-1;
assert.equal((await PUT(request({revision:2,data:invalid}))).status,400);
assert.equal(db.prepare('SELECT updated_by FROM academy_state').get().updated_by,'owner-stable');
run(`data.seasons=[{program:'Elementary',start:'2026-10-01',end:'2026-10-31',weekly:[{day:'Monday',start:'17:00',end:'18:00'}],excludedDates:['2026-10-12']}];`);
assert.equal(run("practiceSlot(programs[0],'2026-10-12')"),null);
assert.equal(run("practiceSlot(programs[0],'2026-10-19').label"),'5:00 PM–6:00 PM');
assert.equal(run("practiceSlot(programs[0],'2026-10-21')"),null);
assert.equal(run("practiceSlot(programs[0],'2026-11-02')"),null);
// A winter-only schedule must leave the fall calendar empty.
run(`data.seasons=[{program:'Elementary',start:'2026-12-01',end:'2027-02-28',weekly:[{day:'Monday',start:'18:00',end:'19:30'}],excludedDates:['2026-12-28']}];month=9;year=2026;filter='All programs';`);
assert.doesNotMatch(run('calendar()'),/class="event /);
assert.equal(run("practiceSlot(programs[0],'2026-12-07').label"),'6:00 PM–7:30 PM');
assert.equal(run("practiceSlot(programs[0],'2026-12-28')"),null);
assert.equal(run("practiceSlot(programs[1],'2026-12-07')"),null);
run('data.seasons=[]');assert.equal(run("practiceSlot(programs[0],'2026-10-19')"),null);
run('data.programs[0].priceCents=22500;hydratePrograms()');assert.match(run('ownerPrograms()'),/value="225.00"/);assert.match(run('ownerPrograms()'),/\$2,700.00/);
// Exercise queued writes, reload from a second session, and conflicts using the real API handlers.
ctx.fetch=async(url,options)=>options?.method==='PUT'?PUT(request(JSON.parse(options.body))):GET();
await run('reloadAcademy()');assert.equal(run('revision'),2);
run("data.programs[0].name='Phone update';save();data.programs[0].description='Second queued change';save()");
for(let i=0;i<20&&run('saving');i++)await new Promise(resolve=>setImmediate(resolve));
assert.equal(run('saveBlocked'),false);assert.equal((await (await GET(new Request('https://academy.test/api/academy'))).json()).data.programs[0].description,'Second queued change');
const current=(await (await GET(new Request('https://academy.test/api/academy'))).json());await PUT(request({revision:current.revision,data:current.data}));
run("data.programs[0].name='Stale device';save()");
for(let i=0;i<20&&run('saving');i++)await new Promise(resolve=>setImmediate(resolve));
assert.equal(run('saveBlocked'),true);
assert.match(node('#syncStatus').textContent,/Another device/);
assert.notEqual((await (await GET(new Request('https://academy.test/api/academy'))).json()).data.programs[0].name,'Stale device');
console.log('Passed: owner authorization, request origin, durable writes, second-session reads, stale-write rejection, invalid prices, schedule exclusions, editable prices, save queue and conflict warning.');

const teamState=await (await GET(new Request('https://academy.test/api/academy'))).json();teamState.data.teamCodes=[{id:'saved-team',name:'School',code:'SCHOOL15',percent:15,programs:['Intermediate'],active:true}];assert.equal((await PUT(request({revision:teamState.revision,data:teamState.data}))).status,200);const teamReload=await (await GET(new Request('https://academy.test/api/academy'))).json();assert.equal(teamReload.data.teamCodes[0].code,'SCHOOL15');teamReload.data.teamCodes[0].percent=101;assert.equal((await PUT(request({revision:teamReload.revision,data:teamReload.data}))).status,400);assert.equal((await (await GET(new Request('https://academy.test/api/academy'))).json()).data.teamCodes[0].percent,15);console.log('Passed: team codes persist across sessions and invalid discounts cannot overwrite saved codes.');

// Navigate immediately on a fresh Schedules page, before filling in semester dates.
const plannerFields={start:{value:''},end:{value:''},exceptions:{value:''}},plannerCalendar={innerHTML:''};ctx.document.getElementById=id=>id==='semesterForm'?{elements:plannerFields,querySelectorAll:()=>[]}:id==='holidayPlanner'?plannerCalendar:null;
run("plannerMonth='';plannerExcluded=new Set();movePlannerMonth(1)");assert.match(run('plannerMonth'),/^\d{4}-(0[1-9]|1[0-2])$/);assert.match(plannerCalendar.innerHTML,/class="holiday-date/);
plannerFields.start.value='2026-12-01';plannerFields.end.value='2027-02-28';run("refreshPlanner(true);toggleExcludedDate('2026-12-25');movePlannerMonth(1)");assert.match(plannerCalendar.innerHTML,/January 2027/);assert.equal(plannerFields.exceptions.value,'["2026-12-25"]');run('movePlannerMonth(-1)');assert.match(plannerCalendar.innerHTML,/December 2026/);assert.match(plannerCalendar.innerHTML,/Christmas Day, no practice/);
console.log('Passed: first-click holiday navigation, year rollover, full month labels and days off retained.');

// Explicit named practices persist through the owner API, with no generated Friday dates.
let practiceState=await (await GET(new Request('https://academy.test/api/academy'))).json();assert.equal(practiceState.data.extraPractices.length,0);const practice={id:'fnl',name:'Friday Night Live',dates:['2026-12-04','2026-12-18','2027-01-08'],enabled:true,start:'18:00',end:'19:00',memberCents:1000,nonMemberCents:2000};practiceState.data.extraPractices=[practice];assert.equal((await PUT(request({revision:practiceState.revision,data:practiceState.data}))).status,200);practiceState=await (await GET(new Request('https://academy.test/api/academy'))).json();assert.equal(practiceState.data.extraPractices[0].dates.join(','),practice.dates.join(','));const invalidPractice=structuredClone(practiceState.data);invalidPractice.extraPractices[0].dates=['2026-02-30'];assert.equal((await PUT(request({revision:practiceState.revision,data:invalidPractice}))).status,400);
ctx.document.getElementById=()=>null;ctx.FormData=class {constructor(f){return Object.entries(f)}};ctx.testForm={name:'Friday Night Live',enabled:'on',start:'18:00',end:'19:00',member:'10',nonMember:'20'};run("data.extraPractices=[];save=()=>{};render=()=>{};extraPracticeMonth='2026-12';toggleExtraPracticeDate('2026-12-04');toggleExtraPracticeDate('2026-12-18');moveExtraPracticeMonth(1);toggleExtraPracticeDate('2027-01-08')");assert.equal(run('extraPracticeDates.size'),3);assert.equal(run('extraPracticeMonth'),'2027-01');run('saveExtraPractice(testForm)');assert.equal(run('data.extraPractices.length'),1);assert.equal(run('data.extraPractices[0].name'),'Friday Night Live');assert.equal(run('data.extraPractices[0].dates.join(",")'),practice.dates.join(','));assert.equal(run('data.extraPractices[0].memberCents'),1000);assert.equal(run('data.extraPractices[0].nonMemberCents'),2000);const extraId=run('data.extraPractices[0].id');ctx.extraId=extraId;run('editExtraPractice(extraId);toggleExtraPracticeDate("2026-12-18");saveExtraPractice(testForm)');assert.equal(run('data.extraPractices[0].dates.length'),2);assert.equal(run('data.extraPractices.length'),1);run('editExtraPractice(extraId)');assert.match(run('extraPracticeCalendar()'),/aria-pressed="true"/);assert.match(run('extraPracticeManager()'),/Friday Night Live/);run("holidayPlannerMarkup=()=>''");assert.match(run('schedules()'),/Edit practice/);run('removeExtraPractice(extraId)');assert.equal(run('data.extraPractices.length'),0);
console.log('Passed: named practice owner persistence, date validation, multi-date calendar selection across months, prices, editing selected dates, removal and Schedules integration.');
