'use strict';
(() => {
 const $=id=>document.getElementById(id),payload='SWA-ATTENDANCE-DEMO:ALEX',video=$('video'),canvas=document.createElement('canvas'),context=canvas.getContext('2d',{willReadFrequently:true});
 let stream=null,timer=null,generation=0;const checked=new Set();
 function status(message){$('status').textContent=message}
 function stop(){
  generation++;clearTimeout(timer);timer=null;
  stream?.getTracks().forEach(track=>track.stop());stream=null;
  video.pause();video.srcObject=null;video.hidden=true;
  $('start').disabled=false;$('stop').disabled=true;
 }
 function accept(data){
  const name=data===payload||data==='SWA-PREVIEW:athlete-1'?'Alex Demo':data==='SWA-PREVIEW:athlete-2'?'Sam Demo':null;
  if(!name){status('This demo accepts the sample QR pass or Alex and Sam’s sample Wrestler View codes.');return false}
  stop();
  if(new URLSearchParams(location.search).get('embedded')==='1'&&window.parent&&window.parent!==window){
   status('QR read. Checking the selected day’s roster…');
   window.parent.postMessage({type:'swa-demo-checkin',wrestler:name==='Alex Demo'?'alex':'sam'},location.origin);
   return true;
  }
  $('attendanceName').textContent=name+':';
  $('attendance').textContent='Checked in';
  if(checked.has(name)){status(name+' is already checked in for this test.');return true}
  checked.add(name);status('QR scanned. '+name+' is checked in for this test.');
  return true;
 }
 function decode(source,width,height){
  if(!width||!height)return null;
  const scale=Math.min(1,960/Math.max(width,height));canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
  context.drawImage(source,0,0,canvas.width,canvas.height);
  const image=context.getImageData(0,0,canvas.width,canvas.height);
  return window.jsQR(image.data,image.width,image.height,{inversionAttempts:'attemptBoth'})?.data;
 }
 function tick(){
  if(!stream)return;
  try{const result=decode(video,video.videoWidth,video.videoHeight);if(result&&accept(result))return}
  catch{stop();status('Could not read the camera. Try an image of the sample QR code.');return}
  timer=setTimeout(tick,180);
 }
 $('start').onclick=async()=>{
  if(!navigator.mediaDevices?.getUserMedia){status('Camera access is unavailable here. Open this page directly in your browser or use an image.');return}
  $('start').disabled=true;$('stop').disabled=false;const token=++generation;status('Waiting for camera permission…');
  try{
   const opened=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
   if(token!==generation){opened.getTracks().forEach(track=>track.stop());return}
   stream=opened;video.srcObject=stream;video.hidden=false;await video.play();
   if(token!==generation)return;
   status('Camera on. Point it at the sample pass.');tick();
  }catch(error){if(token!==generation)return;stop();status(error?.name==='NotAllowedError'?'Camera permission was denied. Allow camera access in your browser settings or choose an image.':'Camera unavailable. Try an image of the sample QR code.')}
 };
 $('stop').onclick=()=>{stop();status('Camera off.')};
 $('reset').onclick=()=>{stop();checked.clear();$('attendanceName').textContent='Alex Demo:';$('attendance').textContent='Not checked in';status('Sample attendance reset. Camera off.')};
 function scanImage(file){
  stop();const token=generation,img=new Image(),url=URL.createObjectURL(file);
  img.onload=()=>{try{if(token!==generation)return;const result=decode(img,img.naturalWidth,img.naturalHeight);if(result)accept(result);else status('No readable QR code found in this image.')}catch{status('Could not read this image.')}finally{URL.revokeObjectURL(url)}};
  img.onerror=()=>{URL.revokeObjectURL(url);if(token===generation)status('Could not open this image.')};img.src=url;
 }
 $('upload').onchange=()=>{const file=$('upload').files[0];$('upload').value='';if(file)scanImage(file)};
 $('sample').onclick=()=>{
  const svg=window.sampleQrSvg(payload).replace('<svg ','<svg width="360" height="360" ');
  scanImage(new Blob([svg],{type:'image/svg+xml'}));
 };
 window.addEventListener('pagehide',stop);
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&(stream||$('start').disabled)){stop();status('Camera off.') }});
 if(new URLSearchParams(location.search).get('pass')==='1'){$('scanner').hidden=true;$('pass').hidden=false;$('code').innerHTML=window.sampleQrSvg(payload)}
})();
