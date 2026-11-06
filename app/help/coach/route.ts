import html from './screen.html?raw';
import {coachPage} from '../../../lib/protected-page';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return coachPage(request, html); }
