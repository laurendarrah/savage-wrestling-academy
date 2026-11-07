import { env } from 'cloudflare:workers';
import { strongAccount, accountReply, sameOrigin } from '../../../lib/account-auth';
import { validFamily, cleanFamily, emptyFamily, familyProblem, missingDetails, missingMessage } from '../../../lib/family-records';
import { cardVerification, seasonOptions } from '../../../lib/usaw';
import { checkChangedCards, familyLookup, lookupView, lookupsFor } from '../../../lib/usaw-check';
import { exceptionFor } from '../../../lib/exceptions';
import { dailyReminders, quietly } from '../../../lib/notify';
import { academyToday } from '../../../lib/public-schedule';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const auth=await strongAccount(request);if(!auth.user?.email_confirmed_at)return accountReply({error:'Sign-in required.'},401,auth.headers);
 if(auth.user.factors?.some(f=>f.status==='verified')&&!auth.strong)return accountReply({error:'Authenticator verification required.'},403,auth.headers);
 const row=await env.DB!.prepare('SELECT payload,revision,updated_at FROM family_accounts WHERE user_id=?').bind(auth.user.id).first<{payload:string;revision:number;updated_at:string}>();
 await quietly(()=>dailyReminders());
 const data=row?JSON.parse(row.payload):emptyFamily(),today=academyToday(),cards:Record<string,unknown>={};
 // USA Wrestling card status per wrestler, including the owner's review, so the family sees what blocks booking.
 // The latest automatic check on USA Wrestling (issue #202): what happened and when, never the name on the card.
 const lookups=await lookupsFor(auth.user.id);
 for(const w of data.wrestlers){const x=await exceptionFor(auth.user.id,w.id,'usaw',[today]);cards[w.id]={...await cardVerification(auth.user.id,w,today),exceptionUntil:x?.endsOn??null,lookup:familyLookup(lookupView(w,lookups.get(w.id)))}}
 // The card seasons a family can choose today (issue #131); the page offers them in the wrestler editor.
 return accountReply({email:auth.user.email,data,cards,cardSeasons:seasonOptions(today),revision:row?.revision??0,updatedAt:row?.updated_at??null},200,auth.headers);
}
export async function PUT(request:Request){
 const auth=await strongAccount(request);if(!auth.user?.email_confirmed_at)return accountReply({error:'Sign-in required.'},401,auth.headers);
 const reply=(body:unknown,status=200)=>accountReply(body,status,auth.headers);
 if(auth.user.factors?.some(f=>f.status==='verified')&&!auth.strong)return reply({error:'Authenticator verification required.'},403);
 if(!sameOrigin(request))return reply({error:'Invalid request origin.'},403);
 if(!request.headers.get('content-type')?.includes('application/json'))return reply({error:'JSON required.'},415);
 const raw=await request.text();if(raw.length>20000)return reply({error:'Profile is too large.'},413);
 let input;try{input=JSON.parse(raw)}catch{return reply({error:'Invalid JSON.'},400)}
 if(!input||!Number.isInteger(input.revision)||input.revision<0||!validFamily(input.data))return reply({error:'Check the family profile fields.'},400);
 // Contact and safety details (issue #188) are required (#197, question 14) and must make sense. Say what to add or fix.
 const missing=missingDetails(input.data);if(missing.length)return reply({error:missingMessage(missing),missing},400);
 const problem=familyProblem(input.data,academyToday());if(problem)return reply({error:problem},400);
 const scholarships=await env.DB!.prepare("SELECT wrestler_id FROM scholarship_awards WHERE user_id=? AND status='active'").bind(auth.user.id).all<{wrestler_id:string}>();
 if(scholarships.results.some(a=>!input.data.wrestlers.some((w:{id:string})=>w.id===a.wrestler_id)))return reply({error:'An active scholarship wrestler must remain in the family profile. Contact SWA before removing this wrestler.'},409);
 const clean=cleanFamily(input.data),payload=JSON.stringify(clean),now=new Date().toISOString();
 const before=await env.DB!.prepare('SELECT payload FROM family_accounts WHERE user_id=?').bind(auth.user.id).first<{payload:string}>();
 // The account ID always comes from the verified session, never the client body.
 const row=input.revision===0?
 await env.DB!.prepare('INSERT INTO family_accounts (user_id,email,payload,revision,updated_at) VALUES (?,?,?,1,?) ON CONFLICT(user_id) DO NOTHING RETURNING revision').bind(auth.user.id,auth.user.email!,payload,now).first<{revision:number}>():
 await env.DB!.prepare('UPDATE family_accounts SET payload=?,revision=revision+1,updated_at=? WHERE user_id=? AND revision=? RETURNING revision').bind(payload,now,auth.user.id,input.revision).first<{revision:number}>();
 if(!row)return reply({error:'Your profile changed on another device. Reload before saving.'},409);
 // A new or changed card number is checked on USA Wrestling's public verify page (issue #202). It never fails the save.
 let lookups:Record<string,string>={};
 try{lookups=await checkChangedCards(request,auth.user.id,before?JSON.parse(before.payload):null,clean)}catch{}
 // The saved profile as stored (trimmed, state in capitals), so the page shows exactly what was kept.
 return reply({revision:row.revision,updatedAt:now,lookups,data:clean});
}
