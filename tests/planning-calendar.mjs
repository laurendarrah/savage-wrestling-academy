// The owner's practice calendar (issue #283): a month grid where each practice is a bar in its program color with a dot
// when it has a plan, a day panel that lists the day's practices with Add plan or View plan, camps and extra practices
// as one red bar with the name, a week list (the phone's default) and a legend whose entries toggle what is shown.
import {readFileSync} from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {portalCode as code} from './fixtures/portal-script.mjs';
const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',value:'',style:{},focus(){nodes.focused=id}});return nodes.get(id)};
const ctx=vm.createContext({structuredClone,crypto,Intl,Date,JSON,URLSearchParams,Set,FormData,console,location:{hash:'',href:''},document:{querySelector:node,addEventListener(){}},window:{addEventListener(){}},setTimeout(f){f()},confirm:()=>true});vm.runInContext(code,ctx);const run=s=>vm.runInContext(s,ctx);
run(`hydratePrograms();page='Calendar';year=2026;month=11;calView='month';calHidden=new Set();openDay=null;weekStart='';academyToday=()=>'2026-12-09';render=()=>{};data.seasons=[{program:'Elementary',start:'2026-12-01',end:'2026-12-31',weekly:[{day:'Monday',start:'18:00',end:'19:30'}],excludedDates:['2026-12-28']}];calendarPlanSummaries['2026-12']={status:'ready',items:[{program:'Elementary',date:'2026-12-07',published:true,title:'Leg attacks'},{program:'Elementary',date:'2026-12-14',published:false,title:'Draft practice'}]}`);

