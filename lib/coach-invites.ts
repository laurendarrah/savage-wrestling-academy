// Coach invitations (issue #190). The owner invites a coach by name, email and programs and gets a link to copy (and,
// once email is set up, it is emailed too). The link carries a random 256-bit token; only its SHA-256 hash is stored.
// An invite expires after INVITE_DAYS, works once, and only for a signed-in account with the invited, confirmed email.
// Accepting it grants staff_access, the same record /staff has always used for coach access.
import {env} from 'cloudflare:workers';
import {appOrigin, OWNER_EMAIL} from './account-auth';
import {emailConfigured, sendEmails} from './email';
import {programName} from './program-names';

// How long a link works. The owner can make a new link at any time, which ends the old one.
export const INVITE_DAYS = 7;
export const PROGRAM_IDS = ['Elementary', 'Intermediate', 'Advanced'];
export const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;

export function newToken() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join(''); }
export const validToken = (t: unknown): t is string => typeof t === 'string' && /^[a-f0-9]{64}$/.test(t);
export async function tokenHash(token: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), b => b.toString(16).padStart(2, '0')).join('');
}
// The token goes after # so it is never sent to the server in a page request or written to a log.
export const inviteLink = (token: string) => `${appOrigin()}/coach-join#invite=${token}`;

export type InviteRow = {id: string; token_hash: string; email: string; name: string; programs: string; created_by: string; created_at: string;
  expires_at: string; used_at: string | null; used_by: string | null; revoked_at: string | null};
export const inviteStatus = (r: InviteRow, now = new Date().toISOString()) =>
  r.used_at ? 'used' : r.revoked_at ? 'canceled' : r.expires_at <= now ? 'expired' : 'open';
export const inviteView = (r: InviteRow) => ({id: r.id, email: r.email, name: r.name, programs: JSON.parse(r.programs) as string[], createdAt: r.created_at,
  expiresAt: r.expires_at, usedAt: r.used_at, status: inviteStatus(r)});

// Name, email and programs as the owner typed them.
export function cleanInvite(input: any): {name: string; email: string; programs: string[]} | {error: string} {
  const email = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : '';
  if (!validEmail(email)) return {error: 'Enter the coach’s email address.'};
  if (email === OWNER_EMAIL) return {error: 'That is your owner email. Use “Add yourself as a coach” instead.'};
  const name = typeof input?.name === 'string' ? input.name.replace(/\s+/g, ' ').trim() : '';
  if (!name || name.length > 100) return {error: 'Enter the coach’s name.'};
  if (!Array.isArray(input?.programs) || input.programs.length > 3 || input.programs.some((p: unknown) => !PROGRAM_IDS.includes(p as string))) return {error: 'Choose valid programs.'};
  return {name, email, programs: [...new Set(input.programs as string[])]};
}

