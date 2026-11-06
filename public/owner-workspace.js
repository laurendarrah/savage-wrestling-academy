(() => {
 const routes={
  'Public Calendar':'/calendar','Coach View':'/coach','Parent View':'/family','Families':'/accounts','Attendance':'/attendance','Waivers & Contracts':'/documents',
  'Scholarships':'/scholarships','Financials':'/financials',
  'Coach timesheets':'/coach-time?review=1','Coach Time Off':'/coach-time-off?review=1'
 };
 const sections=new Map(Object.entries(routes).map(([page,path])=>[path.split('?')[0],page]));
 const panels=new Map();
 let current=null;
 function toolUrl(page,search=''){
  const url=new URL(routes[page],location.origin);
  for(const [key,value] of new URLSearchParams(search)){
   if(key!=='review'&&key!=='embed')url.searchParams.append(key,value);
  }
  url.searchParams.set('embed','owner');
  return url.pathname+url.search;
 }
 function notify(entry,name){
  // A failed or redirected iframe may be inaccessible until it is retried.
  entry.frame.contentDocument?.defaultView?.dispatchEvent(new Event(name));
 }
 function show(page,search,onSelect){
  const outlet=document.getElementById('ownerWorkspacePanels');
  const target=Object.hasOwn(routes,page)?page:null;
  if(current!==target){
   const previous=panels.get(current);
   if(previous){notify(previous,'swa-panel-hidden');previous.panel.hidden=true}
   current=target;
  }
  outlet.hidden=!target;
  if(!target)return false;
  let entry=panels.get(target);
  if(!entry){
   const panel=document.createElement('section'),frame=document.createElement('iframe'),status=document.createElement('p');
   entry={panel,frame,status,search:null};
   panels.set(target,entry);
   status.setAttribute('role','status');
   frame.title=target;
   if(target==='Attendance')frame.setAttribute('allow','camera');
   frame.addEventListener('load',()=>{
    try{
     const doc=frame.contentDocument;
     if(!doc?.body.classList.contains('owner-embedded'))throw Error('Panel unavailable');
     status.hidden=true;frame.hidden=false;
     doc.addEventListener('click',event=>{
      const link=event.target.closest?.('a[href]');
      if(!link||event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.altKey||event.shiftKey||
       (link.target&&link.target!=='_self')||link.hasAttribute('download')||link.getAttribute('href').startsWith('#'))return;
      const url=new URL(link.href);
      if(url.origin!==location.origin)return;
      const next=sections.get(url.pathname);
      event.preventDefault();
      if(next===target){
       frame.contentWindow.location.replace(toolUrl(next,url.search));
      }else if(next){
       onSelect(next,url.search);
      }else{
       window.SavageNavigation?.leaving(url.href);
       window.location.assign(url.href);
      }
     });
     doc.addEventListener('submit',event=>{
      const form=event.target;
      if(event.defaultPrevented||form.method!=='get'||form.target)return;
      const url=new URL(form.action);
      if(url.origin!==location.origin||sections.get(url.pathname)!==target)return;
      event.preventDefault();
      frame.contentWindow.location.replace(toolUrl(target,new URLSearchParams(new FormData(form))));
     });
    }catch{
     frame.hidden=true;status.hidden=false;
     status.textContent='This section could not load. ';
     const retry=document.createElement('button'),signIn=document.createElement('a');
     retry.type='button';retry.textContent='Retry';retry.onclick=()=>load(entry,target,entry.search);
     signIn.href='/login';signIn.textContent='Sign in again';
     status.append(retry,' ',signIn);
    }
   });
   panel.append(status,frame);outlet.append(panel);
  }
  const wasHidden=entry.panel.hidden;
  entry.panel.hidden=false;
  if(entry.search!==search)load(entry,target,search);
  else if(wasHidden)notify(entry,'swa-panel-shown');
  return true;
 }
 function load(entry,page,search){
  entry.search=search;
  entry.status.hidden=false;entry.frame.hidden=true;
  entry.status.textContent='Loading '+page+'…';
  entry.frame.src=toolUrl(page,search);
 }
 window.SavageOwnerWorkspace={show};
})();
