import html from './screen.html?raw';import {coachPage} from '../../lib/protected-page';export const dynamic='force-dynamic';
// A coach edits their own profile; the owner edits any coach's (?email=) or their own (issue #190).
export async function GET(request:Request){return coachPage(request,html,{ownerWithoutCoach:true})}
