// QR entry passes (issue #71). Each wrestler has one active pass: a random code shown as a QR code in the family
// account. Staff scan it on the roster page, which checks the wrestler in under the same rules as manual check-in:
// only a wrestler on that day's roster (paid, or on scholarship) can be checked in. Replacing a pass revokes the old one.
import {env} from 'cloudflare:workers';
import {familyProfile} from './program-approval';
import {rosterFor, checkIn, type Scope} from './roster';

export const PASS_PREFIX = 'SWA1:';
const newToken = () => { const b = new Uint8Array(24); crypto.getRandomValues(b); return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };

// The family's active passes, creating any that are missing. Only wrestlers saved in the family profile get one.
export async function familyPasses(userId: string) {
  const profile = await familyProfile(userId), wrestlers = profile?.wrestlers ?? [];
  type Row = {wrestler_id: string; token: string; created_at: string};
  const rows = (await env.DB!.prepare('SELECT wrestler_id,token,created_at FROM wrestler_passes WHERE user_id=? AND revoked_at IS NULL').bind(userId).all<Row>()).results;
  const out = [];
  for (const w of wrestlers) {
    let row: Row | null | undefined = rows.find(r => r.wrestler_id === w.id);
    if (!row) {
      const token = newToken(), at = new Date().toISOString();
      await env.DB!.prepare('INSERT OR IGNORE INTO wrestler_passes(id,user_id,wrestler_id,token,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), userId, w.id, token, at).run();
      row = await env.DB!.prepare('SELECT wrestler_id,token,created_at FROM wrestler_passes WHERE user_id=? AND wrestler_id=? AND revoked_at IS NULL').bind(userId, w.id).first<Row>();
      if (!row) continue;
    }
    out.push({wrestlerId: w.id, name: w.name, code: PASS_PREFIX + row.token, createdAt: row.created_at});
  }
  return out;
}

// Revoke the active pass (lost phone, shared screenshot). The family gets a new code the next time they open it.
export async function revokePass(userId: string, wrestlerId: string, actor: string) {
  const at = new Date().toISOString();
  const r = await env.DB!.prepare('UPDATE wrestler_passes SET revoked_at=?,revoked_by=? WHERE user_id=? AND wrestler_id=? AND revoked_at IS NULL').bind(at, actor, userId, wrestlerId).run();
  await env.DB!.prepare('INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), actor, 'pass_revoked', `${userId}/${wrestlerId}`, at).run();
  return r;
}

export async function resolvePass(code: unknown) {
  if (typeof code !== 'string' || !code.startsWith(PASS_PREFIX)) return null;
  const token = code.slice(PASS_PREFIX.length);
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return null;
  return await env.DB!.prepare('SELECT user_id AS userId,wrestler_id AS wrestlerId FROM wrestler_passes WHERE token=? AND revoked_at IS NULL').bind(token).first<{userId: string; wrestlerId: string}>();
}

const toMinutes = (t: string | null) => t ? +t.slice(0, 2) * 60 + +t.slice(3, 5) : 0;

// Check in by pass. With several sessions that day, the one nearest the current time is used unless staff choose.
export async function scanCheckIn(date: string, code: unknown, scope: Scope, actor: string, nowMinutes: number, sessionKey?: unknown) {
  const pass = await resolvePass(code);
  if (!pass) return {status: 404, error: 'This pass is not valid. It may have been replaced; ask the family to open the current pass in their account.'};
  const sessions = (await rosterFor(date, scope)).filter(s => s.entries.some(e => e.userId === pass.userId && e.wrestlerId === pass.wrestlerId));
  if (!sessions.length) return {status: 409, error: 'This wrestler is not registered or paid for any session on your roster today.'};
  const entryIn = (s: typeof sessions[number]) => s.entries.find(e => e.userId === pass.userId && e.wrestlerId === pass.wrestlerId)!;
  let session = typeof sessionKey === 'string' ? sessions.find(s => s.key === sessionKey) : undefined;
  if (!session) {
    const open = sessions.filter(s => !entryIn(s).checkedInAt);
    if (!open.length) { const e = entryIn(sessions[0]); return {status: 200, already: true, name: e.name, session: sessions[0].title, checkedInAt: e.checkedInAt, entry: e}; }
    // Minutes from now to the session: 0 while it is running; all-day events rank after timed sessions.
    const distance = (s: typeof sessions[number]) => {
      if (!s.start) return 720;
      const a = toMinutes(s.start), b = toMinutes(s.end);
      return nowMinutes >= a && nowMinutes <= b ? 0 : Math.min(Math.abs(a - nowMinutes), Math.abs(b - nowMinutes));
    };
    session = open.sort((a, b) => distance(a) - distance(b))[0];
  }
  const entry = entryIn(session);
  if (entry.checkedInAt) return {status: 200, already: true, name: entry.name, session: session.title, checkedInAt: entry.checkedInAt, entry};
  const r = await checkIn(date, session.key, pass.userId, pass.wrestlerId, scope, actor);
  if (r.status !== 200) return r;
  return {status: 200, already: false, name: entry.name, session: session.title, sessionKey: session.key, entry,
    others: sessions.filter(s => s.key !== session!.key).map(s => ({key: s.key, title: s.title, start: s.start}))};
}
