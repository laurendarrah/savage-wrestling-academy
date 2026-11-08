import { env } from 'cloudflare:workers';
// Options (issue #202): windowMinutes counts over a longer window than one minute (60 for "per hour"); ipLimit sets a
// different limit for the shared address counter, or null to count only the account. hourly (issue #274) adds a second
// account counter over an hour, so a principal that keeps hitting the minute limit waits longer instead of only a minute.
export type RateOptions={windowMinutes?:number;ipLimit?:number|null;hourly?:number};
type Counter={source:string;max:number;window:number};

const digest=async(text:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(b=>b.toString(16).padStart(2,'0')).join('');
// A longer window is stored as the minute it started (and keyed apart from one-minute counters), so the cleanup below,
// which goes by minute, removes it only after the window has ended.
const bucketOf=(minute:number,window:number)=>Math.floor(minute/window)*window;

// Every counter is read and bumped in one D1 batch (one round trip, issue #274) instead of one query per counter.
export async function rateLimited(request:Request,principal:string,limit=10,options:RateOptions={}){
 const minute=Math.floor(Date.now()/60000),window=Math.max(1,Math.floor(options.windowMinutes??1)),ip=request.headers.get('cf-connecting-ip')??'unknown';
 // Limits follow both the originating address and the target account. The address counter is kept per feature
 // (the part of the key before ':'), so families sharing a network (academy WiFi, a phone carrier) cannot lock each
 // other out of unrelated features (issue #114). Keys without a feature prefix share one 'auth' counter.
 const feature=principal.includes(':')?principal.slice(0,principal.indexOf(':')):'auth';
 const counters:Counter[]=[];
 if(options.ipLimit!==null)counters.push({source:'ip:'+feature+':'+ip,max:options.ipLimit??limit,window});
 counters.push({source:'account:'+principal,max:limit,window});
 if(options.hourly)counters.push({source:'account:'+principal,max:options.hourly,window:60});
 const statements=[];
 for(const c of counters){
  const bucket=bucketOf(minute,c.window),hash=await digest(c.source+(c.window>1?':w'+c.window:''));
  statements.push(env.DB!.prepare('INSERT INTO auth_attempts (id,count,bucket) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1 RETURNING count').bind(bucket+':'+hash,bucket));
 }
 const longest=Math.max(...counters.map(c=>c.window));
 statements.push(env.DB!.prepare('DELETE FROM auth_attempts WHERE bucket < ?').bind(minute-59-longest));
 const results=await env.DB!.batch<{count:number}>(statements);
 return counters.some((c,i)=>Number(results[i]?.results?.[0]?.count??100)>c.max);
}
