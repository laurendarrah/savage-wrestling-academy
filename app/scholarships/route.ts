import html from './screen.html?raw';
import {ownerToolPage} from '../../lib/owner-workspace';
export const dynamic='force-dynamic';
export async function GET(request:Request){return ownerToolPage(request,html)}
