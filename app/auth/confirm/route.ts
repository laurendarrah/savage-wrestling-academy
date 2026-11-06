import { accountClient } from '../../../lib/account-auth';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const url=new URL(request.url),auth=accountClient(request);
 const code=url.searchParams.get('code'),hash=url.searchParams.get('token_hash'),type=url.searchParams.get('type');
 let valid=false;
 if(code){const {error}=await auth.client.auth.exchangeCodeForSession(code);valid=!error}
 else if(hash&&(type==='email'||type==='signup'||type==='recovery')){const {error}=await auth.client.auth.verifyOtp({token_hash:hash,type});valid=!error}
 const requested=url.searchParams.get('next');
 const path=valid?(requested==='change'||type==='recovery'?'/login?mode=change'+(url.searchParams.get('coach')==='1'?'&coach=1':''):requested==='coach'?'/login?confirmed=1&coach=1':'/login?confirmed=1'):'/login?confirmation=failed';
 auth.headers.set('Location',new URL(path,url.origin).href);
 return new Response(null,{status:303,headers:auth.headers});
}
