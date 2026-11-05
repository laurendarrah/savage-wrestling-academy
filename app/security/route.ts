import html from './screen.html?raw';
import {verifiedAccount} from '../../lib/account-auth';
export const dynamic='force-dynamic';
export async function GET(request:Request){const auth=await verifiedAccount(request);if(!auth.user?.email_confirmed_at){auth.headers.set('Location','/login');return new Response(null,{status:303,headers:auth.headers})}auth.headers.set('Content-Type','text/html; charset=utf-8');return new Response(html,{headers:auth.headers})}
