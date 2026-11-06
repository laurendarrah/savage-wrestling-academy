import html from './screen.html?raw';
import {strongAccount} from '../../lib/account-auth';
import {accountRole} from '../../lib/access-control';
import {allowCoachPanel,coachEmbed,coachPanelMarkup} from '../../lib/coach-workspace';

export const dynamic='force-dynamic';
export async function GET(request:Request){
 const auth=await strongAccount(request),access=await accountRole(auth.user);
 if(access.role!=='owner'&&access.role!=='coach')return new Response('Owner or coach access required.',{status:403,headers:auth.headers});
 if(!auth.strong){
  auth.headers.set('Location','/security');
  return new Response(null,{status:303,headers:auth.headers});
 }
 const embedded=coachEmbed(request);
 if(access.role==='owner'&&!embedded){
  const query=new URL(request.url).searchParams;
  if(!query.get('date')||!query.get('program')){
   auth.headers.set('Location','/#practice-calendar');
   return new Response(null,{status:303,headers:auth.headers});
  }
 }
 if(embedded)allowCoachPanel(auth.headers);
 auth.headers.set('Content-Type','text/html; charset=utf-8');
 return new Response(embedded?coachPanelMarkup(html):html,{headers:auth.headers});
}
