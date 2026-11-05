// Shared private approval conversation, rendered as text to prevent message HTML execution.
window.ApprovalChat=(()=>{
 let cleanup=null;
 function open(rootId,requestId){
  if(cleanup)cleanup();
  const root=document.getElementById(rootId);root.replaceChildren();root.hidden=false;
  const title=document.createElement('h2');title.textContent='Conversation with '+(root.dataset.owner==='true'?'the parent':'Justin');
  const intro=document.createElement('p');intro.textContent='Private to the owner and this family. Messages save online and refresh while this conversation is open. Email and text notifications are not connected.';
  const messages=document.createElement('div');messages.setAttribute('aria-live','polite');messages.setAttribute('aria-label','Conversation messages');
  const status=document.createElement('p');status.setAttribute('role','status');
  const refresh=document.createElement('button');refresh.type='button';refresh.textContent='Refresh messages';
  const earlier=document.createElement('button');earlier.type='button';earlier.textContent='Load earlier messages';earlier.hidden=true;
  const form=document.createElement('form'),label=document.createElement('label'),textarea=document.createElement('textarea'),send=document.createElement('button');
  textarea.required=true;textarea.maxLength=2000;textarea.rows=4;textarea.style.cssText='display:block;width:100%;font:inherit;padding:12px;border:1px solid #ccc;border-radius:6px';label.textContent='Your message';label.append(textarea);send.type='submit';send.className='primary';send.textContent='Send message';form.append(label,send);
  root.append(title,intro,earlier,messages,refresh,form,status);
  let active=true,busy=false,sending=false,next=null,history=[],latest=[];
  const draw=()=>{messages.replaceChildren();const seen=new Set();const all=[...history,...latest].filter(m=>{if(seen.has(m.id))return false;seen.add(m.id);return true});if(!all.length){const p=document.createElement('p');p.textContent='No messages yet. Discuss experience, goals, practice intensity, and suitable training partners here.';messages.append(p)}for(const m of all){const article=document.createElement('article'),by=document.createElement('strong'),body=document.createElement('p'),date=document.createElement('small');article.style.cssText='padding:16px;border:1px solid #ddd;border-radius:8px;margin:12px 0;background:'+(m.sender_role==='owner'?'#fff0f0':'#f6f6f8');by.textContent=m.sender_role==='owner'?'Justin · Academy owner':'Parent / guardian';body.textContent=m.body;body.style.whiteSpace='pre-wrap';body.style.overflowWrap='anywhere';date.textContent=new Date(m.created_at).toLocaleString();article.append(by,body,date);messages.append(article)}earlier.hidden=!next};
  async function load(older=false,silent=false){if(busy||!active)return;busy=true;try{const r=await fetch('/api/approval-chat?requestId='+encodeURIComponent(requestId)+(older&&next?'&before='+encodeURIComponent(next):''),{cache:'no-store'}),d=await r.json();if(!r.ok)throw Error(d.error||'Unable to load messages.');if(!active)return;if(older){history=[...d.messages,...history];next=d.next}else{latest=d.messages;if(!history.length)next=d.next}draw();if(!silent)status.textContent='Messages updated.'}catch(e){if(active)status.textContent=e.message}finally{busy=false}}
  form.onsubmit=async e=>{e.preventDefault();if(sending||!active)return;const text=textarea.value.trim();if(!text)return;sending=true;send.disabled=true;status.textContent='Sending…';try{const r=await fetch('/api/approval-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId,message:text})}),d=await r.json();if(!r.ok)throw Error(d.error||'Message not sent.');if(!active)return;textarea.value='';latest.push({id:d.id,sender_role:root.dataset.owner==='true'?'owner':'parent',body:text,created_at:d.createdAt});draw();status.textContent='Message sent and saved.';await load(false,true)}catch(e){if(active)status.textContent=e.message+' Your message has not been sent.'}finally{sending=false;send.disabled=false}};
  refresh.onclick=()=>load();earlier.onclick=()=>load(true);const timer=setInterval(()=>{if(document.visibilityState==='visible'&&document.contains(root))load(false,true)},15000);const onFocus=()=>load(false,true);window.addEventListener('focus',onFocus);cleanup=()=>{active=false;clearInterval(timer);window.removeEventListener('focus',onFocus)};load();
 }
 return {open,close(){if(cleanup)cleanup();cleanup=null}};
})();
