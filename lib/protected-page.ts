import {ownerIdentity,strongAccount} from './account-auth';
import {accountRole,coachAccess} from './access-control';
export async function ownerPage(request:Request,html:string){const auth=await ownerIdentity(request);if(!auth.owner){auth.headers.set('Location',auth.mfaRequired?'/security':'/login');return new Response(null,{status:303,headers:auth.headers})}auth.headers.set('Content-Type','text/html; charset=utf-8');return new Response(html,{headers:auth.headers})}
// Coach pages: coaches, and the owner once they have added themselves as a coach (issue #190). An owner who has not
// is sent to Coaches to do that.
export async function coachPage(request:Request,html:string,opts:{ownerWithoutCoach?:boolean}={}){
 const auth=await strongAccount(request),access=await accountRole(auth.user);
 const go=(to:string)=>{auth.headers.set('Location',to);return new Response(null,{status:303,headers:auth.headers})};
 if(access.role!=='coach'&&access.role!=='owner')return new Response('Coach access required.',{status:403,headers:auth.headers});
 if(!auth.strong)return go('/security');
 if(access.role==='owner'&&!opts.ownerWithoutCoach&&!(await coachAccess(auth.user,auth.strong)))return go('/staff#self');
 auth.headers.set('Content-Type','text/html; charset=utf-8');return new Response(html,{headers:auth.headers});
}
