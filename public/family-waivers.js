(() => {
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const stamp=value=>new Date(value).toLocaleDateString('en-US',{timeZone:'America/New_York',dateStyle:'medium'});
 const signingLink=id=>new URL('/document-sign?id='+encodeURIComponent(id),location.origin).href;
 const draftEmail=(address,title,url)=>'mailto:'+encodeURIComponent(address).replace('%40','@')+'?'+
  'subject='+encodeURIComponent('SWA signature request: '+title)+'&body='+encodeURIComponent(
   'Hi,\n\nAs the wrestler’s parent or legal guardian, please sign '+title+' in your SWA family account using this link:\n'+url+'\n\nThank you,\nSavage Wrestling Academy');
 async function documents(params,body){
  const response=await fetch('/api/documents'+(params?'?'+new URLSearchParams(params):''),
   body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});
  const data=await response.json();
  if(!response.ok)throw Error(data.error||'Unable to load family documents.');
  return data;
 }
 function record(r,address){
  const id=encodeURIComponent(r.id),pending=r.status==='pending',signed=r.status==='signed',url=signingLink(r.id);
  const state=signed?'Signed':pending?'Needs signature':'Withdrawn';
  return `<li><strong>${escape(r.title)}</strong> · ${r.kind==='waiver'?'Waiver':'Contract'} · v${escape(r.version)}
   <span class="tag ${signed?'active':pending?'pending':''}">${state}</span><br>
   Wrestler covered: ${escape(r.wrestler_name)} · ${signed?'Signed by '+escape(r.signer)+' · '+escape(stamp(r.signed_at)):'Requested '+escape(stamp(r.assigned_at))}
   <div class="document-actions">${signed?`<a href="/document-copy?id=${id}">View signed copy &amp; signature</a>`:
    pending?`<button type="button" class="secondary" data-copy="${escape(url)}">Copy signing link</button>
    <a href="${escape(draftEmail(address,r.title,url))}">Email signing link</a>`:''
   }</div></li>`;
 }
 const panels=[...document.querySelectorAll('details[data-family]')];
 for(const details of panels){
  const panel=details.querySelector('.document-panel'),userId=details.dataset.family;
  let offset=0,selected='',requestInProgress=false,share=null;
  async function copy(url){
   const input=panel.querySelector('.family-link'),message=panel.querySelector('[role=status]');
   input.hidden=false;input.value=url;
   try{await navigator.clipboard.writeText(url);message.textContent='Signing link copied.'}
   catch{input.focus();input.select();message.textContent='Select and copy the signing link.'}
  }
  function render(data){
   panel.innerHTML=`<h3>Signature records</h3>
    ${data.records.length?`<ul>${data.records.map(r=>record(r,data.email)).join('')}</ul>`:'<p>No signature requests or signed copies on file.</p>'}
    ${offset||data.hasMore?`<div class="document-actions">${offset?'<button type="button" class="secondary" data-step="-50">Previous records</button>':''}
     ${data.hasMore?'<button type="button" class="secondary" data-step="50">More records</button>':''}</div>`:''}
    <h3>Request a parent or guardian signature</h3>
    <p><strong>Send to:</strong> ${escape(data.parentName||'Parent / legal guardian')} · ${escape(data.email)}</p>
    ${data.wrestlers.length&&data.templates.length?`<form>
     <div class="request-fields"><label>Wrestler covered by the form<select name="wrestler">${data.wrestlers.map(w=>`<option value="${escape(w.id)}">${escape(w.name)}</option>`).join('')}</select></label>
     <label>Published document<select name="version" required></select></label></div>
     <button type="submit">Request parent signature</button>
    </form>`:data.wrestlers.length?'<p>Publish a waiver or contract in <a href="/documents">Waivers &amp; Contracts</a> to request a signature.</p>':'<p>A wrestler needs to be saved on this family profile before you can request a signature.</p>'}
    ${data.moreTemplates?'<p>Showing the first 500 published templates. <a href="/documents">Manage templates</a>.</p>':''}
    <p class="muted">Requests appear in the parent or guardian’s family account. Use the signing link to follow up with them by email or text.</p>
    <p role="status">${share?'Request added to the family account.':''}</p>
    ${share?`<div class="document-actions"><button class="secondary" type="button" data-copy="${escape(share.url)}">Copy new signing link</button>
     <a href="${escape(draftEmail(data.email,share.title,share.url))}">Email new signing link</a></div>`:''}
    <input class="family-link" aria-label="Family signing link" value="${escape(share?.url||'')}" readonly ${share?'':'hidden'}>`;
   panel.querySelectorAll('[data-copy]').forEach(button=>button.onclick=()=>copy(button.dataset.copy));
   panel.querySelectorAll('[data-step]').forEach(button=>button.onclick=()=>{offset+=Number(button.dataset.step);void load()});
   const form=panel.querySelector('form');
   if(!form)return;
   const wrestler=form.elements.wrestler,version=form.elements.version,button=form.querySelector('button');
   if(data.wrestlers.some(w=>w.id===selected))wrestler.value=selected;
   function options(){
    selected=wrestler.value;
    const available=data.templates.filter(t=>!t.assigned.includes(selected));
    version.replaceChildren(new Option(available.length?'Choose a document':'No unassigned published versions',''),
     ...available.map(t=>new Option(t.title+' · v'+t.version,t.id)));
    button.disabled=!available.length;
   }
   wrestler.onchange=options;options();
   form.onsubmit=async event=>{
    event.preventDefault();
    if(requestInProgress)return;
    const chosen=data.templates.find(t=>t.id===version.value);
    if(!chosen)return;
    requestInProgress=true;button.disabled=true;
    const message=panel.querySelector('[role=status]');
    try{
     const result=await documents(null,{action:'assign',userId,wrestlerId:selected,versionId:chosen.id});
     share={url:signingLink(result.id),title:chosen.title};offset=0;await load();
    }catch(e){message.textContent=e.message;button.disabled=false}
    finally{requestInProgress=false}
   };
  }
  async function load(){
   panel.innerHTML='<p role="status">Loading family documents…</p>';
   try{render(await documents({mode:'family',family:userId,offset}))}
   catch(e){
    panel.innerHTML='<p role="status"></p><button type="button" class="secondary">Retry</button>';
    panel.querySelector('p').textContent=e.message;
    panel.querySelector('button').onclick=load;
   }
  }
  details.addEventListener('toggle',()=>{if(details.open&&!requestInProgress)void load()});
 }
 window.SavagePageNavigation={
  snapshot:()=>panels.flatMap((panel,i)=>panel.open?[i]:[]),
  restore(open){if(Array.isArray(open))panels.forEach((panel,i)=>{panel.open=open.includes(i)})}
 };
})();
