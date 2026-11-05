import { env } from 'cloudflare:workers';
import { ownerIdentity } from '../../lib/account-auth';
export const dynamic='force-dynamic';
const escape=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export async function GET(request:Request){
 const auth=await ownerIdentity(request);if(!auth.owner)return new Response('Owner access required.',{status:403,headers:auth.headers});
 const result=await env.DB!.prepare('SELECT email,payload,updated_at FROM family_accounts ORDER BY updated_at DESC LIMIT 500').all<{email:string;payload:string;updated_at:string}>();
 const rows=result.results.map(row=>{const family=JSON.parse(row.payload);return `<article><h2>${escape(family.parentName||row.email)}</h2><p>${escape(row.email)} · ${escape(family.phone)}</p><p>${family.wrestlers.map((w:{name:string;grade:string})=>escape(w.name)+' · Grade '+escape(w.grade)).join('<br>')||'No wrestlers added.'}</p><small>Profile saved: ${escape(row.updated_at)}</small></article>`}).join('');
 auth.headers.set('Content-Type','text/html; charset=utf-8');
 return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Family accounts | Savage</title><style>body{font:15px Arial;line-height:1.6;color:#18191c;background:#f5f5f6;margin:0}main{max-width:850px;margin:auto;padding:24px}article{background:white;border:1px solid #ddd;padding:20px;border-radius:10px;margin:18px 0}a{color:#b12c38}small{color:#777}</style><link rel="stylesheet" href="/responsive.css"></head><body><main><a href="/">← Owner workspace</a><h1>Online family profiles</h1><p><a href="/approvals">SWA Advance approvals & conversations →</a></p><p><a href="/account-setup">Account setup & email links</a> · <a href="/login">Try email sign-in</a></p><p>Real account profiles saved online, separate from the sample family directory. No passwords are displayed here.</p>${rows||'<article>No family profiles have been saved yet.</article>'}</main></body></html>`,{headers:auth.headers});
}
