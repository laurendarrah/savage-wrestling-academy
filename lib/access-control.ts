import { env } from 'cloudflare:workers';
import type { User } from '@supabase/supabase-js';
import { verifiedOwner } from './account-auth';
export type StaffAccess={email:string;name:string;programs:string[]};
export async function accountRole(user:User|null):Promise<{role:'owner'|'coach'|'family'|'anonymous';staff:StaffAccess|null}>{
 if(!user?.email_confirmed_at)return {role:'anonymous',staff:null};
 if(verifiedOwner(user))return {role:'owner',staff:null};
 const staff=await env.DB!.prepare('SELECT email,name,programs FROM staff_access WHERE email=? AND active=1').bind(user.email!.toLowerCase()).first<{email:string;name:string;programs:string}>();
 return staff?{role:'coach',staff:{...staff,programs:JSON.parse(staff.programs)}}:{role:'family',staff:null};
}
export const roleDestination=(role:string)=>role==='owner'?'/':role==='coach'?'/coach':'/family';
