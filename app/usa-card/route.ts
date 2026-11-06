import {env} from 'cloudflare:workers';
import {accountReply,sameOrigin,strongAccount,verifiedOwner} from '../../lib/account-auth';
import {boundedBody,rasterType} from '../../lib/coach-profile';
import {escapeHtml as esc,idValid} from '../../lib/documents';
import {attendanceDate,attendanceToday} from '../../lib/program-attendance';
import {familyProfile} from '../../lib/program-approval';
import {isTestWrestler} from '../../lib/test-family';
import {deleteUsaCardPhoto,usaCardBucket,usaCardLabels,usaCardRenewalThrough,usaCardStatus,type UsaCard} from '../../lib/usa-card';
import {securityEvent} from '../../lib/security-events';

export const dynamic='force-dynamic';
async function cardContext(request:Request){
 const auth=await strongAccount(request),url=new URL(request.url);
 const owner=verifiedOwner(auth.user),ownerView=url.searchParams.has('account');
 const userId=ownerView?url.searchParams.get('account'):auth.user?.id;
 const wrestlerId=url.searchParams.get('wrestler');
 const allowed=!!auth.user?.email_confirmed_at&&(!ownerView||owner)&&
  (!(owner||auth.user.factors?.some(f=>f.status==='verified'))||auth.strong);
 const wrestler=allowed&&idValid(userId)&&idValid(wrestlerId)&&!isTestWrestler(wrestlerId)
  ?(await familyProfile(userId))?.wrestlers.find(w=>w.id===wrestlerId):null;
 return {auth,url,allowed,ownerView,userId:userId??'',wrestlerId:wrestlerId??'',wrestler};
}
const readCard=(userId:string,wrestlerId:string)=>env.DB!.prepare(
 'SELECT card_number,expires_on,photo_key,photo_type,revision,verified_at FROM wrestler_membership_cards WHERE user_id=? AND wrestler_id=?'
).bind(userId,wrestlerId).first<UsaCard>();