// A new invite. Any earlier open invite for the same email is canceled, so only the newest link works.
export async function createInvite(input: any, ownerId: string) {
  const clean = cleanInvite(input);
  if ('error' in clean) return {status: 400, error: clean.error};
  const active = await env.DB!.prepare('SELECT 1 FROM staff_access WHERE email=? AND active=1').bind(clean.email).first();
  if (active) return {status: 409, error: 'This coach already has access. Change their programs in the list below.'};
  const token = newToken(), id = crypto.randomUUID(), now = new Date(), at = now.toISOString(), expires = new Date(now.getTime() + INVITE_DAYS * 86400000).toISOString();
  await env.DB!.batch([
    env.DB!.prepare('UPDATE coach_invites SET revoked_at=? WHERE email=? AND used_at IS NULL AND revoked_at IS NULL').bind(at, clean.email),
    env.DB!.prepare('INSERT INTO coach_invites(id,token_hash,email,name,programs,created_by,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)')
      .bind(id, await tokenHash(token), clean.email, clean.name, JSON.stringify(clean.programs), ownerId, at, expires),
    env.DB!.prepare('INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), ownerId, 'coach_invited', clean.email, at)
  ]);
  const row = (await env.DB!.prepare('SELECT * FROM coach_invites WHERE id=?').bind(id).first<InviteRow>())!;
  // Someone who already has an account on the site (a family account exists only for a confirmed email) becomes a
  // coach at once (issue #394): no link to send and nothing for them to do. They land on coach home next visit.
  if (await env.DB!.prepare('SELECT 1 FROM family_accounts WHERE lower(email)=? LIMIT 1').bind(clean.email).first()) {
    const granted = await grantInvite(id, ownerId);
    if (granted.status === 200) return {status: 200, invite: inviteView(row), granted: true, name: row.name};
  }
  return {status: 200, invite: inviteView(row), link: inviteLink(token), emailStatus: await emailInvite(row, token)};
}

// A fresh link for an invite nobody has used yet (the old link stops working), with a new expiry.
export async function renewInvite(id: unknown, ownerId: string) {
  if (typeof id !== 'string' || id.length > 80) return {status: 404, error: 'Invite not found.'};
  const token = newToken(), now = new Date(), at = now.toISOString(), expires = new Date(now.getTime() + INVITE_DAYS * 86400000).toISOString();
  const row = await env.DB!.prepare('UPDATE coach_invites SET token_hash=?,expires_at=?,revoked_at=NULL WHERE id=? AND used_at IS NULL RETURNING *')
    .bind(await tokenHash(token), expires, id).first<InviteRow>();
  if (!row) return {status: 404, error: 'This invite was already used or no longer exists.'};
  if (await env.DB!.prepare('SELECT 1 FROM staff_access WHERE email=? AND active=1').bind(row.email).first()) {
    await env.DB!.prepare('UPDATE coach_invites SET revoked_at=? WHERE id=?').bind(at, id).run();
    return {status: 409, error: 'This coach already has access, so the invite is no longer needed.'};
  }
  // Only one open link per email: a renewed invite ends any other one.
  await env.DB!.prepare('UPDATE coach_invites SET revoked_at=? WHERE email=? AND id<>? AND used_at IS NULL AND revoked_at IS NULL').bind(at, row.email, id).run();
  await env.DB!.prepare('INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), ownerId, 'coach_invite_renewed', row.email, at).run();
  return {status: 200, invite: inviteView(row), link: inviteLink(token), emailStatus: await emailInvite(row, token)};
}

export async function cancelInvite(id: unknown, ownerId: string) {
  if (typeof id !== 'string' || id.length > 80) return {status: 404, error: 'Invite not found.'};
  const at = new Date().toISOString();
  const row = await env.DB!.prepare('UPDATE coach_invites SET revoked_at=? WHERE id=? AND used_at IS NULL AND revoked_at IS NULL RETURNING email').bind(at, id).first<{email: string}>();
  if (!row) return {status: 404, error: 'This invite was already used or canceled.'};
  await env.DB!.prepare('INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), ownerId, 'coach_invite_canceled', row.email, at).run();
  return {status: 200};
}

async function emailInvite(row: InviteRow, token: string): Promise<'sent' | 'failed' | 'off'> {
  if (!emailConfigured()) return 'off';
  const programs = (JSON.parse(row.programs) as string[]).map(programName).join(', ');
  const [status] = await sendEmails([{to: row.email, subject: 'You’re invited to coach at Savage Wrestling Academy',
    text: `Hi ${row.name},\n\nSavage Wrestling Academy has invited you to join as a coach${programs ? ' for ' + programs : ''}.\n\n`
      + `Open this link to create your coach account (or sign in with ${row.email}):\n${inviteLink(token)}\n\n`
      + `The link works once and ends on ${new Date(row.expires_at).toLocaleDateString('en-US', {timeZone: 'America/New_York', month: 'long', day: 'numeric'})}. `
      + 'If it stops working, ask the academy for a new one.\n\n—\nSavage Wrestling Academy', audience: 'invite'}]);
  return status === 'sent' ? 'sent' : 'failed';
}

// The invite a link (or, with no link, the signed-in person's email) points to.
export async function findInvite(token: string | null, email: string | null): Promise<InviteRow | null> {
  if (token) return await env.DB!.prepare('SELECT * FROM coach_invites WHERE token_hash=?').bind(await tokenHash(token)).first<InviteRow>();
  if (!email) return null;
  return await env.DB!.prepare('SELECT * FROM coach_invites WHERE email=? AND used_at IS NULL AND revoked_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 1')
    .bind(email.toLowerCase(), new Date().toISOString()).first<InviteRow>();
}
// Has this confirmed email an open invite? Sign-in and email confirmation use it to bring the coach back to /coach-join.
export async function hasOpenInvite(email: string | undefined | null) {
  return !!email && !!(await findInvite(null, email));
}
// A coach who signed in on the family side before their invite was accepted (issue #392) can leave a family account
// with no wrestler in it, which then shows on the owner's Families list. Once they are an active coach it is deleted,
// but only while it holds nothing: no wrestler, payment, cash booking, message or data request. A coach who is also a
// parent keeps their family account.
export function emptyFamilyGone(by: 'user_id' | 'email', key: string) {
  const match = by === 'user_id' ? 'user_id=?' : 'lower(email)=?';
  return env.DB!.prepare(`DELETE FROM family_accounts WHERE ${match} AND COALESCE(json_array_length(payload,'$.wrestlers'),0)=0
    AND EXISTS (SELECT 1 FROM staff_access s WHERE s.email=lower(family_accounts.email) AND s.active=1)
    AND NOT EXISTS (SELECT 1 FROM orders x WHERE x.user_id=family_accounts.user_id) AND NOT EXISTS (SELECT 1 FROM cash_bookings c WHERE c.user_id=family_accounts.user_id)
    AND NOT EXISTS (SELECT 1 FROM family_messages m WHERE m.user_id=family_accounts.user_id) AND NOT EXISTS (SELECT 1 FROM data_requests d WHERE d.user_id=family_accounts.user_id)`).bind(by === 'user_id' ? key : key.toLowerCase());
}
// The owner gives an invited coach access straight away (issue #392), without waiting for them to use the link: for a
// coach who signed up but landed on the family side, or one the owner would rather not chase. The invite is marked used,
// so its link stops; the coach signs in with that email and lands on coach home. A canceled or used invite can't be.
export async function grantInvite(id: unknown, ownerId: string) {
  if (typeof id !== 'string' || id.length > 80) return {status: 404, error: 'Invite not found.'};
  const row = await env.DB!.prepare('SELECT * FROM coach_invites WHERE id=?').bind(id).first<InviteRow>();
  if (!row) return {status: 404, error: 'Invite not found.'};
  if (row.used_at) return {status: 410, error: 'This invite was already used, so the coach has access.'};
  if (row.revoked_at) return {status: 410, error: 'This invite was canceled. Send a new invite to give access.'};
  const at = new Date().toISOString(), by = 'owner:' + ownerId;
  const [claimed] = await env.DB!.batch([
    env.DB!.prepare('UPDATE coach_invites SET used_at=?,used_by=? WHERE id=? AND used_at IS NULL AND revoked_at IS NULL RETURNING id').bind(at, by, row.id),
    env.DB!.prepare(`INSERT INTO staff_access(email,name,programs,active,updated_at) SELECT email,name,programs,1,? FROM coach_invites WHERE id=? AND used_by=? AND used_at=?
      ON CONFLICT(email) DO UPDATE SET name=excluded.name,programs=excluded.programs,active=1,updated_at=excluded.updated_at`).bind(at, row.id, by, at),
    env.DB!.prepare('INSERT INTO security_events(id,actor,action,target,created_at) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM coach_invites WHERE id=? AND used_by=? AND used_at=?)')
      .bind(crypto.randomUUID(), ownerId, 'coach_access_granted', row.email, at, row.id, by, at),
    emptyFamilyGone('email', row.email)
  ]);
  if (!(claimed as any).results?.length) return {status: 410, error: 'This invite was just used or changed. Refresh the page.'};
  return {status: 200, name: row.name};
}
// A signed-in active coach with no family account who opens the family home goes to coach home instead (issue #392).
export async function coachWithoutFamily(user: {id: string; email?: string | null; email_confirmed_at?: string | null} | null) {
  if (!user?.email || !user.email_confirmed_at || user.email.toLowerCase() === OWNER_EMAIL) return false;
  return !!(await env.DB!.prepare('SELECT 1 FROM staff_access s WHERE s.email=? AND s.active=1 AND NOT EXISTS (SELECT 1 FROM family_accounts f WHERE f.user_id=?)')
    .bind(user.email.toLowerCase(), user.id).first());
}
// An invited coach gets coach access as soon as the site sees them signed in with the confirmed, invited email (issue
// #392): at sign-in, at the email confirmation link, on the family home and on the invite page. There is no Accept step
// to miss. The rules are acceptInvite's: an open invite for that exact email, never the owner's. True when it was accepted.
export async function acceptOpenInvite(user: {id: string; email?: string | null; email_confirmed_at?: string | null} | null) {
  if (!user?.email || !user.email_confirmed_at || user.email.toLowerCase() === OWNER_EMAIL) return false;
  if (!(await hasOpenInvite(user.email))) return false;
  return (await acceptInvite(user, null)).status === 200;
}

// Accept an invite as the signed-in person. Their email must be confirmed and match the invite. Marking the invite
// used and granting access happen in one transaction, so a link can never be used twice.
export async function acceptInvite(user: {id: string; email?: string | null; email_confirmed_at?: string | null} | null, token: unknown) {
  if (!user?.email || !user.email_confirmed_at) return {status: 401, error: 'Sign in with your confirmed email first.'};
  if (token !== null && token !== undefined && !validToken(token)) return {status: 404, error: 'This invite link isn’t complete. Copy the whole link from the academy.'};
  const email = user.email.toLowerCase();
  if (email === OWNER_EMAIL) return {status: 403, error: 'The owner account can’t accept a coach invite. Use “Add yourself as a coach” on Coaches.'};
  const row = await findInvite((token as string) ?? null, email);
  if (!row) return {status: 404, error: token ? 'This invite link isn’t working. Ask the academy for a new one.' : 'There is no open coach invite for ' + email + '.'};
  const state = inviteStatus(row);
  if (state === 'used') return {status: 410, error: 'This invite was already used. Sign in to open coach home.'};
  if (state === 'canceled') return {status: 410, error: 'This invite was canceled. Ask the academy for a new one.'};
  if (state === 'expired') return {status: 410, error: 'This invite has expired. Ask the academy for a new link.'};
  if (row.email !== email) return {status: 403, error: `This invite is for ${row.email}. Sign out, then sign in or create an account with that email.`};
  const at = new Date().toISOString(), claimed = 'SELECT 1 FROM coach_invites WHERE id=? AND used_by=? AND used_at=?';
  const results = await env.DB!.batch([
    env.DB!.prepare('UPDATE coach_invites SET used_at=?,used_by=? WHERE id=? AND email=? AND used_at IS NULL AND revoked_at IS NULL AND expires_at>? RETURNING id').bind(at, user.id, row.id, email, at),
    env.DB!.prepare(`INSERT INTO staff_access(email,name,programs,active,updated_at) SELECT email,name,programs,1,? FROM coach_invites WHERE id=? AND used_by=? AND used_at=?
      ON CONFLICT(email) DO UPDATE SET name=excluded.name,programs=excluded.programs,active=1,updated_at=excluded.updated_at`).bind(at, row.id, user.id, at),
    env.DB!.prepare(`INSERT INTO security_events(id,actor,action,target,created_at) SELECT ?,?,?,?,? WHERE EXISTS (${claimed})`)
      .bind(crypto.randomUUID(), user.id, 'coach_invite_accepted', email, at, row.id, user.id, at),
    emptyFamilyGone('user_id', user.id)
  ]);
  if (!(results[0] as any).results?.length) return {status: 410, error: 'This invite was just used or changed. Ask the academy for a new one.'};
  return {status: 200, name: row.name};
}
