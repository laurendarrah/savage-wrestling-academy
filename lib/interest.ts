// "Tell the academy I want this" (#273). While a purchase type is closed in CHECKOUT_KINDS, a family who has reviewed a
// monthly membership on /register or a lesson time on /lesson is given one real action instead of a disabled button: a
// message to the owner, in the family's own conversation (lib/messages.ts, so it shows under Messages for both, with the
// owner's unread count), saying which wrestler, what they want and when. The owner replies there or records the payment.
//
// - The message is written here from the saved wrestler and the academy's own catalog, never from free text the browser
//   sends, so it cannot carry anything the owner did not expect.
// - One message per family, per item, per New York day: the same request again the same day is refused with a plain
//   reason, so a tapped-twice button or a page reload cannot flood the owner's inbox.
// - The contact line is the academy's address and email from the public website settings when the owner has saved them,
//   else the academy's fixed address, the one on the membership terms page.
import {env} from 'cloudflare:workers';
import {familyProfile} from './program-approval';
import {programDetails} from './program-names';
import {lessonOpening} from './lessons';
import {privateFormats, academyToday} from './public-schedule';
import {postMessage} from './messages';
import {dayTime, academyDayStart, fullDate} from './datetime';

import {academyContact, type Contact} from './website';
export {ACADEMY_ADDRESS, ACADEMY_EMAIL, academyContact, type Contact} from './website';
type Result = {status: number; error?: string; message?: string; contact?: Contact};

// The owner's message for a request, or an error. kind 'membership': the monthly membership in a program for a saved
// wrestler. kind 'lesson': a lesson at one of the coaches' open times (an inquiry without a time names only the format).
export async function interestMessage(userId: string, input: any, today = academyToday()): Promise<{message: string} | {error: string; status: number}> {
  if (!input || typeof input !== 'object' || typeof input.wrestlerId !== 'string') return {status: 400, error: 'Choose a saved wrestler.'};
  const profile = await familyProfile(userId), w = profile?.wrestlers.find(x => x.id === input.wrestlerId);
  if (!w) return {status: 404, error: 'Saved wrestler not found in your family account.'};
  const who = `${w.name} (${w.grade === 'K' ? 'kindergarten' : w.grade === 'Adult' ? 'adult' : 'grade ' + w.grade})`;
  if (input.kind === 'membership') {
    const p = programDetails[input.program as string];
    if (!p || typeof input.program !== 'string') return {status: 400, error: 'Choose a program.'};
    return {message: `Request from the website: a monthly ${p.name} membership for ${who}, asked for on ${fullDate(today)}. Please let us know how to pay and when ${w.name} can start.`};
  }
  if (input.kind === 'lesson') {
    if (input.openingId === undefined || input.openingId === null || input.openingId === '') {
      const format = privateFormats.find(f => f.id === input.format);
      if (!format) return {status: 400, error: 'Choose a lesson type.'};
      return {message: `Request from the website: a ${format.name.toLowerCase()} for ${who}, asked for on ${fullDate(today)}. Please let us know the coach, the time and how to pay.`};
    }
    // The lesson type is the open time's own: an ordinary open time is a one-on-one.
    const o = await lessonOpening(input.openingId, today);
    if (!o) return {status: 409, error: 'This lesson time is no longer available. Choose another time.'};
    const format = privateFormats.find(f => f.id === (o.format ?? 'one-on-one'))!;
    return {message: `Request from the website: a ${format.name.toLowerCase()} with ${o.coach}, ${dayTime(o.date, o.start)}, for ${who}. Please hold the spot and let us know how to pay.`};
  }
  return {status: 400, error: 'Choose a membership or a lesson.'};
}

// Sends the request as a message from the family, once per item per day.
export async function tellAcademy(userId: string, input: any, today = academyToday()): Promise<Result> {
  const made = await interestMessage(userId, input, today);
  if ('error' in made) return {status: made.status, error: made.error};
  const since = academyDayStart(today);
  const again = await env.DB!.prepare("SELECT 1 FROM family_messages WHERE user_id=? AND sender_role='family' AND body=? AND created_at>=?").bind(userId, made.message, since).first();
  if (again) return {status: 409, error: 'You already told the academy about this today. They have your message and will be in touch; you can add to it under Messages.'};
  const r = await postMessage(userId, 'family', made.message);
  if (r.status !== 200) return {status: r.status, error: r.error};
  return {status: 200, message: made.message, contact: await academyContact()};
}
