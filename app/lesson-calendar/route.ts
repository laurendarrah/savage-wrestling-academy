import html from './screen.html?raw';
import {ownerPage} from '../../lib/protected-page';
export const dynamic = 'force-dynamic';
// The lesson calendar (issue #390): every coach's private lesson times by month, owner only.
export async function GET(request: Request) { return ownerPage(request, html); }
