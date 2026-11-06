import html from "./portal.html?raw";
import { ownerIdentity } from '../lib/account-auth';
import { accountRole } from '../lib/access-control';
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
 const auth=await ownerIdentity(request);
 // "/" is everyone's home: the owner's dashboard here; coaches, families and visitors go to their own (issue #129).
 if(!auth.owner){const role=auth.user&&!auth.mfaRequired?(await accountRole(auth.user)).role:null;auth.headers.set('Location',auth.mfaRequired?'/security':role==='coach'?'/coach':auth.user?'/family':'/login');return new Response(null,{status:303,headers:auth.headers})}
 auth.headers.set('Content-Type','text/html; charset=utf-8');
 return new Response(html,{headers:auth.headers});
}
