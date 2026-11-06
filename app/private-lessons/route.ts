import html from './screen.html?raw';
import {GET as bookingPage} from '../booking/route';
import {familyToolPanel} from '../../lib/family-workspace';

export const dynamic='force-dynamic';
export async function GET(request:Request){
 return familyToolPanel(request,html,await bookingPage(request));
}
