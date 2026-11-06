(() => {
 const byId=id=>document.getElementById(id);
 const date=byId('date'),practice=byId('practice'),status=byId('status'),scan=byId('scan');
 const manual=byId('manual'),manualRoster=byId('manualRoster');
 const roster=byId('roster'),video=byId('camera'),canvas=byId('frame'),stop=byId('stop');
 const query=new URLSearchParams(location.search);
 const test=query.get('test')==='1',account=query.get('account'),wrestler=query.get('wrestler');
 if(test){byId('heading').textContent='Test attendance';byId('testNotice').hidden=false}
 const enrollment=byId('enrollment'),enrollProgram=byId('enrollProgram'),enrollKind=byId('enrollKind');
 const enrollDate=byId('enrollDate'),enrollEnd=byId('enrollEnd'),enrollPractice=byId('enrollPractice');
 const enrollStatus=byId('enrollStatus'),saveSignup=byId('saveSignup');
 let today='',stream,frame,reading=0,loading=0,slotsRequest=0,submitting=false;
 const time=value=>new Date('2000-01-01T'+value+':00Z').toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZone:'UTC'});
 const period=p=>time(p.start)+' – '+time(p.end);
 const cardLabels={missing:'USA Wrestling card missing',pending:'USA Wrestling card needs review',expired:'USA Wrestling card expired',current:'USA Wrestling card verified'};
 const session=()=>({date:date.value,practiceId:practice.value});

 async function api(params,body){
  const search=new URLSearchParams(params??{});
  if(test)search.set('test','1');
  const url='/api/attendance'+(search.size?'?'+search:'');
  const response=await fetch(url,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,test})}:{cache:'no-store'});
  const data=await response.json();
  if(!response.ok)throw Error(data.error||'Unable to load attendance.');
  return data;
 }
 function renderRoster(data){
  const {roster:people,practice:selected}=data;
  byId('total').textContent=selected?people.filter(p=>p.checkedAt).length+' checked in · '+people.length+' on roster':'Select a practice to see the roster.';
  roster.replaceChildren(...people.map(p=>{
   const li=document.createElement('li'),name=document.createElement('strong'),info=document.createElement('div');
   const detail=document.createElement('small'),action=document.createElement('button');
   name.textContent=p.name;
   detail.textContent=p.kind+(p.checkedAt?' · Checked in at '+new Date(p.checkedAt).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZone:'America/New_York'})+' ('+(p.method==='qr'?'QR':'manual')+')':'');
   info.append(name,detail);
   const needsCard=p.cardStatus&&p.cardStatus!=='current';
   if(p.cardStatus){
    const card=document.createElement('small');
    card.textContent=cardLabels[p.cardStatus];
    if(needsCard){
     card.className='card-warning';
     const link=document.createElement('a');
     link.href='/usa-card?account='+encodeURIComponent(p.userId)+'&wrestler='+encodeURIComponent(p.wrestlerId);
     link.target='_blank';link.rel='noopener';link.textContent='Review card';
     card.append(' · ',link);
    }
    info.append(card);
   }
   action.type='button';action.textContent=p.checkedAt?'Undo check-in':'Check in';action.disabled=date.value>today||(!p.checkedAt&&date.value===today&&!!needsCard);
   action.setAttribute('aria-label',action.textContent+' for '+p.name);
   action.onclick=()=>check({action:p.checkedAt?'undo':'check',userId:p.userId,wrestlerId:p.wrestlerId},action);
   li.append(info,action);return li;
  }));
 }
 async function load(preferred='',initial=false){
  const ticket=++loading,params={};
  if(date.value)params.date=date.value;
  if(preferred)params.practice=preferred;
  if(initial&&account&&wrestler)Object.assign(params,{account,wrestler});
  practice.disabled=true;scan.disabled=true;manual.disabled=true;roster.replaceChildren();
  byId('total').textContent='Loading…';
  try{
   let data=await api(params);
   if(ticket!==loading)return;
   today=data.today;date.value=params.date||today;
   const selected=data.practice?.id||data.practices[0]?.id||'';
   if(selected&&!data.practice){
    const {practice,roster}=await api({date:date.value,practice:selected});
    if(ticket!==loading)return;
    data={...data,practice,roster};
   }
   const names=new Map(data.programs.map(p=>[p.id,p.name]));
   practice.replaceChildren(...(data.practices.length?data.practices.map(p=>new Option(
    names.get(p.program)+' · '+period(p)+(p.scheduled?'':' · Saved practice'),p.id
   )):[new Option('No practices scheduled','')]));
   practice.value=selected;practice.disabled=!selected;
   scan.disabled=!selected||date.value!==today;manual.disabled=!selected;
   renderRoster(data);
   if(initial&&data.wrestler){
    byId('enrollWrestler').textContent=data.wrestler.name;
    enrollProgram.replaceChildren(...data.programs.map(p=>new Option(p.name,p.id)));
    enrollDate.value=today;enrollment.hidden=false;await updateSlots();
   }
  }catch(e){if(ticket===loading){status.textContent=e.message;byId('total').textContent='Roster unavailable.'}}
 }
 async function check(payload,button){
  const selected=session();
  if(button)button.disabled=true;
  try{
   const result=await api(null,{...selected,...payload});
   if(selected.date!==date.value||selected.practiceId!==practice.value)return;
   status.textContent=result.message;
   await load(selected.practiceId);
  }catch(e){
   status.textContent=e.message;
   if(payload.action==='scan')manualRoster.hidden=false;
  }
  finally{if(button&&button.isConnected)button.disabled=date.value>today}
 }
 function stopCamera(){
  reading++;cancelAnimationFrame(frame);
  stream?.getTracks().forEach(track=>track.stop());stream=null;
  video.srcObject=null;video.hidden=true;stop.hidden=true;
 }
 async function startCamera(){
  stopCamera();manualRoster.hidden=true;
  const attempt=reading;
  status.textContent='Starting camera…';scan.disabled=true;
  try{
   const opened=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
   if(attempt!==reading){opened.getTracks().forEach(track=>track.stop());return}
   stream=opened;video.srcObject=stream;video.hidden=false;stop.hidden=false;await video.play();
   if(attempt!==reading)return;
   status.textContent='Hold the wrestler’s QR code in front of the camera.';
   const context=canvas.getContext('2d',{willReadFrequently:true});
   function read(){
    if(attempt!==reading)return;
    if(video.readyState>=2&&video.videoWidth){
     canvas.width=Math.min(640,video.videoWidth);canvas.height=Math.round(canvas.width*video.videoHeight/video.videoWidth);
     context.drawImage(video,0,0,canvas.width,canvas.height);
     const pixels=context.getImageData(0,0,canvas.width,canvas.height);
     const found=window.jsQR(pixels.data,pixels.width,pixels.height,{inversionAttempts:'dontInvert'});
     if(found){stopCamera();scan.disabled=false;void check({action:'scan',code:found.data});return}
    }
    frame=requestAnimationFrame(read);
   }
   frame=requestAnimationFrame(read);
  }catch{
   if(attempt!==reading)return;
   stopCamera();scan.disabled=false;status.textContent='Camera unavailable. You can check in wrestlers by name.';
  }
 }
 async function updateSlots(){
  const ticket=++slotsRequest,walkin=enrollKind.value==='walkin';
  byId('enrollDateLabel').textContent=walkin?'Practice date':'Membership start';
  byId('enrollEndLabel').hidden=walkin;enrollEnd.disabled=walkin;
  byId('enrollPracticeLabel').hidden=!walkin;enrollPractice.disabled=!walkin;
  enrollPractice.required=walkin;saveSignup.disabled=walkin||submitting;
  if(!walkin||!enrollDate.value)return;
  enrollPractice.replaceChildren(new Option('Loading practices…',''));
  try{
   const day=await api({date:enrollDate.value});
   if(ticket!==slotsRequest)return;
   const options=day.practices.filter(p=>p.scheduled&&p.program===enrollProgram.value).map(p=>new Option(period(p),p.id));
   enrollPractice.replaceChildren(...(options.length?options:[new Option('No scheduled practice','')]));
   saveSignup.disabled=!options.length||submitting;
  }catch(e){if(ticket===slotsRequest)enrollStatus.textContent=e.message}
 }
 byId('enrollForm').onsubmit=async event=>{
  event.preventDefault();
  if(submitting)return;
  const enrollmentDate=enrollDate.value,practiceId=enrollPractice.value;
  submitting=true;saveSignup.disabled=true;
  try{
   const result=await api(null,{action:'enroll',userId:account,wrestlerId:wrestler,program:enrollProgram.value,
    kind:enrollKind.value,date:enrollmentDate,endsOn:enrollEnd.value,practiceId});
   enrollStatus.textContent=result.message;date.value=enrollmentDate;await load(practiceId);
  }catch(e){enrollStatus.textContent=e.message}
  finally{submitting=false;saveSignup.disabled=enrollKind.value==='walkin'&&!enrollPractice.value}
 };
 for(const control of [enrollProgram,enrollKind,enrollDate])control.onchange=()=>{enrollStatus.textContent='';void updateSlots()};
 date.onchange=()=>{stopCamera();status.textContent='';void load()};
 practice.onchange=()=>{stopCamera();status.textContent='';void load(practice.value)};
 manual.onclick=()=>{
  const wasScanning=!video.hidden||scan.disabled&&date.value===today;
  stopCamera();scan.disabled=date.value!==today;manualRoster.hidden=false;
  if(wasScanning)status.textContent='';
  byId('rosterHeading').focus();
 };
 window.addEventListener('focus',()=>{if(!manualRoster.hidden&&practice.value&&!submitting&&video.hidden)void load(practice.value)});
 scan.onclick=startCamera;stop.onclick=()=>{stopCamera();scan.disabled=false;status.textContent='Camera stopped.'};
 window.SavagePageNavigation={
  snapshot:()=>({date:date.value,practice:practice.value,manual:!manualRoster.hidden}),
  restore(view){
   if(!view||typeof view.date!=='string'||typeof view.practice!=='string')return;
   stopCamera();date.value=view.date;manualRoster.hidden=!view.manual;void load(view.practice,true);
  }
 };
 addEventListener('swa-panel-hidden',()=>{
  stopCamera();scan.disabled=!practice.value||date.value!==today;
  if(status.textContent==='Starting camera…'||status.textContent.startsWith('Hold the wrestler'))status.textContent='';
 });
 addEventListener('swa-panel-shown',()=>void load(practice.value));
 addEventListener('pagehide',stopCamera);
 void load('',true);
})();
