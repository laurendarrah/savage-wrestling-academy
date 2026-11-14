import html from './screen.html?raw';
import { verifiedAccount } from '../../lib/account-auth';
export const dynamic='force-dynamic';
// Signed-out visitors go to sign-in and come back to the same address, so an invite link (/lesson?join=…) still opens
// its group afterwards (issue #177).
export async function GET(request:Request){const auth=await verifiedAccount(request),url=new URL(request.url),next=encodeURIComponent(url.pathname+url.search);if(!auth.user?.email_confirmed_at){auth.headers.set('Location','/login?next='+next);return new Response(null,{status:303,headers:auth.headers})}auth.headers.set('Content-Type','text/html; charset=utf-8');return new Response(html,{headers:auth.headers})}
