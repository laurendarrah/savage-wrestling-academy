import html from '../scholarship/screen.html?raw';
export function GET(){
 const boot=`<script>
 const sampleAward={id:'sample-signature',wrestler_name:'Sample Wrestler',program:'Intermediate',terms_ready:1,terms_text:'SAMPLE ONLY — signature demonstration.\\n\\nThis fictional agreement lets you try printing a parent/guardian name, drawing a signature, and recording the signing date. It creates no membership, payment obligation, or contract. Your sample signature stays in this page and resets when you reload.',revision:1,status:'offered'};
 window.fetch=async(path,options)=>{
  if(path==='/api/family')return {ok:true,json:async()=>({data:{wrestlers:[{id:'sample-wrestler',name:'Sample Wrestler',grade:'7'}]}})};
  if(path!=='/api/scholarship')throw Error('This example does not connect to live accounts.');
  const body=JSON.parse(options?.body||'{}');
  if(body.action==='accept'){
   const strokes=body.signature?.strokes||[];
   if(!body.electronicConsent||!body.accepted||!body.signer?.trim())return {ok:false,json:async()=>({error:'Enter a name and confirm both acknowledgments.'})};
   if(body.signature?.method==='drawn'&&!strokes.some(stroke=>stroke.length>1))return {ok:false,json:async()=>({error:'Draw a sample signature before continuing.'})};
   sampleAward.status='active';
  }
  return {ok:true,json:async()=>({award:sampleAward,accepted:sampleAward.status==='active'})};
 };
 document.addEventListener('click',e=>{const link=e.target.closest('a');if(!link)return;if(link.getAttribute('href')==='/scholarships')return;e.preventDefault();document.getElementById('status').textContent='Sample only. Signed-copy links become available for a real accepted scholarship agreement.'});
 </script>`;
 const preview=html.replace('</head>','</head>'+boot)
  .replace('<title>Scholarship invitation', '<title>Sample scholarship signature')
  .replace('Review the final agreement before accepting. Save the invited wrestler in your family profile first.','Review the fictional sample agreement, then print a sample name and draw a signature below.')
  .replace('<h1>Your SWA scholarship offer</h1>','<h1>Try a sample signature</h1><p class="notice"><strong>Sample only.</strong> No real scholarship is activated. Nothing you enter is sent to SWA. Reloading clears this example.</p>')
  .replace('<a href="/family">← My family account</a>','<a href="/scholarships">← Scholarship management</a>')
  .replace(/<p><a href="\/scholarship-agreement[\s\S]*?Download copy<\/a><\/p>/, '<p class="muted">For a real accepted agreement, the parent and SWA can download or print the dated signed copy.</p>')
  .replaceAll('Review your final scholarship agreement.','Try the printed-name, signature, and date fields.')
  .replaceAll('Sign agreement & activate scholarship','Complete sample signature')
  .replaceAll('Scholarship active. Your signed agreement is saved.','Sample signature complete. No real agreement or membership was created.')
  .replaceAll('Scholarship active. View it in your family account.','Sample signature complete. Reload to try again.');
 return new Response(preview,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"sandbox allow-scripts allow-modals allow-forms; default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'"}});
}
