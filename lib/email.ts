// Outgoing email (issue #72). Off until both EMAIL_API_KEY and MAIL_FROM are set; until then messages are in-app only
// and each recipient is marked "skipped". The adapter speaks Resend's batch API; the provider is decided on #87.
import {env} from 'cloudflare:workers';

type Env = Cloudflare.Env & {EMAIL_API_KEY?: string; MAIL_FROM?: string};
export type Outgoing = {to: string; subject: string; text: string};

export function emailConfigured() {
  const e = env as Env;
  return !!(e.EMAIL_API_KEY && e.MAIL_FROM);
}

// Sends in batches of up to 100. Returns one status per message, in order.
export async function sendEmails(list: Outgoing[]): Promise<('sent' | 'failed' | 'skipped')[]> {
  if (!list.length) return [];
  if (!emailConfigured()) return list.map(() => 'skipped');
  const e = env as Env, out: ('sent' | 'failed')[] = [];
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100);
    let ok = false;
    try {
      const r = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST', headers: {Authorization: 'Bearer ' + e.EMAIL_API_KEY, 'Content-Type': 'application/json'},
        body: JSON.stringify(chunk.map(m => ({from: e.MAIL_FROM, to: [m.to], subject: m.subject, text: m.text})))
      });
      ok = r.ok;
    } catch { ok = false; }
    out.push(...chunk.map(() => (ok ? 'sent' : 'failed') as 'sent' | 'failed'));
  }
  return out;
}
