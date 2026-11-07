// The owner's coach contract page (issue #195): the waivers page for coach contracts, listing every coach.
import html from '../waivers/screen.html?raw';
import {ownerPage, retitle} from '../../lib/protected-page';
export const dynamic = 'force-dynamic';
const page = retitle(html, 'Waivers', 'Coach contracts');
export async function GET(request: Request) { return ownerPage(request, page); }
