import html from './screen.html?raw';
import {ownerToolPage} from '../../lib/owner-workspace';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const response=await ownerToolPage(request,html);
 response.headers.set('Permissions-Policy','camera=(self), microphone=()');
 return response;
}
