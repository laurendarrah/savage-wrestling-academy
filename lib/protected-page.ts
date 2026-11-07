import {ownerIdentity,strongAccount} from './account-auth';
import {accountRole,coachAccess} from './access-control';
import {markOwnerShell} from './owner-shell';
export async function ownerPage(request:Request,html:string){const auth=await ownerIdentity(request);if(!auth.owner){auth.headers.set('Location',auth.mfaRequired?'/security':'/login');return new Response(null,{status:303,headers:auth.headers})}auth.headers.set('Content-Type','text/html; charset=utf-8');markOwnerShell(auth.headers);return new Response(html,{headers:auth.headers})}
// Coach pages: coaches, and the owner once they have added themselves as a coach (issue #190). An owner who has not
// is sent to Coaches to do that. With ownerShell, the owner sees the page inside the owner shell (issue #261).
export async function coachPage(request:Request,html:string,opts:{ownerWithoutCoach?:boolean,ownerShell?:boolean}={}){
 const auth=await strongAccount(request),access=await accountRole(auth.user);
 const go=(to:string)=>{auth.headers.set('Location',to);return new Response(null,{status:303,headers:auth.headers})};
 if(access.role!=='coach'&&access.role!=='owner')return new Response('Coach access required.',{status:403,headers:auth.headers});
 if(!auth.strong)return go('/security');
 if(access.role==='owner'&&!opts.ownerWithoutCoach&&!(await coachAccess(auth.user,auth.strong)))return go('/staff#self');
 auth.headers.set('Content-Type','text/html; charset=utf-8');if(opts.ownerShell&&access.role==='owner')markOwnerShell(auth.headers);return new Response(html,{headers:auth.headers});
}
// Signed-in family pages (the waiver and the Parent Consent Form): a confirmed account, and the authenticator code when
// the family has turned one on.
export async function familyPage(request:Request,html:string){
 const auth=await strongAccount(request),go=(to:string)=>{auth.headers.set('Location',to);return new Response(null,{status:303,headers:auth.headers})};
 if(!auth.user?.email_confirmed_at)return go('/login');
 if(auth.user.factors?.some(f=>f.status==='verified')&&!auth.strong)return go('/security');
 auth.headers.set('Content-Type','text/html; charset=utf-8');return new Response(html,{headers:auth.headers});
}
// The shared signing and owner document pages open on the waiver's wording; the other documents' routes swap in their
// own title and heading before sending, so the page never flashes the wrong name (issue #195).
export function retitle(html:string,from:string,to:string){return html.replace('<title>'+from+' |','<title>'+to+' |').replace('>'+from+'</h1>','>'+to+'</h1>')}
