import html from './screen.html?raw';
import {coachPage} from '../../lib/protected-page';
import {ownerEmbed,ownerToolPage} from '../../lib/owner-workspace';

export const dynamic='force-dynamic';
export function GET(request:Request){
 return ownerEmbed(request)?ownerToolPage(request,html):coachPage(request,html);
}
