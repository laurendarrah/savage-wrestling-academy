import html from './screen.html?raw';
import {coachPage} from '../../lib/protected-page';
export const dynamic = 'force-dynamic';
// A coach's hours and time off (issue #193).
export async function GET(request: Request) { return coachPage(request, html); }
