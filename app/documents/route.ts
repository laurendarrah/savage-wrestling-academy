import html from './screen.html?raw';import {ownerToolPage} from '../../lib/owner-workspace';export const dynamic='force-dynamic';export function GET(r:Request){return ownerToolPage(r,html)}
