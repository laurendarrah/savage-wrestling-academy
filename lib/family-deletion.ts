// The owner deletes a family account (issue #259), first for the test family of the launch test pass (#24,
// docs/LAUNCH_TEST_PASS.md). Family data requests (#113, lib/data-requests.ts) only record what the owner did; this is
// the deletion itself.
//
// - Refused while anything is still active (activeProblems): the owner refunds, voids or cancels it first.
// - Deleted: the family profile (parent, wrestlers, address, safety details), bookings to pay at the academy, USA
//   Wrestling card reviews and checks, entry passes, waitlist entries, booking exceptions, messages, announcement
//   receipts, notices, data requests, and their spots kept in a private group nobody else has paid for yet.
// - Kept for the books, without the family: every payment (orders, with their refunds, fees, subscriptions and Stripe
//   event ids, which name only the order). The family's account, email, wrestler and name on them become
//   "deleted-family-<id>" and "Deleted family", so Payments and Income and expenses add up exactly as before.
// - Signed waivers and Parent Consent Forms, scholarship agreements, check-ins and SWA Advance approvals: how long the
//   academy keeps these isn't decided (docs/policies/data-retention-draft.md), so they stay unchanged unless the owner
//   says this is a test account (`test`), when they are deleted too.
// - The sign-in account (email and password) is with Supabase, which the site cannot delete; the page tells the owner to
//   delete it there. Once the profile is gone, signing in with it again starts an empty family account.
//
// Everything happens in one batch, so a deletion is all or nothing. The security log gets one line with counts only.
// Restoring a backup made before the deletion brings the family back (restore re-adds missing rows); delete it again.
import {env} from 'cloudflare:workers';
import {academyToday} from './public-schedule';

export const DELETED_FAMILY = 'Deleted family';
export const deletedKey = (id: string) => 'deleted-family-' + id;
// A checkout started this recently can still be paid (lib/checkout.ts holds a session for 30 minutes).
const CHECKOUT_MINUTES = 30;

type Family = {user_id: string; email: string; payload: string};
const db = () => env.DB!;
const changes = (r: any) => Number(r?.meta?.changes ?? r?.changes ?? 0);
const one = async (sql: string, ...args: unknown[]) => !!(await db().prepare(sql).bind(...args).first());

// What the owner types to confirm: the family's name as /accounts shows it (the parent's name, else the email).
export function familyLabel(f: {email: string; payload: string}) {
  let p: any = {};
  try { p = JSON.parse(f.payload); } catch { p = {}; }
  return String(p?.parentName || '').trim() || f.email;
}
const squash = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
export const confirmMatches = (typed: unknown, label: string) => !!squash(label) && squash(typed) === squash(label);

// Anything still going on for this family, in plain words. Empty when the account can be deleted.
export async function activeProblems(userId: string, today = academyToday(), now = new Date()) {
  const since = new Date(now.getTime() - CHECKOUT_MINUTES * 60000).toISOString();
  const problems: string[] = [];
  if (await one(`SELECT 1 FROM orders WHERE user_id=? AND status='paid' AND kind IN ('annual','monthly') AND term_end>=?`, userId, today)
    || await one(`SELECT 1 FROM subscriptions s JOIN orders o ON o.id=s.order_id WHERE o.user_id=? AND s.status IN ('active','past_due')`, userId))
    problems.push('a membership that is still running (cancel it in Stripe, or void it on Payments if it was paid at the academy)');
  if (await one(`SELECT 1 FROM orders o WHERE o.user_id=? AND o.status='paid' AND o.kind NOT IN ('annual','monthly') AND EXISTS (SELECT 1 FROM json_each(o.dates) d WHERE d.value>=?)`, userId, today))
    problems.push('a paid session that hasn\'t happened yet (refund it in Stripe, or void it on Payments if it was paid at the academy)');
  if (await one(`SELECT 1 FROM orders WHERE user_id=? AND status='pending' AND created_at>=?`, userId, since))
    problems.push(`a card payment in progress (try again in ${CHECKOUT_MINUTES} minutes)`);
  if (await one(`SELECT 1 FROM cash_bookings WHERE user_id=? AND status='due' AND session_date>=?`, userId, today))
    problems.push('a booking to pay at the academy that is still to come (cancel it on Payments)');
  if (await one(`SELECT 1 FROM scholarship_awards WHERE user_id=? AND status='active'`, userId))
    problems.push('an active scholarship (end it on Scholarships)');
  if (await one(`SELECT 1 FROM program_approvals WHERE user_id=? AND status='pending'`, userId))
    problems.push('an SWA Advance request waiting for a decision (decide it on SWA Advance approvals)');
  return problems;
}

type Step = {table: string; kind: 'deleted' | 'kept'; sql: string; args: unknown[]};
const del = (table: string, where: string, args: unknown[]): Step => ({table, kind: 'deleted', sql: `DELETE FROM ${table} WHERE ${where}`, args});
const keep = (table: string, change: string, args: unknown[], where: string, whereArgs: unknown[]): Step =>
  ({table, kind: 'kept', sql: `UPDATE ${table} SET ${change} WHERE ${where}`, args: [...args, ...whereArgs]});

