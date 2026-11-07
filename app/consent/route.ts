// The Parent Consent Form (issue #195): the same signing page as the waiver, for a parent or guardian to sign for each
// wrestler. Nothing is asked until the owner publishes the form.
import html from '../waiver/screen.html?raw';
import {familyPage, retitle} from '../../lib/protected-page';
export const dynamic='force-dynamic';
const page=retitle(html,'Waiver','Parent Consent Form');
export async function GET(request:Request){return familyPage(request,page)}
