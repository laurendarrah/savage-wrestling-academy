import {readFileSync} from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
let code=readFileSync('app/portal.html','utf8').match(/<script>([\s\S]*)<\/script>/)[1];code=code.slice(0,code.indexOf("if(location.hash.startsWith('#practice-calendar'))"));
const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',value:'',style:{}});return nodes.get(id)};
const ctx=vm.createContext({structuredClone,crypto,Intl,Date,JSON,URLSearchParams,Set,FormData,console,location:{hash:'',href:''},document:{querySelector:node,addEventListener(){}},window:{addEventListener(){}},setTimeout(){},confirm:()=>true});vm.runInContext(code,ctx);const run=s=>vm.runInContext(s,ctx);
run(`hydratePrograms();mode='admin';page='Calendar';year=2026;month=11;render=()=>{};data.seasons=[{program:'Elementary',start:'2026-12-01',end:'2026-12-31',weekly:[{day:'Monday',start:'18:00',end:'19:30'}],excludedDates:['2026-12-28']}];calendarPlanSummaries['2026-12']={status:'ready',items:[{program:'Elementary',date:'2026-12-07',published:true,title:'Leg attacks'},{program:'Elementary',date:'2026-12-14',published:false,title:'Draft practice'}]}`);
assert.match(run('calendar()'),/Plan shared ✓/);assert.match(run('calendar()'),/Draft plan/);assert.match(run('calendar()'),/＋ Add plan/);assert.match(run('calendar()'),/calendarPractice\('Elementary','2026-12-07'\)/);assert.doesNotMatch(run('calendar()'),/calendarPractice\('Elementary','2026-12-28'\)/);
run("calendarPractice('Elementary','2026-12-07')");assert.equal(ctx.location.href,'/practice-plans?program=Elementary&date=2026-12-07');ctx.location.href='';run("calendarPractice('Elementary','2026-12-28')");assert.equal(ctx.location.href,'');
run("moveMonth(1)");assert.equal(ctx.location.hash,'#practice-calendar?month=2027-01');
run("mode='public';month=11;year=2026");assert.doesNotMatch(run('calendar()'),/Plan shared|Draft plan|＋ Add plan/);run("calendarPractice('Elementary','2026-12-07')");assert.equal(ctx.location.href,'');assert.match(node('#overlay').innerHTML,/Practice details/);
console.log('Passed: planning calendar status badges, direct date/program link, holiday exclusion, month return link, and public calendar behavior.');

