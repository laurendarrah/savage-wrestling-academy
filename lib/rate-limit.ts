import { env } from 'cloudflare:workers';
// Options (issue #202): windowMinutes counts over a longer window than one minute (60 for "per hour"); ipLimit sets a
// different limit for the shared address counter, or null to count only the account.
export type RateOptions={windowMinutes?:number;ipLimit?:number|null};
export async function rateLimited(request:Request,principal:string,limit=10,options:RateOptions={}){
 const minute=Math.floor(Date.now()/60000),window=Math.max(1,Math.floor(options.windowMinutes??1));
 // A longer window is stored as the minute it started (and keyed apart from one-minute counters), so the cleanup below,
 // which goes by minute, removes it only after the window has ended.
 const bucket=Math.floor(minute/window)*window,suffix=window>1?':w'+window:'',ip=request.headers.get('cf-connecting-ip')??'unknown';let blocked=false;
 // Limits follow both the originating address and the target account. The address counter is kept per feature
 // (the part of the key before ':'), so families sharing a network (academy WiFi, a phone carrier) cannot lock each
 // other out of unrelated features (issue #114). Keys without a feature prefix (sign-in) share one 'auth' counter.
 const feature=principal.includes(':')?principal.slice(0,principal.indexOf(':')):'auth';
 const counters:[string,number][]=[];
 if(options.ipLimit!==null)counters.push(['ip:'+feature+':'+ip,options.ipLimit??limit]);
 counters.push(['account:'+principal,limit]);
 for(const [source,max] of counters){
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source+suffix)))).map(b=>b.toString(16).padStart(2,'0')).join('');
 const row=await env.DB!.prepare('INSERT INTO auth_attempts (id,count,bucket) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1 RETURNING count').bind(bucket+':'+hash,bucket).first<{count:number}>();
 if((row?.count??100)>max)blocked=true;
 }
 await env.DB!.prepare('DELETE FROM auth_attempts WHERE bucket < ?').bind(minute-59-window).run();return blocked;
}