// Every statement, in order. Rows that point at other rows (refund requests, approval messages, open groups) go first.
function steps(u: string, key: string, email: string, test: boolean, today: string): Step[] {
  const list: Step[] = [
    // Payments stay exactly as paid, for the books, under the deleted-family key. The dedupe key names the account.
    keep('orders', 'user_id=?,email=\'\',wrestler_id=?,wrestler_name=?,dedupe_key=replace(dedupe_key,?,?)', [key, key, DELETED_FAMILY, u, key], 'user_id=?', [u]),
    // A private group the family asked for that nobody has paid for and hasn't happened yet opens again for everyone,
    // as when the family calls it off (lib/lessons.ts cancelGroup). Any other group they organised stays, without them.
    keep('coach_openings', 'format=NULL,capacity=NULL,closed=0,invite_code=NULL,organizer_id=NULL,organizer_wrestlers=NULL',
      [], `organizer_id=? AND closed=1 AND date>=? AND NOT EXISTS (SELECT 1 FROM orders x WHERE x.kind='lesson' AND x.item_id=coach_openings.id AND x.status IN ('paid','pending'))`, [u, today]),
    keep('coach_openings', 'organizer_id=?,organizer_wrestlers=\'[]\'', [key], 'organizer_id=?', [u]),
    del('cash_bookings', 'user_id=?', [u]),
    del('usaw_reviews', 'user_id=?', [u]),
    del('usaw_lookups', 'user_id=?', [u]),
    del('wrestler_passes', 'user_id=?', [u]),
    del('waitlist_entries', 'user_id=?', [u]),
    del('booking_exceptions', 'user_id=?', [u]),
    del('family_messages', 'user_id=?', [u]),
    del('announcement_recipients', 'user_id=?', [u]),
    del('notifications', 'user_id=?', [u]),
    del('data_requests', 'user_id=?', [u]),
  ];
  if (test) list.push(
    del('signature_reissues', 'signature_id IN (SELECT id FROM waiver_signatures WHERE user_id=?)', [u]),
    del('waiver_signatures', 'user_id=?', [u]),
    // An offer still waiting for the family to accept is addressed to their email, not their account.
    del('scholarship_awards', 'user_id=? OR (user_id IS NULL AND lower(recipient_email)=?)', [u, email.toLowerCase()]),
    del('attendance', 'user_id=?', [u]),
    del('approval_messages', 'approval_id IN (SELECT id FROM program_approvals WHERE user_id=?)', [u]),
    del('program_approvals', 'user_id=?', [u]),
  );
  list.push(del('family_accounts', 'user_id=?', [u]));
  return list;
}

// The Delete this family account form on /accounts (app/accounts/route.ts). Inline JavaScript is not typechecked, so it
// lives here where tests/family-deletion.mjs runs it. The button waits for the name, matched as confirmMatches does.
export const DELETE_SCRIPT = `const squash=v=>String(v||'').trim().replace(/\\s+/g,' ').toLowerCase();
document.querySelectorAll('form.delete-form').forEach(f=>{const input=f.elements.confirm,button=f.querySelector('button'),status=f.querySelector('.delete-status');
 input.oninput=()=>{button.disabled=!squash(f.dataset.label)||squash(input.value)!==squash(f.dataset.label)};
 f.onsubmit=async e=>{e.preventDefault();if(button.disabled)return;button.disabled=true;status.textContent='Deleting…';
  try{const r=await fetch('/api/accounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'delete',userId:f.dataset.user,confirm:input.value,test:f.elements.test.checked})}),d=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(d.error||'The family account could not be deleted.');
   const card=f.closest('article');card.innerHTML='<h2>Family account deleted</h2><p>'+Number(d.deleted)+' records deleted. '+(d.paymentsKept?Number(d.paymentsKept)+(d.paymentsKept===1?' payment stays':' payments stay')+' on Payments as “Deleted family”. ':'')+'Their sign-in is still with Supabase: delete it there too (Authentication, then Users).</p>';card.tabIndex=-1;card.focus()}
  catch(err){status.textContent=err.message;button.disabled=false}}});`;

export type DeleteResult ={status: number; error?: string; deleted?: number; kept?: number; key?: string};

export async function deleteFamily(ownerId: string, input: any, today = academyToday(), now = new Date()): Promise<DeleteResult> {
  const userId = input?.userId;
  if (typeof userId !== 'string' || !userId || userId.length > 80) return {status: 400, error: 'Choose a family.'};
  const family = await db().prepare('SELECT user_id,email,payload FROM family_accounts WHERE user_id=?').bind(userId).first<Family>();
  if (!family) return {status: 404, error: 'This family account is already gone. Reload the page.'};
  const label = familyLabel(family);
  if (!confirmMatches(input.confirm, label)) return {status: 400, error: `To delete this family account, type ${label} exactly as shown.`};
  const problems = await activeProblems(userId, today, now);
  if (problems.length) return {status: 409, error: `This family still has ${problems.join('; ')}. Do that first, then delete the account.`};
  const key = deletedKey(crypto.randomUUID()), test = input.test === true, at = now.toISOString();
  const list = steps(userId, key, family.email, test, today);
  // The family row is deleted last and only if it is still there, so two clicks delete once.
  const results = await db().batch(list.map(s => db().prepare(s.sql).bind(...s.args)));
  if (!changes(results.at(-1))) return {status: 404, error: 'This family account is already gone. Reload the page.'};
  let deleted = 0, kept = 0;
  list.forEach((s, i) => { if (s.kind === 'deleted') deleted += changes(results[i]); else if (s.table === 'orders') kept += changes(results[i]); });
  // Counts only, never a name or email (as for removed coaches, lib/coach-retention.ts).
  await db().prepare('INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,?,?,?)')
    .bind(crypto.randomUUID(), ownerId, 'family_account_deleted', `${key} deleted:${deleted} payments-kept:${kept} test:${test ? 1 : 0}`, at).run();
  return {status: 200, deleted, kept, key};
}
