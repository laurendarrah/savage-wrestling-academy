// Real rosters from paid orders and active scholarships (issue #22). No sample workspace data is used.
import {env} from 'cloudflare:workers';
import {publicSchedule} from './public-schedule';
import {cardStatus, reviewFor, type CardStatus} from './usaw';

export type Session = {key: string; type: 'practice' | 'live' | 'event'; title: string; program: string | null; date: string; start: string | null; end: string | null};
export type Entry = {userId: string; wrestlerId: string; name: string; grade: string | null; parentName: string | null; phone: string | null; email: string | null; sources: string[]; checkedInAt: string | null; checkedInBy: string | null; card: CardStatus['state']; cardExpires: string | null; cardNote: string};
export type Scope = {role: 'owner'} | {role: 'coach'; programs: string[]};

export const validDate = (d: unknown): d is string =>
  typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d + 'T12:00:00Z').toISOString().slice(0, 10) === d;

const programNames: Record<string, string> = {Elementary: 'SWA Development', Intermediate: 'SWA Intermediate', Advanced: 'SWA Advance'};

async function academyState(): Promise<any> {
  const row = await env.DB!.prepare("SELECT payload FROM academy_state WHERE id='academy'").first<{payload: string}>();
  return row ? JSON.parse(row.payload) : {};
}

// Every session that runs on a date: program practices, Friday Night Live style sessions, and camp, clinic or event days.
export function sessionsOn(state: any, date: string): Session[] {
  const s = publicSchedule(state, date.slice(0, 7), date);
  const names = new Map<string, string>((s.programs ?? []).map((p: any) => [p.id, p.name]));
  const practices: Session[] = s.practices.filter((p: any) => p.date === date).map((p: any) => ({
    key: `practice:${p.program}:${date}:${p.start}`, type: 'practice', title: names.get(p.program) ?? programNames[p.program] ?? p.program, program: p.program, date, start: p.start, end: p.end
  }));
  const live: Session[] = (s.liveClasses ?? []).filter((l: any) => l.date === date).map((l: any) => ({
    key: `live:${l.id}:${date}`, type: 'live', title: l.name, program: null, date, start: l.start, end: l.end
  }));
  const events: Session[] = (s.events ?? []).filter((e: any) => e.dates.includes(date)).map((e: any) => ({
    key: `event:${e.id}:${date}`, type: 'event', title: e.name, program: null, date, start: null, end: null
  }));
  return [...practices, ...live, ...events].sort((a, b) => (a.start ?? '99') .localeCompare(b.start ?? '99') || a.title.localeCompare(b.title));
}

export function canSee(scope: Scope, session: Session) {
  return scope.role === 'owner' || (session.type === 'practice' && !!session.program && scope.programs.includes(session.program));
}

type Raw = {userId: string; wrestlerId: string; name: string; source: string};

// Who is entitled to attend a session, and why.
async function entitled(session: Session): Promise<Raw[]> {
  const d = session.date, rows: Raw[] = [];
  const add = (list: {user_id: string; wrestler_id: string; wrestler_name: string}[], source: string) =>
    list.forEach(r => rows.push({userId: r.user_id, wrestlerId: r.wrestler_id, name: r.wrestler_name, source}));
  if (session.type === 'practice') {
    const practiceId = `${session.program}:${d}:${session.start}`;
    add((await env.DB!.prepare(`SELECT user_id,wrestler_id,wrestler_name FROM orders WHERE status='paid' AND kind IN ('annual','monthly') AND program=? AND term_start<=? AND term_end>=?`)
      .bind(session.program, d, d).all<any>()).results, 'Member');
    add((await env.DB!.prepare(`SELECT user_id,wrestler_id,wrestler_name FROM orders WHERE status='paid' AND kind='walkin' AND program=? AND item_id=? AND EXISTS (SELECT 1 FROM json_each(orders.dates) WHERE value=?)`)
      .bind(session.program, practiceId, d).all<any>()).results, 'Walk-in paid');
    add((await env.DB!.prepare(`SELECT user_id,wrestler_id,wrestler_name FROM scholarship_awards WHERE status='active' AND program=? AND user_id IS NOT NULL AND wrestler_id IS NOT NULL AND accepted_at IS NOT NULL AND substr(accepted_at,1,10)<=?`)
      .bind(session.program, d).all<any>()).results, 'Scholarship');
  } else {
    const [, id] = session.key.split(':');
    add((await env.DB!.prepare(`SELECT user_id,wrestler_id,wrestler_name FROM orders WHERE status='paid' AND kind=? AND item_id=? AND EXISTS (SELECT 1 FROM json_each(orders.dates) WHERE value=?)`)
      .bind(session.type, id, d).all<any>()).results, session.type === 'live' ? 'Paid' : 'Registered');
  }
  return rows;
}