// ---------- The month grid ----------
let cal=run('calendar()');
assert.match(cal,/<h1>PLAN FROM YOUR CALENDAR<\/h1>/);
assert.match(cal,/<button type="button" aria-pressed="true" onclick="setCalView\('month'\)">Month<\/button><button type="button" aria-pressed="false" onclick="setCalView\('week'\)">Week<\/button>/,'the view switch');
// A practice is a bar; a shared plan a green dot, a draft an amber one; a day off has nothing.
assert.match(cal,/aria-label="Monday, December 7, 2026: SWA Development, plan shared" aria-expanded="false" onclick="openCalendarDay\('2026-12-07'\)"><span class="n">7<\/span><span class="bar cal-elementary"><i><\/i><b><\/b><\/span><\/button>/);
assert.match(cal,/aria-label="Monday, December 14, 2026: SWA Development, draft plan"[^>]*><span class="n">14<\/span><span class="bar cal-elementary"><i><\/i><b class="draft"><\/b><\/span>/);
assert.match(cal,/aria-label="Monday, December 21, 2026: SWA Development"[^>]*><span class="n">21<\/span><span class="bar cal-elementary"><i><\/i><\/span><\/button>/,'no plan, no dot');
assert.match(cal,/aria-label="Monday, December 28, 2026"[^>]*><span class="n">28<\/span><\/button>/,'the day off has no practice');
assert.doesNotMatch(cal,/calendarPractice\(/,'the grid itself opens days, not plans');
assert.match(cal,/class="day is-today" aria-current="date" aria-label="Today, Wednesday, December 9, 2026"/);
assert.equal((cal.match(/class="day blank"/g)||[]).length,1,'December 2026 starts on a Tuesday');
assert.doesNotMatch(cal,/day-panel/,'no panel until a day is chosen');
// The legend toggles a program off: its bars go, and the toggle is struck through.
run("toggleCalKey('Elementary')");cal=run('calendar()');
assert.doesNotMatch(cal,/bar cal-elementary/);assert.match(cal,/<button type="button" class="cal-elementary" aria-pressed="false" onclick="toggleCalKey\('Elementary'\)">/);
run("toggleCalKey('Elementary')");

// ---------- The day panel ----------
run("openCalendarDay('2026-12-07')");cal=run('calendar()');
assert.match(cal,/<div class="cal-layout open">/);
assert.match(cal,/class="day is-open" aria-label="Monday, December 7, 2026: SWA Development, plan shared" aria-expanded="true"/);
assert.match(cal,/<section class="day-panel" aria-label="Monday, December 7, 2026"><button type="button" class="close" aria-label="Close day" onclick="closeCalendarDay\(\)">×<\/button><h2 tabindex="-1">Monday, December 7, 2026<\/h2><div class="dp-row cal-elementary"><i aria-hidden="true"><\/i><div><b>SWA Development<\/b><small><span class="event-time">6:00 PM–7:30 PM<\/span> · <span class="plan-state">Plan shared · Leg attacks<\/span><\/small><\/div><button type="button" onclick="calendarPractice\('Elementary','2026-12-07'\)">View plan<\/button><\/div><\/section>/);
assert.equal(nodes.focused,'.day-panel h2','focus moves to the panel');
run("openCalendarDay('2026-12-14')");assert.match(run('calendar()'),/Draft plan · Draft practice<\/span><\/small><\/div><button type="button" onclick="calendarPractice\('Elementary','2026-12-14'\)">View plan<\/button>/);
run("openCalendarDay('2026-12-21')");assert.match(run('calendar()'),/No plan yet<\/span><\/small><\/div><button type="button" onclick="calendarPractice\('Elementary','2026-12-21'\)">Add plan<\/button>/);
run("openCalendarDay('2026-12-28')");assert.match(run('calendar()'),/<h2 tabindex="-1">Monday, December 28, 2026<\/h2><p class="empty-line">No practices or events on this day\.<\/p>/,'a day off is an empty panel');
run("openCalendarDay('2026-12-28')");assert.doesNotMatch(run('calendar()'),/day-panel/,'choosing the open day again closes the panel');
run("openCalendarDay('2026-12-07');closeCalendarDay()");assert.doesNotMatch(run('calendar()'),/day-panel/);
// Opening a plan goes to the editor with the date and program; a day off opens nothing.
run("calendarPractice('Elementary','2026-12-07')");assert.equal(ctx.location.href,'/practice-plans?program=Elementary&date=2026-12-07');ctx.location.href='';run("calendarPractice('Elementary','2026-12-28')");assert.equal(ctx.location.href,'');
// The month arrows and the picker keep the address, and close the panel.
run("openCalendarDay('2026-12-07');moveMonth(1)");assert.equal(ctx.location.hash,'#practice-calendar?month=2027-01');assert.equal(run('openDay'),null);
run("jumpCalendarMonth('2027-02')");assert.equal(ctx.location.hash,'#practice-calendar?month=2027-02');
run("jumpCalendarMonth('2026-12')");
// The plan state labels the practice plan editor and the roster still read.
assert.deepEqual(JSON.parse(run("JSON.stringify([calendarPlanLabel('Elementary','2026-12-07'),calendarPlanLabel('Elementary','2026-12-14'),calendarPlanLabel('Elementary','2026-12-21'),calendarPlanLabel('Elementary','2027-01-04')])")),['Plan shared ✓','Draft plan','＋ Add plan','Add / view plan →']);
console.log('Passed: the month grid of bars and dots, the legend toggles, the day panel with Add plan and View plan, the plan editor link and the month address.');

// ---------- The week list ----------
run("calView='week';weekStart=''");
let week=run('calendar()');
assert.match(week,/<strong aria-live="polite">Week of Monday, December 7, 2026<\/strong>/,'opens on today’s week');
assert.match(week,/<section class="wk-day"><h3>Monday, December 7<\/h3><div class="dp-row cal-elementary">[\s\S]*?Plan shared · Leg attacks[\s\S]*?View plan<\/button><\/div><\/section>/);
assert.match(week,/<section class="wk-day is-today" aria-current="date"><h3>Wednesday, December 9<span class="today-tag">Today<\/span><\/h3><p class="quiet-line">Nothing scheduled\.<\/p><\/section>/);
assert.equal((week.match(/<section class="wk-day/g)||[]).length,7);
assert.doesNotMatch(week,/<div class="cal"/,'no grid in the week view');
run("moveWeek(1)");week=run('calendar()');assert.match(week,/Week of Monday, December 14, 2026/);assert.match(week,/Draft plan · Draft practice/);
run("moveWeek(3)");assert.equal(ctx.location.hash,'#practice-calendar?month=2027-01','a week in the next month moves the month');assert.match(run('calendar()'),/Week of Monday, January 4, 2027/);
run("jumpCalendarMonth('2026-12')");assert.match(run('calendar()'),/Week of Monday, December 7, 2026/,'the picker goes back to today’s week');
assert.deepEqual(JSON.parse(run("weekStart='2026-12-28';JSON.stringify(calendarMonthsShown())")),['2026-12','2027-01'],'a week across two months loads both plan summaries');
run("calView='month';weekStart=''");
console.log('Passed: the week list opens on today, steps by week into the next month and loads plans for both months.');

// ---------- Events and extra practices: one red bar with the name; the legend hides them together ----------
// Today is still December 9, so the events sit in the week after; an event whose last day has passed is archived and gone.
run(`year=2026;month=11;calHidden=new Set();data.events=[{id:'camp',name:'Winter camp',type:'Camp',dates:['2026-12-14','2026-12-16'],price:100,slots:20},{id:'clinic',name:'Single-leg clinic',type:'Clinic',dates:['2026-12-15'],price:50,slots:20},{id:'event',name:'Academy event',type:'Event',dates:['2026-12-17'],price:0,slots:20},{id:'archived',name:'Archived camp',type:'Camp',dates:['2026-12-18','2026-12-19'],archived:true},{id:'past',name:'Old clinic',type:'Clinic',dates:['2026-12-08']}];data.extraPractices=[{id:'fnl',name:'Friday Night Live',dates:['2026-12-18'],start:'18:00',end:'19:00',memberCents:1000,nonMemberCents:2000,enabled:true}];data.seasons.push({program:'Intermediate',start:'2026-12-01',end:'2026-12-31',weekly:[{day:'Monday',start:'19:30',end:'21:00'}],excludedDates:[]},{program:'Advanced',start:'2026-12-01',end:'2026-12-31',weekly:[{day:'Monday',start:'19:30',end:'21:00'}],excludedDates:[]})`);
for(const output of ['calendar()',"calView='week';weekStart='2026-12-14';calendar()"]){const html=run(output);for(const color of ['cal-advanced','cal-intermediate','cal-elementary','cal-special'])assert.ok(html.includes(color),color);for(const name of ['Winter camp','Single-leg clinic','Academy event','Friday Night Live'])assert.ok(html.includes(name),name);assert.doesNotMatch(html,/Archived camp|Old clinic/);run("calView='month';weekStart=''")}
cal=run('calendar()');
assert.match(cal,/aria-label="Monday, December 14, 2026: SWA Development, draft plan, SWA Intermediate, SWA Advance, Winter camp"[^>]*>[\s\S]*?<span class="evbar">Winter camp<\/span><\/button>/);
assert.match(cal,/aria-label="Friday, December 18, 2026: Friday Night Live"[^>]*><span class="n">18<\/span><span class="evbar">Friday Night Live<\/span><\/button>/);
assert.equal(JSON.parse(run("JSON.stringify(dayEvents('2026-12-15').map(e=>e.name))"))[0],'Single-leg clinic');assert.deepEqual(JSON.parse(run("JSON.stringify(dayEvents('2026-12-16').map(e=>e.name))")),['Winter camp']);
run("toggleCalKey('events')");assert.deepEqual(JSON.parse(run("JSON.stringify(dayEvents('2026-12-14'))")),[]);assert.doesNotMatch(run('calendar()'),/evbar/);run("toggleCalKey('events')");
// The panel: a camp opens its details with the owner's actions; an extra practice opens its editor under Schedules.
run("openCalendarDay('2026-12-15')");assert.match(run('calendar()'),/<div class="dp-row cal-special"><i aria-hidden="true"><\/i><div><b>Single-leg clinic<\/b><small><span class="event-time">Time to be announced<\/span> · Clinic<\/small><\/div><button type="button" onclick="calendarEvent\(1\)">Details<\/button><\/div>/);
run("openCalendarDay('2026-12-18')");assert.match(run('calendar()'),/<b>Friday Night Live<\/b><small><span class="event-time">6:00 PM–7:00 PM<\/span> · \$10\.00 members \/ \$20\.00 non-members<\/small><\/div><button type="button" onclick="go\('Schedules'\);editExtraPractice\('fnl'\)">Edit<\/button>/);
run("calendarEvent(1)");assert.match(node('#overlay').innerHTML,/Single-leg clinic/);assert.match(node('#overlay').innerHTML,/Edit event/);
// The program colors are the savage.css tokens (issues #227 and #232), with the same colors as fallbacks.
const css=readFileSync('public/responsive.css','utf8');for(const [name,token,color] of [['advanced','advance','#000'],['intermediate','intermediate','#686868'],['elementary','development','#fff'],['special','event','#d72732']])assert.ok(css.includes('.program-color.cal-'+name+'{background:var(--swa-prog-'+token+','+color+')'),name);
const portal=readFileSync('app/portal.html','utf8');
assert.match(portal,/\.cal-elementary\{--c:var\(--swa-prog-development\)\}[\s\S]*?\.cal-intermediate\{--c:var\(--swa-prog-intermediate\)\}\.cal-advanced\{--c:var\(--swa-prog-advance\)\}\.cal-special\{--c:var\(--swa-prog-event\)\}/,'the bars use the program tokens');
assert.match(portal,/\.day \.bar i\{display:block;flex:1;height:6px;border-radius:3px;background:var\(--c\)\}/,'a 6px bar');
assert.match(portal,/calView=typeof matchMedia==='function'&&matchMedia\('\(max-width:650px\)'\)\.matches\?'week':'month'/,'phones open on the week');
console.log('Passed: program colors on desktop and phone, events and extra practices as one red bar, archive exclusion, the legend and event details with owner actions.');
