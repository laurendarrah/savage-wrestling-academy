import { env } from 'cloudflare:workers';
export async function securityEvent(actor:string,action:string,target=''){
 await env.DB!.prepare('INSERT INTO security_events (id,actor,action,target,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),actor,action,target,new Date().toISOString()).run();
}
