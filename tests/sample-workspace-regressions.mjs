// Regression tests for sample owner-workspace flows in app/portal.html.
// Inline scripts are not typechecked, so these run the page script in a VM
// with a minimal DOM stand-in and call the workspace functions directly.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function loadWorkspace(){
  const html=readFileSync('app/portal.html','utf8');
  let code=html.match(/<script>([\s\S]*)<\/script>/)[1];
  code=code.slice(0,code.indexOf("if(location.hash==='#policy')"));
  const nodes=new Map();
  const node=s=>{if(!nodes.has(s))nodes.set(s,{value:'',style:{},textContent:'',innerHTML:'',focus(){}});return nodes.get(s)};
  const ctx=vm.createContext({console,structuredClone,crypto,URL,Intl,Date,JSON,Set,FormData,location:{hash:''},document:{querySelector:node,addEventListener(){}},window:{addEventListener(){}},setTimeout(){},confirm:()=>true});
  vm.runInContext(code,ctx);
  // Capture UI side effects instead of touching a real DOM or the network.
  vm.runInContext(`hydratePrograms();globalThis.__toasts=[];globalThis.__modals=[];toast=m=>__toasts.push(m);modal=h=>__modals.push(h);closeModal=()=>{};save=()=>{};render=()=>{};`,ctx);
  return {ctx,node,run:src=>vm.runInContext(src,ctx)};
}
const futureDate=days=>new Date(Date.now()+days*86400000).toISOString().slice(0,10);

// Camp and event review must open without throwing and show the right discount.
{
  const w=loadWorkspace();
  w.run(`data.events=[{id:'camp',name:'Sample camp',type:'Camp',dates:['${futureDate(30)}','${futureDate(31)}'],price:160,day:60,slots:20}];`);
  w.node('#eventKid').value='0';
  w.node('#campOption').value='Full camp';
  assert.doesNotThrow(()=>w.run('finishEvent(0)'),'finishEvent must not throw');
  const html=w.run('__modals.at(-1)');
  assert.match(html,/Review your registration/);
  // Seed wrestler 0 is an active member, so the 10% member discount applies: $160 regular, $16 off, $144 total.
  assert.match(html,/Eligible discount<\/span><b>\$16\.00<\/b>/);
  assert.match(html,/Sample total<\/b><b>\$144\.00<\/b>/);
}
{
  const w=loadWorkspace();
  w.run(`data.events=[{id:'clinic',name:'Sample clinic',type:'Clinic',dates:['${futureDate(20)}'],price:50,slots:10}];data.kids[0].member=false;data.bookings=[];`);
  w.node('#eventKid').value='0';
  w.node('#campOption').value='';
  assert.doesNotThrow(()=>w.run('finishEvent(0)'));
  assert.match(w.run('__modals.at(-1)'),/Eligible discount<\/span><b>\$0\.00<\/b>/,'non-members get no discount');
}

// Drop-in grade bands and Advance approval must match lib/program-approval.ts.
function dropIn(grade,program,{member=false,kidProgram=''}={}){
  const w=loadWorkspace();
  w.run(`data.kids=[{name:'Test Wrestler',grade:${JSON.stringify(grade)},member:${member},program:${JSON.stringify(kidProgram)}}];data.bookings=[];`);
  w.node('#dropKid').value='0';
  w.run(`bookDrop(${JSON.stringify(program)},'${futureDate(7)}')`);
  return {booked:w.run('data.bookings.length')===1,toast:w.run('__toasts.at(-1)')};
}
const cases=[
  ['K','Elementary',true],[1,'Elementary',true],[6,'Elementary',true],[7,'Elementary',false],
  [6,'Intermediate',false],[7,'Intermediate',true],[12,'Intermediate',true],
  [6,'Advanced',false],[7,'Advanced',false],[8,'Advanced',false],[9,'Advanced',false],[12,'Advanced',false],
];
for(const [grade,program,expected] of cases){
  const r=dropIn(grade,program);
  assert.equal(r.booked,expected,`grade ${grade} ${program} drop-in should ${expected?'book':'be blocked'} (got toast: ${r.toast})`);
}
for(const grade of [7,8,9,10,11,12]){
  assert.match(dropIn(grade,'Advanced').toast,/coach approval/i,`grade ${grade} Advance drop-in must ask for coach approval`);
}
assert.match(dropIn(6,'Advanced').toast,/Grade does not match/,'grade 6 is outside SWA Advance');
assert.match(dropIn(9,'Advanced',{member:true,kidProgram:'Advanced'}).toast,/Already covered/,'an Advance member does not need a drop-in');

// The sample wrestler form must offer Kindergarten and keep it as "K" when saved.
{
  const w=loadWorkspace();
  w.run('editKid()');
  const form=w.run('__modals.at(-1)');
  assert.match(form,/<option value="K" >Kindergarten<\/option>/);
  assert.match(form,/<option value="12" >12<\/option>/);
  w.run('data.kids[1].grade="K";editKid(1)');
  assert.match(w.run('__modals.at(-1)'),/<option value="K" selected>Kindergarten<\/option>/,'saved Kindergarten grade is preselected');
  w.run(`FormData=class{constructor(f){this.f=f}*[Symbol.iterator](){yield*Object.entries(this.f)}};saveKid(-1,{name:'New Kid',grade:'K',dob:'',shirt:'Youth S',medical:'',usawNumber:'',expiry:''});saveKid(-1,{name:'Older Kid',grade:'8',dob:'',shirt:'Adult S',medical:'',usawNumber:'',expiry:''})`);
  assert.equal(w.run('data.kids.at(-2).grade'),'K');
  assert.equal(w.run('data.kids.at(-1).grade'),8);
}

console.log('Passed: sample camp/clinic review opens with correct discounts; drop-in grade bands K-6 and 7-12 with coach approval for every SWA Advance grade; Kindergarten selectable and saved.');

// With no sample wrestlers (the workspace runs on real data now), the preview's review buttons explain what to do
// instead of throwing (#121).
{
  const w=loadWorkspace();
  w.run(`data.kids=[];data.bookings=[{type:'Sample camp',name:'Someone'}];data.events=[{id:'camp',name:'Sample camp',type:'Camp',dates:['${futureDate(30)}'],price:160,day:60,slots:20}];`);
  w.node('#eventKid').value='';w.node('#enrollKid').value='';w.node('#teamCode').value='';
  assert.doesNotThrow(()=>w.run('finishEvent(0)'),'finishEvent with no wrestlers must not throw');
  assert.doesNotThrow(()=>w.run("enrollReview('Elementary')"),'enrollReview with no wrestlers must not throw');
  assert.equal(w.run('__toasts.filter(t=>/no sample wrestlers/.test(t)).length'),2);
}
console.log('Empty sample workspace: review buttons explain instead of throwing');
