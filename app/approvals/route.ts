import html from './screen.html?raw';
import {ownerIdentity} from '../../lib/account-auth';
export const dynamic='force-dynamic';
export async function GET(request:Request){const auth=await ownerIdentity(request);if(!auth.owner)return new Response('Owner sign-in and authenticator verification required.',{status:403,headers:auth.headers});auth.headers.set('Content-Type','text/html; charset=utf-8');return new Response(html,{headers:auth.headers})}
