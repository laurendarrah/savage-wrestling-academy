import { env } from 'cloudflare:workers';
import type { User } from '@supabase/supabase-js';
import { verifiedOwner, OWNER_EMAIL } from './account-auth';
export type StaffAccess={email:string;name:string;programs:string[]};
export async function accountRole(user:User|null):Promise<{role:'owner'|'coach'|'family'|'anonymous';staff:StaffAccess|null}>{
 if(!user?.email_confirmed_at)return {role:'anonymous',staff:null};
 if(verifiedOwner(user))return {role:'owner',staff:null};
 const staff=await env.DB!.prepare('SELECT email,name,programs FROM staff_access WHERE email=? AND active=1').bind(user.email!.toLowerCase()).first<{email:string;name:string;programs:string}>();
 return staff?{role:'coach',staff:{...staff,programs:JSON.parse(staff.programs)}}:{role:'family',staff:null};
}
export const roleDestination=(role:string)=>role==='owner'?'/':role==='coach'?'/coach':'/family';
// Who may use Coach view (issue #190): a coach with a verified authenticator, or the owner once they have added
// themselves as a coach on /staff. The owner keeps the owner role everywhere else; this only opens the coach tools,
// and only with the same checks as the owner dashboard (confirmed owner email, authenticator code this session).
export async function coachAccess(user:User|null,strong:boolean):Promise<(StaffAccess&{owner:boolean})|null>{
 if(!strong)return null;
 const {role,staff}=await accountRole(user);
 if(role==='coach')return {...staff!,owner:false};
 if(role!=='owner')return null;
 const own=await env.DB!.prepare('SELECT email,name,programs FROM staff_access WHERE email=? AND active=1').bind(OWNER_EMAIL).first<{email:string;name:string;programs:string}>();
 return own?{...own,programs:JSON.parse(own.programs),owner:true}:null;
}