export async function GET(request:Request){
 const {auth,url,allowed,ownerView,userId,wrestlerId,wrestler}=await cardContext(request);
 if(!allowed&&!auth.user&&url.searchParams.get('photo')!=='1'){
  auth.headers.set('Location','/login');
  return new Response(null,{status:303,headers:auth.headers});
 }
 if(!allowed)return accountReply({error:'Verified account access required.'},403,auth.headers);
 if(!wrestler)return accountReply({error:'Wrestler not found.'},404,auth.headers);
 const card=await readCard(userId,wrestlerId);
 if(url.searchParams.get('photo')==='1'){
  const object=card?await usaCardBucket()?.get(card.photo_key):null;
  if(!card||!object)return accountReply({error:'Card photo not found.'},404,auth.headers);
  auth.headers.set('Content-Type',card.photo_type);
  auth.headers.set('Content-Disposition','inline');
  auth.headers.set('Content-Security-Policy',"default-src 'none'; sandbox");
  return new Response(object.body,{headers:auth.headers});
 }
 const today=attendanceToday(),status=usaCardStatus(card,today),photoUrl=new URLSearchParams(url.searchParams);
 photoUrl.set('photo','1');
 const expiring=status==='current'&&card!.expires_on<=usaCardRenewalThrough(today);
 const family=ownerView&&expiring?await env.DB!.prepare('SELECT email FROM family_accounts WHERE user_id=?').bind(userId).first<{email:string}>():null;
 const reminder=family&&card?'mailto:'+encodeURIComponent(family.email)+'?subject='+encodeURIComponent('SWA · USA Wrestling card renewal')+
  '&body='+encodeURIComponent(`Hi,

Our records show that ${wrestler.name}’s USA Wrestling card expires on ${card.expires_on}. Please renew it and upload a photo of the new card in your SWA family account before the next practice after expiration.

${url.origin}/family

Thank you,
Savage Wrestling Academy`):null;
 const lookup='<a href="https://www.usawmembership.com/verify_membership" target="_blank" rel="noopener noreferrer">Open USA Wrestling membership lookup</a>';
 const form=ownerView
  ?card&&status==='pending'?`<form id="cardForm"><p>Compare the wrestler’s name, membership number, and expiration on the photo with USA Wrestling’s record. ${lookup}</p>
   <label class="confirm"><input type="checkbox" name="confirmed" required> I checked the official lookup and confirmed a current athlete membership and matching card details.</label>
   <button type="submit">Verify card</button></form>`:''
  :`<form id="cardForm">
   <label>USA Wrestling membership number <input name="number" maxlength="40" value="${esc(card?.card_number)}" required></label>
   <label>Expiration date on the card <input name="expires" type="date" value="${esc(card?.expires_on)}" required></label>
   <label>Photo of the card <input name="photo" type="file" accept="image/jpeg,image/png,image/webp" required></label>
   <p>Upload a clear image that shows the name, membership number, and expiration. JPG, PNG, or WebP, up to 5 MB. A replacement needs to be reviewed again.</p>
   <button type="submit">Submit card for review</button>
  </form>`;
 auth.headers.set('Content-Type','text/html; charset=utf-8');
 return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
 <title>USA Wrestling card | Savage Wrestling Academy</title><link rel="stylesheet" href="/responsive.css">
 <style>body{font:16px/1.55 Arial;background:#f5f5f6;color:#18191c;margin:0}main{max-width:650px;margin:auto;padding:22px}section{background:#fff;border:1px solid #ddd;border-radius:8px;padding:20px}label{display:block;margin:14px 0}input{display:block;width:100%;max-width:100%;font:inherit;min-height:44px;margin-top:5px;box-sizing:border-box}button{font:inherit;font-weight:bold;background:#b72332;color:white;border:0;border-radius:6px;padding:10px 14px;min-height:44px}a{color:#a92330}.status{font-weight:bold}.confirm input{display:inline;width:auto;min-height:0}.card-photo{max-width:100%;max-height:320px;object-fit:contain}</style>
 <script defer src="/navigation.js"></script></head><body><main><p><a href="${ownerView?'/accounts':'/family'}">← ${ownerView?'Families':'My family account'}</a></p>
 <h1>USA Wrestling card</h1><section><h2>${esc(wrestler.name)}</h2><p class="status">${usaCardLabels[status]}</p>
 ${expiring?`<p><strong>Renewal due within 30 days.</strong>${reminder?` <a href="${esc(reminder)}">Open reminder email draft</a>`:''}</p>`:''}
 ${card?`<p>Number: ${esc(card.card_number)}<br>Expires: ${esc(card.expires_on)}</p><p><img class="card-photo" src="/usa-card?${esc(photoUrl.toString())}" alt="Uploaded USA Wrestling card"></p><p><a href="/usa-card?${esc(photoUrl.toString())}" target="_blank" rel="noopener">Open card photo</a></p>`:''}
 ${form}<p id="result" role="status"></p></section>
 <script>
 const form=document.getElementById('cardForm');
 if(form)form.onsubmit=async event=>{
  event.preventDefault();
  const button=event.submitter,notice=document.getElementById('result'),owner=${ownerView},fields=new FormData(form);
  button.disabled=true;notice.textContent=owner?'Verifying card…':'Uploading card…';
  try{
   const photo=fields.get('photo');
   if(!owner&&(!photo||!photo.size||photo.size>5*1024*1024))throw Error('Choose a card photo up to 5 MB.');
   const response=await fetch(location.pathname+location.search,{method:'POST',
    headers:owner?{'Content-Type':'application/json'}:{'Content-Type':photo.type,'X-Card-Number':fields.get('number').trim(),'X-Card-Expires':fields.get('expires'),'X-Card-Revision':'${card?.revision??0}'},
    body:owner?JSON.stringify({revision:${card?.revision??0},confirmed:fields.get('confirmed')==='on'}):photo});
   const data=await response.json();if(!response.ok)throw Error(data.error);
   location.reload();
  }catch(error){notice.textContent=error.message;button.disabled=false}
 };
 </script></main></body></html>`,{headers:auth.headers});
}

export async function POST(request:Request){
 const {auth,allowed,ownerView,userId,wrestlerId,wrestler}=await cardContext(request);
 const reply=(b:unknown,s=200)=>accountReply(b,s,auth.headers);
 if(!allowed||!sameOrigin(request))return reply({error:'Verified account access required.'},403);
 if(!wrestler)return reply({error:'Wrestler not found.'},404);
 const db=env.DB!,now=new Date().toISOString(),actor=auth.user!.id;
 if(ownerView){
  let input;
  try{const raw=await boundedBody(request,256);input=raw?JSON.parse(new TextDecoder().decode(raw)):null}catch{return reply({error:'Reload the card before verifying.'},400)}
  const revision=input?.revision;
  if(typeof revision!=='number'||!Number.isSafeInteger(revision)||revision<1||input.confirmed!==true){
   return reply({error:'Confirm the card using the USA Wrestling lookup before verifying.'},400);
  }
  const row=await db.prepare(`UPDATE wrestler_membership_cards SET verified_at=?,verified_by=?,revision=revision+1
   WHERE user_id=? AND wrestler_id=? AND revision=? AND expires_on>=? AND verified_at IS NULL RETURNING wrestler_id`)
   .bind(now,actor,userId,wrestlerId,revision,attendanceToday()).first();
  if(!row)return reply({error:'The card changed, expired, or was already verified. Reload to review it.'},409);
  await securityEvent(actor,'usa_card_verified',wrestlerId);
  return reply({ok:true});
 }
 const number=request.headers.get('x-card-number')?.trim(),expires=request.headers.get('x-card-expires'),revision=Number(request.headers.get('x-card-revision'));
 if(!number||!/^[a-zA-Z0-9-]{1,40}$/.test(number)||!attendanceDate(expires)||!Number.isSafeInteger(revision)||revision<0){
  return reply({error:'Enter the membership number and expiration date from the card.'},400);
 }
 const storage=usaCardBucket();
 if(!storage)return reply({error:'Card photo storage is temporarily unavailable.'},503);
 const photo=await boundedBody(request,5*1024*1024);
 if(!photo)return reply({error:'Choose a photo up to 5 MB.'},413);
 const type=rasterType(photo);
 if(!type||type!==request.headers.get('content-type'))return reply({error:'Use a JPG, PNG, or WebP image.'},415);
 const old=await readCard(userId,wrestlerId);
 if((old?.revision??0)!==revision)return reply({error:'This card changed. Reload before replacing it.'},409);
 const key='usa-wrestling-cards/'+crypto.randomUUID();
 await storage.put(key,photo,{httpMetadata:{contentType:type}});
 const stillInFamily=`EXISTS (SELECT 1 FROM family_accounts f,json_each(f.payload,'$.wrestlers') w
  WHERE f.user_id=? AND json_extract(w.value,'$.id')=?)`;
 let saved;
 try{
  saved=old?await db.prepare(`UPDATE wrestler_membership_cards SET card_number=?,expires_on=?,photo_key=?,photo_type=?,
   verified_at=NULL,verified_by=NULL,revision=revision+1 WHERE user_id=? AND wrestler_id=? AND revision=? AND ${stillInFamily} RETURNING revision`)
   .bind(number,expires,key,type,userId,wrestlerId,revision,userId,wrestlerId).first()
   :await db.prepare(`INSERT INTO wrestler_membership_cards (user_id,wrestler_id,card_number,expires_on,photo_key,photo_type,revision)
    SELECT ?,?,?,?,?,?,1 WHERE ${stillInFamily} ON CONFLICT(user_id,wrestler_id) DO NOTHING RETURNING revision`)
   .bind(userId,wrestlerId,number,expires,key,type,userId,wrestlerId).first();
 }catch(error){await deleteUsaCardPhoto(key);throw error}
 if(!saved){await deleteUsaCardPhoto(key);return reply({error:'The card or family profile changed. Reload before uploading.'},409)}
 if(old)await deleteUsaCardPhoto(old.photo_key);
 return reply({ok:true});
}
