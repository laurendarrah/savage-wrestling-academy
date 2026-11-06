import {env} from 'cloudflare:workers';
import html from './screen.html?raw';
import {ownerIdentity,strongAccount,verifiedOwner} from '../../lib/account-auth';
import {ownerEmbed,ownerToolPage,ownerWorkspaceMarkup,ownerWorkspacePanel} from '../../lib/owner-workspace';
import {programDetails,upgradeProgramNames} from '../../lib/program-names';
import {sampleFamilies,testWaiverTemplateId} from '../../lib/test-family';
export const dynamic='force-dynamic';

async function sampleFamilyPage(request:Request,slug:string){
 const auth=await ownerIdentity(request);
 if(!auth.owner){
  auth.headers.set('Location',auth.mfaRequired?'/security':'/login');
  return new Response(null,{status:303,headers:auth.headers});
 }
 const family=sampleFamilies.find(sample=>sample.slug===slug);
 if(!family)return new Response('Sample family not found.',{status:404,headers:auth.headers});
 const [consent,settings]=await env.DB!.batch([
  env.DB!.prepare(`SELECT title,body FROM document_templates WHERE id<>? AND kind='waiver' AND archived=0
   AND lower(title) LIKE '%parent%consent%' ORDER BY updated_at DESC,id LIMIT 1`).bind(testWaiverTemplateId),
  env.DB!.prepare("SELECT payload FROM academy_state WHERE id='academy'")
 ]);
 const row=settings.results[0] as {payload:string}|undefined;
 const programs=row?upgradeProgramNames(JSON.parse(row.payload))?.programs:null;
 const program=family.wrestler.program;
 const programName=(Array.isArray(programs)?programs.find((p:{id:string})=>p.id===program)?.name:null)||programDetails[program].name;
 const data=JSON.stringify({...family,programName,consent:consent.results[0]??null}).replaceAll('<','\\u003c');
 const page=html.replace('</head>',()=>`<script type="application/json" id="sampleFamilyData">${data}</script></head>`);
 auth.headers.set('Content-Type','text/html; charset=utf-8');
 return ownerWorkspacePanel(request,new Response(ownerWorkspaceMarkup(request,page),{headers:auth.headers}));
}
export async function GET(request:Request){
 const sample=new URL(request.url).searchParams.get('sample');
 if(sample!==null)return sampleFamilyPage(request,sample);
 if(ownerEmbed(request))return ownerToolPage(request,html);
 const auth=await strongAccount(request);
 if(!auth.user?.email_confirmed_at){auth.headers.set('Location','/login');return new Response(null,{status:303,headers:auth.headers})}
 if((verifiedOwner(auth.user)||auth.user.factors?.some(f=>f.status==='verified'))&&!auth.strong){auth.headers.set('Location','/security');return new Response(null,{status:303,headers:auth.headers})}
 auth.headers.set('Content-Type','text/html; charset=utf-8');
 return new Response(html,{headers:auth.headers});
}
