// A coach's own contract (issue #195): the same signing page as the waiver, signed by the coach for themselves.
import html from '../waiver/screen.html?raw';
import {coachPage, retitle} from '../../lib/protected-page';
export const dynamic='force-dynamic';
const page=retitle(html,'Waiver','Coach contract');
export async function GET(request:Request){return coachPage(request,page)}
