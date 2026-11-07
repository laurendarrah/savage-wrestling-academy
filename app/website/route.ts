import html from './screen.html?raw';
import {ownerPage} from '../../lib/protected-page';
export const dynamic = 'force-dynamic';
// Owner only (issue #196): edit and publish the public website.
export async function GET(request: Request) { return ownerPage(request, html); }
