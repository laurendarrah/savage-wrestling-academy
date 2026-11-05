import {env} from 'cloudflare:workers';
import {strongAccount,verifiedOwner,accountReply,sameOrigin} from '../../../lib/account-auth';
import {rateLimited} from '../../../lib/rate-limit';
export const dynamic='force-dynamic';
async function access(request:Request,requestId:string){
 const auth=await strongAccount(request),owner=verifiedOwner(auth.user);
 if(!auth.user?.email_confirmed_at)return {...auth,owner,thread:null,error:'Sign-in required.',status:401};
 if((owner||auth.user.factors?.some(f=>f.status==='verified'))&&!auth.strong)return {...auth,owner,thread:null,error:'Authenticator verification required.',status:403};
 const thread=await env.DB!.prepare('SELECT id,user_id,wrestler_name FROM program_approvals WHERE id=?').bind(requestId).first<{id:string;user_id:string;wrestler_name:string}>();
 if(!thread||(!owner&&thread.user_id!==auth.user.id))return {...auth,owner,thread:null,error:'Conversation not found.',status:404};
 return {...auth,owner,thread,error:null,status:200};
}
export async function GET(request:Request){
 const url=new URL(request.url),id=url.searchParams.get('requestId')??'';if(!/^[a-zA-Z0-9-]{1,80}$/.test(id))return accountReply({error:'Choose an approval conversation.'},400);
 const auth=await access(request,id);if(auth.error)return accountReply({error:auth.error},auth.status,auth.headers);
 const before=url.searchParams.get('before')??'';if(before&&!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z\|[a-zA-Z0-9-]{1,80}$/.test(before))return accountReply({error:'Invalid message cursor.'},400,auth.headers);
 const [time,messageId]=before.split('|');
 const query=before?env.DB!.prepare('SELECT id,sender_role,body,created_at FROM approval_messages WHERE approval_id=? AND (created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT 101').bind(id,time,time,messageId):env.DB!.prepare('SELECT id,sender_role,body,created_at FROM approval_messages WHERE approval_id=? ORDER BY created_at DESC,id DESC LIMIT 101').bind(id);
 const result=await query.all<{id:string;sender_role:string;body:string;created_at:string}>(),more=result.results.length>100,rows=result.results.slice(0,100),oldest=rows.at(-1);
 return accountReply({wrestlerName:auth.thread!.wrestler_name,messages:rows.reverse(),next:more&&oldest?oldest.created_at+'|'+oldest.id:null},200,auth.headers);
}
export async function POST(request:Request){
 if(!sameOrigin(request))return accountReply({error:'Invalid request origin.'},403);
 if(!request.headers.get('content-type')?.includes('application/json'))return accountReply({error:'JSON required.'},415);
 const raw=await request.text();if(raw.length>10000)return accountReply({error:'Message is too long.'},413);let input;try{input=JSON.parse(raw)}catch{return accountReply({error:'Invalid request.'},400)}
 if(!input||typeof input.requestId!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(input.requestId)||typeof input.message!=='string'||!input.message.trim()||input.message.length>2000)return accountReply({error:'Enter a message of 1–2,000 characters.'},400);
 const auth=await access(request,input.requestId),reply=(body:unknown,status=200)=>accountReply(body,status,auth.headers);if(auth.error)return reply({error:auth.error},auth.status);
 if(await rateLimited(request,'approval-chat:'+auth.user!.id,30))return reply({error:'Too many messages. Wait a minute and try again.'},429);
 const id=crypto.randomUUID(),now=new Date().toISOString();
 await env.DB!.prepare('INSERT INTO approval_messages(id,approval_id,sender_id,sender_role,body,created_at) VALUES (?,?,?,?,?,?)').bind(id,auth.thread!.id,auth.user!.id,auth.owner?'owner':'parent',input.message.trim(),now).run();
 return reply({ok:true,id,createdAt:now});
}
