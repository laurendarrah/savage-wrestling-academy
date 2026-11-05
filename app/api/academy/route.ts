import {withFridayLive} from '../../../lib/friday-live';
import {upgradeProgramNames} from '../../../lib/program-names';
import { env } from "cloudflare:workers";
import { ownerIdentity } from "../../../lib/account-auth";
import { validState } from "../../../lib/academy-validation";
export const dynamic = "force-dynamic";

export async function GET(request:Request) {
 const auth=await ownerIdentity(request),user=auth.owner; const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:auth.headers}); if (!user) return reply({error:"Owner sign-in required."},403);
 const row = await env.DB!.prepare("SELECT payload, revision, updated_at FROM academy_state WHERE id = ?").bind("academy").first<{payload:string;revision:number;updated_at:string}>();
 return reply({data:row ? withFridayLive(upgradeProgramNames(JSON.parse(row.payload))) : null,revision:row?.revision ?? 0,updatedAt:row?.updated_at ?? null,owner:user.displayName});
}
export async function PUT(request: Request) {
 const auth=await ownerIdentity(request),user=auth.owner; const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:auth.headers}); if (!user) return reply({error:"Owner sign-in required."},403);
 if (request.headers.get("origin") !== new URL(request.url).origin) return reply({error:"Invalid request origin."},403);
 if (!request.headers.get("content-type")?.includes("application/json")) return reply({error:"JSON required."},415);
 const raw = await request.text(); if(raw.length > 1000000) return reply({error:"Record is too large."},413);
 let input; try { input=JSON.parse(raw); } catch {return reply({error:"Invalid JSON."},400);}
 if (!input || typeof input !== "object" || !Number.isInteger(input.revision) || input.revision < 0 || !validState(input.data)) return reply({error:"Invalid academy settings."},400);
 const now = new Date().toISOString(), payload = JSON.stringify(withFridayLive(upgradeProgramNames(input.data)));
 let result;
 if(input.revision === 0) {
 result = await env.DB!.prepare("INSERT INTO academy_state (id,payload,revision,updated_by,updated_at) VALUES (?,?,1,?,?) ON CONFLICT(id) DO NOTHING RETURNING revision").bind("academy",payload,user.userId,now).first<{revision:number}>();
 } else {
 result = await env.DB!.prepare("UPDATE academy_state SET payload=?,revision=revision+1,updated_by=?,updated_at=? WHERE id=? AND revision=? RETURNING revision").bind(payload,user.userId,now,"academy",input.revision).first<{revision:number}>();
 }
 if(!result) return reply({error:"Another device saved changes. Reload before editing again."},409);
 return reply({revision:result.revision,updatedAt:now});
}
