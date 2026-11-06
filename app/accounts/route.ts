import { env } from 'cloudflare:workers';
import { ownerIdentity } from '../../lib/account-auth';
import { when } from '../../lib/datetime';
export const dynamic='force-dynamic';
const escape=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export async function GET(request:Request){
 const auth=await ownerIdentity(request);if(!auth.owner)return new Response('Sign in as the owner and enter your authenticator code to see family accounts.',{status:403,headers:auth.headers});
 const result=await env.DB!.prepare('SELECT email,payload,updated_at FROM family_accounts ORDER BY updated_at DESC LIMIT 500').all<{email:string;payload:string;updated_at:string}>();
 const rows=result.results.map(row=>{const family=JSON.parse(row.payload);return `<article><h2>${escape(family.parentName||row.email)}</h2><p>${escape(row.email)}${family.phone?' · '+escape(family.phone):''}</p><p>${(family.wrestlers??[]).map((w:{name:string;grade:string})=>escape(w.name)+' · '+(w.grade==='Adult'?'Adult':'Grade '+escape(w.grade))).join('<br>')||'No wrestlers added yet.'}</p><small>Profile last saved ${escape(when(row.updated_at))}</small></article>`}).join('');
 auth.headers.set('Content-Type','text/html; charset=utf-8');
 return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Family accounts | Savage</title><style>body{font:15px Arial;line-height:1.6;color:#18191c;background:#f5f5f6;margin:0}main{max-width:850px;margin:auto;padding:24px}article{background:white;border:1px solid #ddd;padding:20px;border-radius:10px;margin:18px 0}a{color:#b12c38}small{color:#5f626b}</style><link rel="stylesheet" href="/responsive.css"></head><body><main><a href="/">← Owner workspace</a><h1>Family accounts</h1><p><a href="/approvals">SWA Advance approvals & conversations →</a></p><p><a href="/account-setup">Account setup &amp; email links</a></p><p>Every family that has created an account, newest changes first. These are real families, not the sample families in the workspace. Passwords are never shown.</p>${rows||'<article>No family has created an account yet.</article>'}</main></body></html>`,{headers:auth.headers});
}
