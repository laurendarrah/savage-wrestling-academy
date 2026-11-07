import html from './screen.html?raw';import {ownerPage} from '../../lib/protected-page';export const dynamic='force-dynamic';
// A coach's lesson openings, managed by the owner (issue #239). Owner only.
export async function GET(request:Request){return ownerPage(request,html)}
