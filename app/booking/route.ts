import html from './screen.html?raw';
import {strongAccount} from '../../lib/account-auth';
export const dynamic='force-dynamic';
export async function GET(request:Request){const auth=await strongAccount(request),url=new URL(request.url),next=encodeURIComponent(url.pathname+url.search);let redirect='';if(!auth.user?.email_confirmed_at)redirect='/login?next='+next;else if(auth.user.factors?.some(f=>f.status==='verified')&&!auth.strong)redirect='/security?next='+next;if(redirect){auth.headers.set('Location',redirect);return new Response(null,{status:303,headers:auth.headers})}auth.headers.set('Content-Type','text/html; charset=utf-8');return new Response(html,{headers:auth.headers})}
