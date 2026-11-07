import html from './screen.html?raw';
import {familyPage} from '../../lib/protected-page';
export const dynamic='force-dynamic';
export async function GET(request:Request){return familyPage(request,html)}
