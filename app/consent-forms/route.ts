// The owner's Parent Consent Form page (issue #195): the waivers page for the consent form.
import html from '../waivers/screen.html?raw';
import {ownerPage, retitle} from '../../lib/protected-page';
export const dynamic = 'force-dynamic';
const page = retitle(html, 'Waivers', 'Parent Consent Form');
export async function GET(request: Request) { return ownerPage(request, page); }
