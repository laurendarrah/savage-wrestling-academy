import html from './screen.html?raw';import {ownerPage} from '../../lib/protected-page';export const dynamic='force-dynamic';export async function GET(request:Request){return ownerPage(request,html)}
