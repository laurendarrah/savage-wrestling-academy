import {strongAccount,sameOrigin,accountReply} from '../../../lib/account-auth';
import {coachAccess} from '../../../lib/access-control';
import {securityEvent} from '../../../lib/security-events';
import {coachSchedule, updateOpening, addOpenings, removeOpening, claimOpenings, MAX_WEEKS, type CoachRef} from '../../../lib/lessons';
import {profileView} from '../../../lib/coach-profile';
import {withApi} from '../../../lib/api';
export const dynamic='force-dynamic';
// Coaches, and the owner once they have added themselves as a coach (issue #190). Same authenticator rule for both.
// Adding, changing and removing openings are shared with the owner's tool for any coach (lib/lessons.ts, issue #239).
async function coach(request:Request){const auth=await strongAccount(request),staff=await coachAccess(auth.user,auth.strong);
 return {auth,staff,me:staff?{email:staff.email,name:staff.name,userId:auth.user!.id} as CoachRef:null}}
export const GET = withApi(GET_); async function GET_(request:Request){
 const {auth,staff,me}=await coach(request);if(!staff||!me)return accountReply({error:'Coach access and authenticator verification required.'},403,auth.headers);
 // Openings made before issue #70 have no coach email, and ones the owner added may not have this account yet: link both.
 await claimOpenings(me);
 const profile=await profileView(staff.email,staff.name);
 return accountReply({name:profile.displayName||staff.name,programs:staff.programs,owner:staff.owner,profileSaved:profile.saved,maxWeeks:MAX_WEEKS,openings:await coachSchedule(me,'',staff.owner)},200,auth.headers);
}
export const POST = withApi(POST_); async function POST_(request:Request){
 const {auth,staff,me}=await coach(request),reply=(b:unknown,s=200)=>accountReply(b,s,auth.headers);if(!staff||!me)return reply({error:'Coach access and authenticator verification required.'},403);
 if(!sameOrigin(request))return reply({error:'Invalid request origin.'},403);
 if(!request.headers.get('content-type')?.includes('application/json'))return reply({error:'JSON required.'},415);
 const raw=await request.text();if(raw.length>2048)return reply({error:'Request too large.'},413);let input;try{input=JSON.parse(raw)}catch{return reply({error:'Invalid request.'},400)}
 await claimOpenings(me);
 if(input?.action==='remove'&&typeof input.id==='string'){
  const r=await removeOpening(me,input.id);
  // An opening that is not this coach's is left alone without saying whose it is.
  if(r.status===404)return reply({ok:true});if(r.status!==200)return reply({error:r.error},r.status);
  await securityEvent(auth.user!.id,'coach_opening_removed');return reply({ok:true});
 }
 if(input?.action==='update'){const r=await updateOpening(me,input);if(r.status!==200)return reply({error:r.error},r.status);await securityEvent(auth.user!.id,'coach_opening_changed');return reply({ok:true})}
 if(input?.action!=='add')return reply({error:'Choose a valid date and times.'},400);
 const r=await addOpenings(me,input);if(r.status!==200)return reply({error:r.error},r.status);
 const weeks=Number(input.weeks)||1;
 await securityEvent(auth.user!.id,'coach_opening_added',weeks>1?`weekly:${r.created!.length}`:'');return reply({ok:true,created:r.created,skipped:r.skipped});
}
