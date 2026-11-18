import {ownerIdentity,verifiedAccount,isSignInUnavailable,securityHeaders} from './account-auth';
import {accountRole,coachAccess} from './access-control';
import {markOwnerShell} from './owner-shell';
// Supabase could not be reached (issue #274): the page says so with a 503, which the Worker records, instead of sending
// the person to sign in again as if they had been signed out.
export function unavailablePage(){const headers=securityHeaders();headers.set('Content-Type','text/html; charset=utf-8');headers.set('Retry-After','120');
 return new Response('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign-in unavailable | Savage Wrestling Academy</title><style>body{margin:0}main{max-width:560px;margin:auto;padding:48px 16px 64px}</style></head><body><main><h1>Sign-in is temporarily unavailable</h1><p>The sign-in service could not be reached, so this page cannot check who you are. Nothing is lost and you are not signed out. Please try again in a few minutes.</p><p><a href="/">Back to the home page</a></p></main></body></html>',{status:503,statusText:'Sign-in unavailable',headers})}
// A signed-in page opened by someone it is not for (issue #373). Signed out: the sign-in page, as on every other
// signed-in page. Signed in with another kind of account: a page in the academy's look that says who the page is for
// and gives two ways on, instead of a bare line of text. It is still a 403 and sends nothing from the page asked for.
export function toSignIn(headers:Headers){headers.set('Location','/login');return new Response(null,{status:303,headers})}
export function wrongAccountPage(headers:Headers,forWhom:'coaches'|'coaches and the owner'){headers.set('Content-Type','text/html; charset=utf-8');
 return new Response('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Not your page | Savage Wrestling Academy</title><style>body{margin:0}main{max-width:560px;margin:auto;padding:48px 16px 64px}.ways{display:flex;flex-wrap:wrap;gap:12px;margin-top:24px}.ways a{display:inline-flex;align-items:center;justify-content:center;padding:0 20px;text-decoration:none}</style></head><body><main><h1>This page is for '+forWhom+'</h1><p>The account you are signed in with can’t open it.</p><p class="next">If you coach at the academy, sign out, then sign in with the email address your invite was sent to.</p><p class="ways"><a class="button primary" href="/">Go to the home page</a><a class="button" href="/security">See who is signed in</a></p></main></body></html>',{status:403,statusText:'Forbidden',headers})}
const guarded=<T>(fn:()=>Promise<T>):Promise<T|Response>=>fn().catch(e=>{if(isSignInUnavailable(e))return unavailablePage();throw e});
export const ownerPage=(request:Request,html:string)=>guarded(()=>ownerPageChecked(request,html));
async function ownerPageChecked(request:Request,html:string){const auth=await ownerIdentity(request);if(!auth.owner){auth.headers.set('Location','/login');return new Response(null,{status:303,headers:auth.headers})}auth.headers.set('Content-Type','text/html; charset=utf-8');markOwnerShell(auth.headers);return new Response(html,{headers:auth.headers})}
// Coach pages: coaches, and the owner once they have added themselves as a coach (issue #190). An owner who has not
// is sent to Coaches to do that. With ownerShell, the owner sees the page inside the owner shell (issue #261).
export const coachPage=(request:Request,html:string,opts:{ownerWithoutCoach?:boolean,ownerShell?:boolean}={})=>guarded(()=>coachPageChecked(request,html,opts));
async function coachPageChecked(request:Request,html:string,opts:{ownerWithoutCoach?:boolean,ownerShell?:boolean}={}){
 const auth=await verifiedAccount(request),access=await accountRole(auth.user);
 const go=(to:string)=>{auth.headers.set('Location',to);return new Response(null,{status:303,headers:auth.headers})};
 if(access.role!=='coach'&&access.role!=='owner')return auth.user?wrongAccountPage(auth.headers,'coaches'):toSignIn(auth.headers);
 if(access.role==='owner'&&!opts.ownerWithoutCoach&&!(await coachAccess(auth.user)))return go('/staff#self');
 auth.headers.set('Content-Type','text/html; charset=utf-8');if(opts.ownerShell&&access.role==='owner')markOwnerShell(auth.headers);return new Response(html,{headers:auth.headers});
}
// Signed-in family pages (the waiver and the Parent Consent Form): a confirmed account.
export const familyPage=(request:Request,html:string)=>guarded(()=>familyPageChecked(request,html));
async function familyPageChecked(request:Request,html:string){
 const auth=await verifiedAccount(request),go=(to:string)=>{auth.headers.set('Location',to);return new Response(null,{status:303,headers:auth.headers})};
 if(!auth.user?.email_confirmed_at)return go('/login');
 auth.headers.set('Content-Type','text/html; charset=utf-8');return new Response(html,{headers:auth.headers});
}
// The shared signing and owner document pages open on the waiver's wording; the other documents' routes swap in their
// own title and heading before sending, so the page never flashes the wrong name (issue #195).
export function retitle(html:string,from:string,to:string){return html.replace('<title>'+from+' |','<title>'+to+' |').replace('>'+from+'</h1>','>'+to+'</h1>')}
