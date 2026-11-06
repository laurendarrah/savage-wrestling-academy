import { env } from 'cloudflare:workers';
export async function rateLimited(request:Request,principal:string,limit=10){
 const bucket=Math.floor(Date.now()/60000),ip=request.headers.get('cf-connecting-ip')??'unknown';let blocked=false;
 // Limits follow both the originating address and the target account. The address counter is kept per feature
 // (the part of the key before ':'), so families sharing a network (academy WiFi, a phone carrier) cannot lock each
 // other out of unrelated features (issue #114). Keys without a feature prefix (sign-in) share one 'auth' counter.
 const feature=principal.includes(':')?principal.slice(0,principal.indexOf(':')):'auth';
 for(const source of ['ip:'+feature+':'+ip,'account:'+principal]){
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source)))).map(b=>b.toString(16).padStart(2,'0')).join('');
 const row=await env.DB!.prepare('INSERT INTO auth_attempts (id,count,bucket) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1 RETURNING count').bind(bucket+':'+hash,bucket).first<{count:number}>();
 if((row?.count??100)>limit)blocked=true;
 }
 await env.DB!.prepare('DELETE FROM auth_attempts WHERE bucket < ?').bind(bucket-60).run();return blocked;
}
