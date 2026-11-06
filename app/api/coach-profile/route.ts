import {env} from 'cloudflare:workers';
import {strongAccount,verifiedOwner,accountReply,sameOrigin} from '../../../lib/account-auth';
import {accountRole} from '../../../lib/access-control';
import {cleanCoachProfile,emptyCoachProfile,boundedBody} from '../../../lib/coach-profile';
import {securityEvent} from '../../../lib/security-events';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const auth=await strongAccount(request),access=await accountRole(auth.user),reply=(b:unknown,s=200)=>accountReply(b,s,auth.headers);
 if(!auth.strong||(access.role!=='coach'&&!verifiedOwner(auth.user)))return reply({error:'Coach or owner access and authenticator verification required.'},403);
 const email=verifiedOwner(auth.user)?(new URL(request.url).searchParams.get('email')?.toLowerCase()||auth.user!.email!.toLowerCase()):auth.user!.email!.toLowerCase();
 if(!email)return reply({error:'Choose a coach.'},400);
 const staff=await env.DB!.prepare('SELECT name,active FROM staff_access WHERE email=?').bind(email).first<{name:string;active:number}>();
 const ownOwner=verifiedOwner(auth.user)&&email===auth.user!.email!.toLowerCase();
 if(!staff&&!ownOwner)return reply({error:'Coach not found.'},404);
 const row=await env.DB!.prepare('SELECT payload,revision,photo_key,updated_at FROM coach_profiles WHERE email=?').bind(email).first<{payload:string;revision:number;photo_key:string|null;updated_at:string}>();
 return reply({email,data:row?JSON.parse(row.payload):emptyCoachProfile(staff?.name||''),revision:row?.revision??0,hasPhoto:!!row?.photo_key,updatedAt:row?.updated_at??null,active:ownOwner||staff?.active===1,owner:ownOwner});
}
export async function PUT(request:Request){
 const auth=await strongAccount(request),access=await accountRole(auth.user),reply=(b:unknown,s=200)=>accountReply(b,s,auth.headers);
 if((access.role!=='coach'&&access.role!=='owner')||!auth.strong)return reply({error:'Coach access and authenticator verification required.'},403);
 if(!sameOrigin(request))return reply({error:'Invalid request origin.'},403);
 if(!request.headers.get('content-type')?.includes('application/json'))return reply({error:'JSON required.'},415);
 const bytes=await boundedBody(request,16000);if(!bytes)return reply({error:'Profile too large.'},413);
 let input;try{input=JSON.parse(new TextDecoder().decode(bytes))}catch{return reply({error:'Invalid request.'},400)}
 const data=cleanCoachProfile(input?.data);if(!data||!Number.isSafeInteger(input.revision)||input.revision<0)return reply({error:'Enter your name and bio, and keep each field within its limit.'},400);
 const email=auth.user!.email!.toLowerCase(),now=new Date().toISOString();
 const allowed='(? OR EXISTS (SELECT 1 FROM staff_access WHERE email=? AND active=1))';
 const scope=[access.role==='owner'?1:0,email] as const;
 const row=input.revision===0
 ?await env.DB!.prepare(`INSERT INTO coach_profiles(email,user_id,payload,revision,updated_at) SELECT ?,?,?,1,? WHERE NOT EXISTS (SELECT 1 FROM coach_profiles WHERE email=?) AND ${allowed} RETURNING revision`).bind(email,auth.user!.id,JSON.stringify(data),now,email,...scope).first<{revision:number}>()
 :await env.DB!.prepare(`UPDATE coach_profiles SET payload=?,user_id=?,revision=revision+1,updated_at=? WHERE email=? AND revision=? AND ${allowed} RETURNING revision`).bind(JSON.stringify(data),auth.user!.id,now,email,input.revision,...scope).first<{revision:number}>();
 const revision=row?.revision;
 if(!revision)return reply({error:'This profile changed in another window. Reload before saving.'},409);
 await securityEvent(auth.user!.id,'coach_profile_saved');return reply({ok:true,revision});
}