export async function rosterFor(date: string, scope: Scope) {
  const state = await academyState();
  const sessions = sessionsOn(state, date).filter(s => canSee(scope, s));
  const families = new Map<string, any>();
  const family = async (userId: string) => {
    if (!families.has(userId)) {
      const row = await env.DB!.prepare('SELECT email,payload FROM family_accounts WHERE user_id=?').bind(userId).first<{email: string; payload: string}>();
      families.set(userId, row ? {email: row.email, ...JSON.parse(row.payload)} : null);
    }
    return families.get(userId);
  };
  const checked = new Map<string, {checked_in_at: string; checked_in_by: string}>();
  for (const r of (await env.DB!.prepare('SELECT session_key,user_id,wrestler_id,checked_in_at,checked_in_by FROM attendance WHERE session_date=?').bind(date).all<any>()).results)
    checked.set(`${r.session_key}|${r.user_id}|${r.wrestler_id}`, r);

  const result = [];
  for (const session of sessions) {
    const merged = new Map<string, Entry>();
    for (const r of await entitled(session)) {
      const k = `${r.userId}|${r.wrestlerId}`;
      if (merged.has(k)) { const e = merged.get(k)!; if (!e.sources.includes(r.source)) e.sources.push(r.source); continue; }
      const f = await family(r.userId), w = f?.wrestlers?.find((x: any) => x.id === r.wrestlerId);
      const c = checked.get(`${session.key}|${k}`);
      // Card status on the session date. Check-in still works; staff see the warning and follow up (issue #68).
      const card = w ? cardStatus(w, await reviewFor(r.userId, r.wrestlerId), date) : {state: 'missing' as const, expires: '', note: ''};
      merged.set(k, {
        userId: r.userId, wrestlerId: r.wrestlerId, name: w?.name ?? r.name, grade: w?.grade ?? null,
        parentName: f?.parentName || null, phone: f?.phone || null, email: scope.role === 'owner' ? f?.email ?? null : null,
        sources: [r.source], checkedInAt: c?.checked_in_at ?? null, checkedInBy: scope.role === 'owner' ? c?.checked_in_by ?? null : null,
        card: card.state, cardExpires: card.expires || null, cardNote: card.note
      });
    }
    const entries = [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
    result.push({...session, entries, checkedIn: entries.filter(e => e.checkedInAt).length});
  }
  return result;
}

// Check-in only succeeds for a wrestler who is on that session's roster.
export async function checkIn(date: string, sessionKey: string, userId: string, wrestlerId: string, scope: Scope, actor: string) {
  const sessions = await rosterFor(date, scope);
  const session = sessions.find(s => s.key === sessionKey);
  if (!session) return {status: 404, error: 'This session is not on your roster for that date.'};
  const entry = session.entries.find(e => e.userId === userId && e.wrestlerId === wrestlerId);
  if (!entry) return {status: 409, error: 'This wrestler is not registered or paid for this session.'};
  await env.DB!.prepare('INSERT OR IGNORE INTO attendance(id,session_key,session_date,user_id,wrestler_id,wrestler_name,source,checked_in_at,checked_in_by) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(), sessionKey, date, userId, wrestlerId, entry.name, entry.sources.join(', '), new Date().toISOString(), actor).run();
  return {status: 200};
}

export async function undoCheckIn(date: string, sessionKey: string, userId: string, wrestlerId: string, scope: Scope) {
  const sessions = await rosterFor(date, scope);
  if (!sessions.some(s => s.key === sessionKey)) return {status: 404, error: 'This session is not on your roster for that date.'};
  await env.DB!.prepare('DELETE FROM attendance WHERE session_key=? AND user_id=? AND wrestler_id=?').bind(sessionKey, userId, wrestlerId).run();
  return {status: 200};
}
