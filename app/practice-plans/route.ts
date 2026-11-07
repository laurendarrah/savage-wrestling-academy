import html from './screen.html?raw';
import {strongAccount} from '../../lib/account-auth';
import {accountRole} from '../../lib/access-control';
import {markOwnerShell} from '../../lib/owner-shell';
export const dynamic='force-dynamic';
export async function GET(request:Request){const auth=await strongAccount(request),access=await accountRole(auth.user);if(!['owner','coach'].includes(access.role))return new Response('Owner or coach access required.',{status:403,headers:auth.headers});if(!auth.strong){auth.headers.set('Location','/security');return new Response(null,{status:303,headers:auth.headers})}if(access.role==='owner'){const url=new URL(request.url);if(!url.searchParams.get('date')||!url.searchParams.get('program')){auth.headers.set('Location','/#practice-calendar');return new Response(null,{status:303,headers:auth.headers})}markOwnerShell(auth.headers)}auth.headers.set('Content-Type','text/html; charset=utf-8');return new Response(html,{headers:auth.headers})}
