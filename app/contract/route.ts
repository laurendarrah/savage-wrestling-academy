// A coach's own contract (issue #195): the same signing page as the waiver, signed by the coach for themselves.
import html from '../waiver/screen.html?raw';
import {coachPage, retitle} from '../../lib/protected-page';
export const dynamic='force-dynamic';
// A coach opens this from coach home, so it starts with the way back, like the other coach pages.
const BACK='<a class="swa-back" href="/coach">← Coach home</a>';
const page=retitle(html,'Waiver','Coach contract').replace('<main><h1 id="title">','<main>'+BACK+'<h1 id="title">');
export async function GET(request:Request){return coachPage(request,page)}
