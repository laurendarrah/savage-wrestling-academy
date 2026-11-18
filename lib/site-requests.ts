// Requests from the owner for changes to the site itself (issue #361): wording, something that looks wrong, something
// new. The owner runs the academy on the site, but the site's own pages and features change through GitHub, which the
// owner may not use. This is the one place to write what is wanted.
//
// - Owner only. Nothing here is shown to families, coaches or the public.
// - Each request is saved, newest first, in one row of academy_settings (id 'site-requests'), so there is no new table
//   and backups already include it. The newest 200 are kept.
// - Each request is emailed to the person who maintains the site, at the one address in the Worker setting
//   SITE_REQUESTS_TO. That address is never in the repository and never sent to the browser. A request whose email did
//   not go out says so and can be sent again.
// - The owner marks a request Done, or reopens it. Nothing else changes a request.
import {env} from 'cloudflare:workers';
import {OWNER_EMAIL} from './account-auth';
import {sendEmailsDetailed, type EmailResult, type Outgoing} from './email';

export const REQUESTS_KEY = 'site-requests';
export const MAX_KEPT = 200, MAX_WORDS = 4000, MAX_WHERE = 200, DAILY_LIMIT = 20;
// email: 'sent', 'failed' (the provider refused it or could not be reached) or 'off' (no address, or email not set up).
export type SiteRequest = {id: string; at: string; words: string; where: string; email: 'sent' | 'failed' | 'off'; status: 'open' | 'done'; doneAt: string | null};
export type RequestResult = {status: number; error?: string; request?: SiteRequest; requests?: SiteRequest[]};
type Send = (list: Outgoing[]) => Promise<EmailResult[]>;
type Row = {payload: string; updated_at: string};

const db = () => env.DB!;

// Where requests are emailed. One plain address; anything else counts as not set.
export function requestAddress(setting: unknown = (env as {SITE_REQUESTS_TO?: string}).SITE_REQUESTS_TO): string | null {
  const v = String(setting ?? '').trim();
  return v.length <= 254 && /^[^\s@<>,;"']+@[^\s@<>,;"']+\.[^\s@<>,;"']+$/.test(v) ? v : null;
}

const valid = (r: any): r is SiteRequest => !!r && typeof r.id === 'string' && typeof r.at === 'string' && typeof r.words === 'string' && typeof r.where === 'string'
  && ['sent', 'failed', 'off'].includes(r.email) && ['open', 'done'].includes(r.status);
async function read(): Promise<{row: Row | null; list: SiteRequest[]}> {
  const row = await db().prepare('SELECT payload,updated_at FROM academy_settings WHERE id=?').bind(REQUESTS_KEY).first<Row>();
  let list: SiteRequest[] = [];
  try { const p = row ? JSON.parse(row.payload) : null; if (Array.isArray(p?.requests)) list = p.requests.filter(valid); } catch { list = []; }
  return {row, list};
}
export async function listRequests(): Promise<SiteRequest[]> { return (await read()).list; }

// Reads the list, applies one change and writes it back. A write that lost to another one (two tabs) is tried again on
// the fresh list. `change` returns the new list, or an error to stop with.
async function update(by: string, change: (list: SiteRequest[]) => SiteRequest[] | RequestResult): Promise<RequestResult & {list?: SiteRequest[]}> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const {row, list} = await read(), next = change(list);
    if (!Array.isArray(next)) return next;
    const payload = JSON.stringify({requests: next.slice(0, MAX_KEPT)});
    // The stamp only has to differ from the row's last one, so a second change in the same millisecond still counts.
    let at = new Date().toISOString();
    if (row && at <= row.updated_at) at = new Date(Date.parse(row.updated_at) + 1).toISOString();
    const r = row
      ? await db().prepare('UPDATE academy_settings SET payload=?,updated_at=?,updated_by=? WHERE id=? AND updated_at=?').bind(payload, at, by, REQUESTS_KEY, row.updated_at).run()
      : await db().prepare('INSERT OR IGNORE INTO academy_settings(id,payload,updated_at,updated_by) VALUES (?,?,?,?)').bind(REQUESTS_KEY, payload, at, by).run();
    if (r.meta?.changes === 1) return {status: 200, list: next.slice(0, MAX_KEPT)};
  }
  return {status: 409, error: 'The list changed while this was being saved. Reload the page and try again.'};
}

