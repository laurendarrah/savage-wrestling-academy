import html from './screen.html?raw';import {coachPage} from '../../lib/protected-page';import {COACH_CARD_CSS,fill} from '../../lib/website';export const dynamic='force-dynamic';
// A coach edits their own profile; the owner edits any coach's (?email=) or their own (issue #190). The preview uses the
// team page's coach card styles (issue #223).
const page=fill(html,{coachcss:COACH_CARD_CSS});
export async function GET(request:Request){return coachPage(request,page,{ownerWithoutCoach:true})}
