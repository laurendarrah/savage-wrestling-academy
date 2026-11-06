(() => {
 const setup=document.getElementById('setupTestFamily');
 const status=document.getElementById('testFamilyStatus');
 const consent=document.getElementById('testConsentSource');
 const wrestlers=document.getElementById('testFamilyWrestlers');
 setup.onclick=async()=>{
  if(!consent.value){status.textContent='Choose your saved Parent Consent Form and version first.';consent.focus();return}
  setup.disabled=true;status.textContent='Setting up the sample wrestlers and consent forms…';
  try{
   const response=await fetch('/api/test-family',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({selection:consent.value})});
   const data=await response.json();
   if(!response.ok)throw Error(data.error||'Unable to set up the test family.');
   wrestlers.replaceChildren(...data.wrestlers.map(w=>{
    const row=document.createElement('li');
    row.append(w.name+' · '+w.programName+' · Grade '+w.grade+' ');
    if(w.waiver){
     const link=document.createElement('a');
     link.href='/document-sign?id='+encodeURIComponent(w.waiver.id);
     link.textContent=w.waiver.status==='signed'?'View signed test consent':'Sign test Parent Consent Form';
     row.append(link);
    }
    return row;
   }));
   wrestlers.hidden=false;status.textContent='Using '+data.formTitle+' for all three test wrestlers. Refresh this page to include them in the program filter.';
  }catch(error){status.textContent=error.message}
  finally{setup.disabled=false}
 };
 const cleanupStatus=document.getElementById('testCleanupStatus'),noticeKey='swa-test-cleanup-success';
 try{
  const notice=sessionStorage.getItem(noticeKey);
  if(notice){cleanupStatus.textContent=notice;cleanupStatus.hidden=false;sessionStorage.removeItem(noticeKey)}
 }catch{}
 for(const form of document.querySelectorAll('.test-cleanup')){
  form.onsubmit=async event=>{
   event.preventDefault();
   const button=form.querySelector('button'),message=form.querySelector('[role=status]');
   const target=form.elements.target.value;
   if(!target||button.disabled)return;
   button.disabled=true;message.textContent='Deleting the selected test record…';
   try{
    const response=await fetch('/api/test-cleanup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
     userId:form.dataset.familyId,revision:Number(form.dataset.revision),updatedAt:form.dataset.updatedAt,
     wrestlerId:target==='family'?null:target.slice('wrestler:'.length),confirmation:form.elements.confirmation.value
    })});
    const data=await response.json();
    if(!response.ok)throw Error(data.error||'Unable to delete the test record.');
    try{sessionStorage.setItem(noticeKey,data.message)}catch{}
    location.reload();
   }catch(error){message.textContent=error.message;button.disabled=false}
  };
 }
})();
