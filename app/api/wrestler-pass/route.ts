import {env} from 'cloudflare:workers';
import {accountReply,sameOrigin,strongAccount} from '../../../lib/account-auth';
import {familyProfile} from '../../../lib/program-approval';

export const dynamic='force-dynamic';

export async function POST(request:Request){
 const auth=await strongAccount(request),reply=(body:unknown,status=200)=>accountReply(body,status,auth.headers);
 if(!auth.user?.email_confirmed_at)return reply({error:'Sign-in required.'},401);
 if(!sameOrigin(request)||auth.user.factors?.some(f=>f.status==='verified')&&!auth.strong)return reply({error:'Verified access required.'},403);
 const raw=await request.text();
 if(raw.length>256)return reply({error:'Request too large.'},413);
 let input;
 try{input=JSON.parse(raw)}catch{return reply({error:'Invalid request.'},400)}
 const userId=auth.user.id,profile=await familyProfile(userId);
 const wrestler=profile?.wrestlers.find(w=>w.id===input?.wrestlerId);
 if(!wrestler)return reply({error:'Save this wrestler in your family profile first.'},404);
 const db=env.DB!;
 const [,pass]=await db.batch([
  db.prepare(`INSERT INTO wrestler_passes (token,user_id,wrestler_id)
   VALUES (?,?,?) ON CONFLICT(user_id,wrestler_id) DO NOTHING`).bind(crypto.randomUUID().replaceAll('-',''),userId,wrestler.id),
  db.prepare('SELECT token FROM wrestler_passes WHERE user_id=? AND wrestler_id=?').bind(userId,wrestler.id)
 ]);
 const {token}=pass.results[0] as {token:string};
 return reply({code:'SWA1:'+token});
}
