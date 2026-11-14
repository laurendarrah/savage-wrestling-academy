// Outgoing email (issue #72). Off until both EMAIL_API_KEY and MAIL_FROM are set; until then messages are in-app only
// and each recipient is marked "skipped". The adapter speaks Resend's batch API; the provider is decided on #87.
//
// Every email goes out in the Savage layout (issue #320): callers write plain text, and this adapter adds the HTML
// version from lib/email-brand.ts and keeps the plain text, exactly as written, as the text alternative. Nothing else
// sends email, so no message can miss the layout.
import {env} from 'cloudflare:workers';
import {appOrigin, OWNER_EMAIL} from './account-auth';
import {brandedEmail, type BrandAudience} from './email-brand';
import {EMAIL_TIMEOUT_MS, timeoutSignal} from './net';

type Env = Cloudflare.Env & {EMAIL_API_KEY?: string; MAIL_FROM?: string};
// `audience` is optional and only picks the footer's "why you got this" line: 'invite' for someone without an account
// yet, 'owner' for the site's alerts. Left out, email to the owner address gets the owner line and everyone else the
// account line.
export type Outgoing = {to: string; subject: string; text: string; audience?: BrandAudience};
export type EmailStatus = 'sent' | 'failed' | 'skipped';
// Why an email did not send (issue #35), stored as a short code in email_error next to email_status.
export type EmailFailure = 'setup' | 'refused' | 'busy' | 'unreachable';
export type EmailResult = {status: EmailStatus; reason: EmailFailure | null};

export function emailConfigured() {
  const e = env as Env;
  return !!(e.EMAIL_API_KEY && e.MAIL_FROM);
}

// The provider's answer, as one of four reasons the owner can act on. null means it could not be reached at all.
export function failureReason(httpStatus: number | null): EmailFailure {
  if (httpStatus === 401 || httpStatus === 403) return 'setup';
  if (httpStatus === 400 || httpStatus === 422) return 'refused';
  if (httpStatus === 429) return 'busy';
  return 'unreachable';
}

// Plain words for the owner's pages.
const WORDS: Record<EmailFailure, string> = {
  setup: 'The email service didn’t accept the academy’s email settings (the sending key or sending address). Whoever set up email needs to check them.',
  refused: 'The email service refused the message. The address may be mistyped or not able to receive email.',
  busy: 'Too many emails went out at once. Trying again usually works.',
  unreachable: 'The email service couldn’t be reached. Trying again usually works.'
};
export function failureWords(reason: string | null | undefined) {
  return WORDS[reason as EmailFailure] ?? 'The email service didn’t accept it.';
}

// What the provider is sent for one message: the Savage HTML and the caller's plain text. The site address (for the
// logo and for telling the site's own links from others) comes from appOrigin(); without one the email still goes,
// with no logo and no button. If the layout ever fails, the plain text goes alone rather than nothing.
function emailPayload(m: Outgoing, from: string | undefined, origin: string | null) {
  const base = {from, to: [m.to], subject: m.subject, text: m.text};
  try {
    const audience = m.audience ?? (OWNER_EMAIL && String(m.to).trim().toLowerCase() === OWNER_EMAIL ? 'owner' : 'account');
    return {...base, html: brandedEmail({subject: m.subject, text: m.text, origin, audience}).html};
  } catch (error) {
    console.error('email layout failed', error);
    return base;
  }
}

// Sends in batches of up to 100. Returns one result per message, in order. Never throws.
export async function sendEmailsDetailed(list: Outgoing[]): Promise<EmailResult[]> {
  if (!list.length) return [];
  if (!emailConfigured()) return list.map(() => ({status: 'skipped', reason: null}));
  const e = env as Env, out: EmailResult[] = [];
  let origin: string | null = null;
  try { origin = appOrigin(); } catch { origin = null; }
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100);
    let result: EmailResult;
    try {
      const r = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST', headers: {Authorization: 'Bearer ' + e.EMAIL_API_KEY, 'Content-Type': 'application/json'},
        body: JSON.stringify(chunk.map(m => emailPayload(m, e.MAIL_FROM, origin))),
        // A provider that hangs counts as unreachable after a few seconds (issue #274) instead of holding the request.
        signal: timeoutSignal(EMAIL_TIMEOUT_MS)
      });
      result = r.ok ? {status: 'sent', reason: null} : {status: 'failed', reason: failureReason(r.status)};
    } catch { result = {status: 'failed', reason: failureReason(null)}; }
    out.push(...chunk.map(() => ({...result})));
  }
  return out;
}

export async function sendEmails(list: Outgoing[]): Promise<EmailStatus[]> {
  return (await sendEmailsDetailed(list)).map(r => r.status);
}
