// Coach invitations (issue #190). The owner invites a coach by name, email and programs and gets a link to copy (and,
// once email is set up, it is emailed too). The link carries a random 256-bit token; only its SHA-256 hash is stored.
// An invite expires after INVITE_DAYS, works once, and only for a signed-in account with the invited, confirmed email.
// Accepting it grants staff_access, the same record /staff has always used for coach access.
import {env} from 'cloudflare:workers';
import {appOrigin, OWNER_EMAIL} from './account-auth';
import {emailConfigured, sendEmails} from './email';

// How long a link works. The owner can make a new link at any time, which ends the old one.
export const INVITE_DAYS = 7;
export const PROGRAM_IDS = ['Elementary', 'Intermediate', 'Advanced'];
const PROGRAM_NAMES: Record<string, string> = {Elementary: 'SWA Development', Intermediate: 'SWA Intermediate', Advanced: 'SWA Advance'};
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
  const programs = (JSON.parse(row.programs) as string[]).map(p => PROGRAM_NAMES[p] ?? p).join(', ');
  const [status] = await sendEmails([{to: row.email, subject: 'You’re invited to coach at Savage Wrestling Academy',
    text: `Hi ${row.name},\n\nSavage Wrestling Academy has invited you to join as a coach${programs ? ' for ' + programs : ''}.\n\n`
      + `Open this link to create your coach account (or sign in with ${row.email}) and set up your authenticator app:\n${inviteLink(token)}\n\n`
      + `The link works once and ends on ${new Date(row.expires_at).toLocaleDateString('en-US', {timeZone: 'America/New_York', month: 'long', day: 'numeric'})}. `
      + 'If it stops working, ask the academy for a new one.\n\n—\nSavage Wrestling Academy'}]);
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
      .bind(crypto.randomUUID(), user.id, 'coach_invite_accepted', email, at, row.id, user.id, at)
  ]);
  if (!(results[0] as any).results?.length) return {status: 410, error: 'This invite was just used or changed. Ask the academy for a new one.'};
  return {status: 200, name: row.name};
}
