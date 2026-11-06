import {ownerIdentity,strongAccount} from './account-auth';
import {accountRole} from './access-control';
export async function ownerPage(request:Request,html:string){const auth=await ownerIdentity(request);if(!auth.owner){auth.headers.set('Location',auth.mfaRequired?'/security':'/login');return new Response(null,{status:303,headers:auth.headers})}auth.headers.set('Content-Type','text/html; charset=utf-8');return new Response(html,{headers:auth.headers})}
export async function coachPage(request:Request,html:string){const auth=await strongAccount(request),access=await accountRole(auth.user);if(!auth.user){auth.headers.set('Location','/coach-join');return new Response(null,{status:303,headers:auth.headers})}if(access.role!=='coach'&&access.role!=='owner')return new Response('Coach access required.',{status:403,headers:auth.headers});if(!auth.strong){auth.headers.set('Location','/security');return new Response(null,{status:303,headers:auth.headers})}auth.headers.set('Content-Type','text/html; charset=utf-8');return new Response(html,{headers:auth.headers})}

export function allowSameOriginPanel(headers:Headers){
 headers.set('X-Frame-Options','SAMEORIGIN');
 const policy=headers.get('Content-Security-Policy')??'';
 headers.set('Content-Security-Policy',policy.replace("frame-ancestors 'none'","frame-ancestors 'self'"));
}