run("mode='admin';month=11;year=2026;filter='All programs'");assert.match(run('mobilePracticeCalendar()'),/Plan shared ✓/);assert.match(run('mobilePracticeCalendar()'),/Draft plan/);assert.match(run('mobilePracticeCalendar()'),/calendarPractice\('Elementary','2026-12-07'\)/);assert.doesNotMatch(run('mobilePracticeCalendar()'),/2026-12-28/);assert.doesNotMatch(run('mobilePracticeCalendar()'),/December 28|No practice</);
run("filter='Advanced'");assert.doesNotMatch(run('mobilePracticeCalendar()'),/calendarPractice\(/);run("filter='All programs';mode='public'");assert.doesNotMatch(run('mobilePracticeCalendar()'),/plan-state|Draft plan|Plan shared/);run("mode='admin';jumpCalendarMonth('2027-02')");assert.equal(ctx.location.hash,'#practice-calendar?month=2027-02');
let open=false;node('#nav').classList={toggle(){open=!open;return open},remove(){open=false}};node('#navToggle').setAttribute=(key,value)=>node('#navToggle')[key]=value;run('toggleMobileNav()');assert.equal(open,true);assert.equal(node('#navToggle')['aria-expanded'],'true');run('closeMobileNav()');assert.equal(open,false);assert.equal(node('#navToggle')['aria-expanded'],'false');
console.log('Passed: phone practice list uses the same actions, program filter, dates and plan status; accessible menu toggle and native month navigation.');

run(`mode='admin';year=2026;month=11;filter='All programs';data.events=[{id:'camp',name:'Winter camp',type:'Camp',dates:['2026-12-07','2026-12-09'],price:100,slots:20},{id:'clinic',name:'Single-leg clinic',type:'Clinic',dates:['2026-12-08'],price:50,slots:20},{id:'event',name:'Academy event',type:'Event',dates:['2026-12-10'],price:0,slots:20},{id:'archived',name:'Archived camp',type:'Camp',dates:['2026-12-11','2026-12-12'],archived:true},{id:'past',name:'Old clinic',type:'Clinic',dates:['2020-12-08']}];data.seasons.push({program:'Intermediate',start:'2026-12-01',end:'2026-12-31',weekly:[{day:'Monday',start:'19:30',end:'21:00'}],excludedDates:[]},{program:'Advanced',start:'2026-12-01',end:'2026-12-31',weekly:[{day:'Monday',start:'19:30',end:'21:00'}],excludedDates:[]})`);
for(const output of ['calendar()','mobilePracticeCalendar()']){const html=run(output);for(const color of ['cal-advanced','cal-intermediate','cal-elementary','cal-special'])assert.ok(html.includes(color));for(const name of ['Winter camp','Single-leg clinic','Academy event'])assert.ok(html.includes(name));assert.doesNotMatch(html,/Archived camp|Old clinic/);}
run(`data.seasons[0].weekly.push({day:'Friday',start:'18:00',end:'19:30'});data.seasons[0].excludedDates.push('2026-12-25','2026-12-26');
data.seasons[1].weekly.push({day:'Friday',start:'19:30',end:'21:00'});
data.events[1].dates.push('2026-12-25');`);
for(const view of ['calendar()','mobilePracticeCalendar()']){
 const html=run(view);
 assert.match(html,/calendarPractice\('Intermediate','2026-12-25'\)/);
 assert.match(html,/Christmas Day.*Single-leg clinic/);
 assert.doesNotMatch(html,/No practice</);
}
const holidayNotice=run("calendarHolidayCards('2026-12-25',federalHolidays(2026))");
assert.match(holidayNotice,/calendar-holiday.*Christmas Day/);
assert.doesNotMatch(holidayNotice,/No practice/);
assert.equal(run("calendarHolidayCards('2026-12-26',federalHolidays(2026))"),'');
assert.match(run("calendarEventCards('2026-12-07')"),/Winter camp/);assert.match(run("calendarEventCards('2026-12-09')"),/Winter camp/);assert.equal(run("calendarEventCards('2026-12-08').includes('Winter camp')"),false);
run("filter='Advanced'");assert.equal(run("calendarEventCards('2026-12-07')"),'');run("filter='Camps, clinics & events'");assert.match(run('mobilePracticeCalendar()'),/Winter camp/);assert.doesNotMatch(run('mobilePracticeCalendar()'),/calendarPractice\(/);
run("mode='public';filter='All programs';calendarEvent(1)");assert.match(node('#overlay').innerHTML,/Single-leg clinic/);assert.doesNotMatch(node('#overlay').innerHTML,/Edit event/);
const css=readFileSync('public/responsive.css','utf8');for(const [name,color] of [['advanced','#000'],['intermediate','#686868'],['elementary','#fff'],['special','#d72732']])assert.ok(css.includes('.program-color.cal-'+name+'{background:'+color));
console.log('Passed: program colors on desktop and phone, saved events red on each selected day, archive exclusion, event filtering and public event details.');

const publicSource=readFileSync('app/calendar/screen.html','utf8');
const closureCode=publicSource.slice(publicSource.indexOf('function holidayCards(day)'),publicSource.indexOf('function slots(day)'));
const publicClosure=vm.runInNewContext(closureCode+"holidayCards('2026-12-25')",{
 esc:String,state:{programs:[{id:'Elementary',name:'Development'}],holidays:[{date:'2026-12-25',name:'Christmas Day'}],closures:[{program:'Elementary',date:'2026-12-25'}]}
});
assert.match(publicClosure,/calendar-holiday.*Christmas Day/);
assert.doesNotMatch(publicClosure,/No practice/);
assert.doesNotMatch(publicClosure,/<a |<button/);
const tabsCode=publicSource.slice(publicSource.indexOf('const calendarSections='),publicSource.indexOf('async function load(month)'));
const tabIds=['schedule','programs','lessons','live','events'],tabNodes=new Map(),tabListeners={};
const tabNode=id=>{if(!tabNodes.has(id))tabNodes.set(id,{});return tabNodes.get(id)};
const tabLinks=tabIds.map(id=>({hash:'#'+id,setAttribute(_key,value){this.current=value},removeAttribute(){delete this.current}}));
const publicNav=Object.assign(tabNode('calendarTabs'),{querySelectorAll:()=>tabLinks,addEventListener(key,fn){tabListeners[key]=fn},scrollIntoView(){}});
const tabLocation={hash:''};
vm.runInNewContext(tabsCode,{$:tabNode,embed:false,params:new URLSearchParams('view=live'),location:tabLocation,
 window:{addEventListener(name,fn){tabListeners[name]=fn}},history:{pushState(_state,_title,hash){tabLocation.hash=hash}}});
assert.equal(publicNav,tabNode('calendarTabs'));
assert.equal(tabLinks[3].current,'page');
assert.equal(tabNode('live').hidden,false);
tabListeners.click({target:{closest:()=>tabLinks[1]},button:0,preventDefault(){}});
assert.equal(tabLinks[1].current,'page');
assert.equal(tabNode('programs').hidden,false);
assert.equal(tabNode('live').hidden,true);
tabLocation.hash='';tabListeners.popstate();
assert.equal(tabLinks[3].current,'page');
assert.equal(tabNode('live').hidden,false);
for(const color of ['advanced','intermediate','elementary','special'])assert.ok(css.includes('.calendar-item.cal-'+color));
console.log('Passed: public calendar tabs replace content below the same header and restore selection on Back.');

run("academyToday=()=> '2026-12-03'; mode='admin'; year=2026; month=11; filter='All programs'; data.seasons=[]; data.events=[]; data.extraPractices=[]; extraPracticeMonth='2026-12'; plannerMonth='2026-12'; publishedAvailabilityMonth='2026-12'; availabilityMonth='2026-12'");
ctx.document.getElementById=()=>null;
const todayMarker=/aria-current="date"[^>]*>[^]*?<span class="swa-today-label">Today<\/span>/;
for(const view of ['mobilePracticeCalendar()','extraPracticeCalendar()','holidayPlannerMarkup()','publishedAvailabilityCalendar()','coachAvailabilityCalendar()']){
 const output=run(view);
 assert.match(output,todayMarker,view);
 assert.equal((output.match(/aria-current="date"/g)||[]).length,1,view);
}
assert.equal((run('calendar()').match(/aria-current="date"/g)||[]).length,2);
run('month=10');
assert.doesNotMatch(run('calendar()'),/aria-current="date"/);
const calendarNodes=new Map();
const renderPublic=publicSource.slice(publicSource.indexOf('function render(){'),publicSource.indexOf('const calendarSections='));
vm.runInNewContext(renderPublic+'render()',{
 state:{month:'2026-12',today:'2026-12-03',programs:[],events:[],privateFormats:[]},
 slots:()=>'',date:value=>value,embed:false,
 $:id=>{if(!calendarNodes.has(id))calendarNodes.set(id,{});return calendarNodes.get(id)}
});
assert.match(calendarNodes.get('calendar').innerHTML,/<article aria-current="date"><h3>2026-12-03<span class="swa-today-label">Today/);
console.log('Passed: Today appears on the current day in public and owner calendar layouts, including dates with no activities.');
