import html from './screen.html?raw';
import { strongAccount } from '../../lib/account-auth';
export const dynamic='force-dynamic';
export async function GET(request:Request){const auth=await strongAccount(request);if(!auth.user?.email_confirmed_at){auth.headers.set('Location','/login');return new Response(null,{status:303,headers:auth.headers})}if(auth.user.factors?.some(f=>f.status==='verified')&&!auth.strong){auth.headers.set('Location','/security');return new Response(null,{status:303,headers:auth.headers})}auth.headers.set('Content-Type','text/html; charset=utf-8');return new Response(html,{headers:auth.headers})}
