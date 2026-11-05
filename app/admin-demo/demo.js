function demoUUID(){return Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('')}
// This is injected only in the public, network-blocked demo document.
function startAdminDemo(){
 liveWorkspace=false;
 const notes=new Map();
 const originalGo=go;go=p=>p==='Scholarships'?toast('Private scholarship offers are managed from the signed-in owner workspace.'):originalGo(p);
 document.querySelector('.owner-tools')?.remove();
 const refresh=document.querySelector('.owner-tools-wrap button');
 if(refresh)refresh.textContent='Reset demo';
 const blocked=event=>{
  const link=event.target.closest?.('a[href]');
  if(!link||link.getAttribute('href').startsWith('#')||link.getAttribute('href')==='/attendance-demo')return;
  event.preventDefault();
  toast('This link is outside the sample workspace.');
 };
 document.addEventListener('click',blocked,true);
 document.addEventListener('auxclick',blocked,true);
 save=()=>syncStatus('Saved for this demo tab');
 loadCalendarPlanSummary=async()=>{
  const key=calendarMonthKey();
  if(!calendarPlanSummaries[key]){calendarPlanSummaries[key]={status:'ready',items:[]};render()}
 };
 downloadWorkspace=()=>toast('Exports are disabled in this demo.');
 ownerSignout=()=>toast('No sign-in is needed for this demo.');
 openPublishedCalendar=()=>setMode('public');
 openAttendanceScanner=()=>{location.href='/attendance-demo'};
 calendarPractice=(program,date)=>{
  const p=programs.find(p=>p.id===program);
  if(!p||!practiceSlot(p,date))return;
  const key=program+':'+date;
  modal('<h2>Sample practice notes</h2><p>'+esc(p.name)+' · '+esc(date)+'</p><form id="demo-plan-form"><label>Practice notes<textarea name="notes" rows="5" maxlength="2000">'+esc(notes.get(key)||'')+'</textarea></label><button class="primary">Save sample notes</button></form>');
  document.getElementById('demo-plan-form').onsubmit=e=>{e.preventDefault();notes.set(key,e.target.elements.notes.value);closeModal();toast('Sample notes saved for this tab.')};
 };
 function loadSamples(){
  const today=academyToday(),[y,m]=today.split('-').map(Number),start=today.slice(0,7)+'-01',end=dateKey(new Date(y,m+2,0));
  const nextFriday=new Date(today+'T12:00:00');
  nextFriday.setDate(nextFriday.getDate()+((5-nextFriday.getDay()+7)%7||7));
  data=structuredClone(seed);
  data.seasons=[
   {program:'Elementary',weekly:[{day:'Monday',start:'18:00',end:'19:30'},{day:'Wednesday',start:'18:00',end:'19:30'}]},
   {program:'Intermediate',weekly:[{day:'Tuesday',start:'18:00',end:'19:30'}]},
   {program:'Advanced',weekly:[{day:'Thursday',start:'19:30',end:'21:00'}]}
  ].map(s=>({...s,season:'Sample semester',start,end,excludedDates:[]}));
  data.extraPractices=[{id:'sample-live',name:'Friday Night Live',dates:[dateKey(nextFriday)],start:'18:00',end:'19:00',memberCents:1000,nonMemberCents:2000,enabled:true,gradeRange:'7–12',description:'Sample live wrestling session.'}];
  const clinic=new Date(nextFriday);clinic.setDate(clinic.getDate()+1);
  data.events=[{id:'sample-clinic',name:'Takedown Clinic',type:'Clinic',dates:[dateKey(clinic)],price:40,slots:20,gradeRange:'K–6',description:'Sample clinic for practicing takedown fundamentals.'}];
  mode='admin';page='Dashboard';year=y;month=m-1;filter='All programs';notes.clear();calendarPlanSummaries={};
  hydratePrograms();ensurePortalData();cloudReady=true;saveBlocked=false;syncStatus('Sample workspace');render();
 }
 reloadAcademy=async()=>{if(confirm('Reset this demo to its sample data?'))loadSamples()};
 loadSamples();
}
