import html from './screen.html?raw';
import { verifiedAccount } from '../../lib/account-auth';
import { acceptOpenInvite, coachWithoutFamily } from '../../lib/coach-invites';
export const dynamic='force-dynamic';
// An invited coach who lands here (an old bookmark, or signed in before the invite) gets coach access and goes to coach
// home (issue #392).
export async function GET(request:Request){const auth=await verifiedAccount(request);if(!auth.user?.email_confirmed_at){auth.headers.set('Location','/login');return new Response(null,{status:303,headers:auth.headers})}
 if(await acceptOpenInvite(auth.user).catch(()=>false)||await coachWithoutFamily(auth.user).catch(()=>false)){auth.headers.set('Location','/coach');return new Response(null,{status:303,headers:auth.headers})}
auth.headers.set('Content-Type','text/html; charset=utf-8');return new Response(html,{headers:auth.headers})}
