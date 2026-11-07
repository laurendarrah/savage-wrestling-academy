import html from './screen.html?raw';
import {ownerPage} from '../../lib/protected-page';
export const dynamic = 'force-dynamic';
// Owner review of coach hours and time off (issue #193).
export async function GET(request: Request) { return ownerPage(request, html); }
