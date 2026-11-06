import html from './screen.html?raw';
import {ownerToolPage} from '../../lib/owner-workspace';
import {coachToolPage} from '../../lib/coach-workspace';

export const dynamic='force-dynamic';
export function GET(request:Request){
 return new URL(request.url).searchParams.get('review')==='1'?ownerToolPage(request,html):coachToolPage(request,html);
}