// Plain text as typed: line breaks kept, other control characters removed, trimmed.
const clean = (v: unknown, max: number, lines: boolean): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\r\n?/g, '\n').replace(lines ? /[\u0000-\u0009\u000B-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, ' ').trim();
  return t.length <= max ? t : null;
};
const sentAt = (at: string) => new Date(at).toLocaleString('en-US', {timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'}).replace(/[  ]/g, ' ');

// The email for one request. The subject carries the first line, so several requests are easy to tell apart.
export function requestEmail(r: SiteRequest, to: string): Outgoing {
  const first = r.words.split('\n')[0].trim(), head = first.length > 70 ? first.slice(0, 67).trimEnd() + '…' : first;
  const text = ['The academy’s owner asked for a change to the site.', '', 'Sent: ' + sentAt(r.at) + ' (New York time)', ...(r.where ? ['Where: ' + r.where] : []), '', 'What they asked for:', r.words, '',
    `Reply to the owner at ${OWNER_EMAIL}. The request is also saved on the site, on the owner’s Request a site change page, where the owner marks it Done.`].join('\n');
  return {to, subject: 'Site change request: ' + head, text, audience: 'maintainer'};
}
async function deliver(r: SiteRequest, send: Send): Promise<SiteRequest['email']> {
  const to = requestAddress();
  if (!to) return 'off';
  try { const [result] = await send([requestEmail(r, to)]); return result?.status === 'sent' ? 'sent' : result?.status === 'failed' ? 'failed' : 'off'; } catch { return 'failed'; }
}
const setEmail = (by: string, id: string, email: SiteRequest['email']) => update(by, list => list.map(r => r.id === id ? {...r, email} : r));

// A new request: saved first, so it is never lost to an email problem, then emailed, then its email result recorded.
export async function addRequest(by: string, input: any, now = new Date(), send: Send = sendEmailsDetailed): Promise<RequestResult> {
  const words = clean(input?.words, MAX_WORDS, true), where = clean(input?.where ?? '', MAX_WHERE, false);
  if (!words) return {status: 400, error: typeof input?.words === 'string' && input.words.trim() ? `Keep the request under ${MAX_WORDS.toLocaleString('en-US')} characters, or send it in two parts.` : 'Write what you would like changed.'};
  if (where === null) return {status: 400, error: `Keep “which page” under ${MAX_WHERE} characters.`};
  const request: SiteRequest = {id: crypto.randomUUID(), at: now.toISOString(), words, where, email: 'off', status: 'open', doneAt: null};
  const saved = await update(by, list => {
    if (list[0] && list[0].words === words && list[0].where === where && now.getTime() - Date.parse(list[0].at) < 120000) return {status: 409, error: 'That request was just sent. It is in the list below.'};
    if (list.filter(r => now.getTime() - Date.parse(r.at) < 86400000).length >= DAILY_LIMIT) return {status: 429, error: `That is ${DAILY_LIMIT} requests in a day. Send the rest tomorrow, or put several changes in one request.`};
    return [request, ...list];
  });
  if (saved.status !== 200) return {status: saved.status, error: saved.error};
  const email = await deliver(request, send);
  const after = email === 'off' ? saved : await setEmail(by, request.id, email);
  return {status: 200, request: {...request, email}, requests: after.list ?? (await listRequests())};
}

// Sends a request's email again when it did not go out the first time.
export async function resendRequest(by: string, id: unknown, send: Send = sendEmailsDetailed): Promise<RequestResult> {
  const request = typeof id === 'string' ? (await listRequests()).find(r => r.id === id) : undefined;
  if (!request) return {status: 404, error: 'Request not found.'};
  if (request.email === 'sent') return {status: 400, error: 'That request was already emailed.'};
  if (!requestAddress()) return {status: 409, error: 'The site has no address to send requests to yet. Tell the person who maintains the site.'};
  const email = await deliver(request, send), after = await setEmail(by, request.id, email);
  if (email !== 'sent') return {status: 502, error: 'The email could not be sent. The request is still saved here. Try again later, or tell the person who maintains the site.', requests: after.list};
  return {status: 200, request: {...request, email}, requests: after.list ?? (await listRequests())};
}

// The owner marks a request Done once the change is live, or reopens it.
export async function markRequest(by: string, id: unknown, done: unknown, now = new Date()): Promise<RequestResult> {
  if (typeof id !== 'string' || typeof done !== 'boolean') return {status: 400, error: 'Invalid request.'};
  let found = false;
  const after = await update(by, list => {
    const next = list.map(r => r.id === id ? (found = true, {...r, status: done ? 'done' as const : 'open' as const, doneAt: done ? now.toISOString() : null}) : r);
    return found ? next : {status: 404, error: 'Request not found.'};
  });
  return after.status === 200 ? {status: 200, requests: after.list} : {status: after.status, error: after.error};
}
