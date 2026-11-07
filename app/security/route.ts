import html from './screen.html?raw';
import {strongAccount,verifiedOwner} from '../../lib/account-auth';
import {markOwnerShell} from '../../lib/owner-shell';
export const dynamic='force-dynamic';
export async function GET(request:Request){const auth=await strongAccount(request);if(!auth.user?.email_confirmed_at){auth.headers.set('Location','/login');return new Response(null,{status:303,headers:auth.headers})}auth.headers.set('Content-Type','text/html; charset=utf-8');
 // The owner, fully signed in, sees Account security inside the owner shell (issue #261); everyone else as before.
 if(verifiedOwner(auth.user)&&auth.strong)markOwnerShell(auth.headers);return new Response(html,{headers:auth.headers})}
