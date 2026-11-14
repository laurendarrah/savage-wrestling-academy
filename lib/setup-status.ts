// Owner setup progress for whoever maintains the site (issue #298). Public and read-only: for each setup step on the
// owner's launch checklist, only whether it is done, plus whether Stripe keys are saved, the Stripe mode and which
// purchase types are open (families can see those anyway). Never a name, title, date, count, email address or value,
// and nothing about sign-in safety (authenticators, the STAFF_MFA switch, errors) or how many families have joined.
import {launchChecklist} from './launch-checklist';
import {kindList} from './purchase-kinds';

// Checklist items shown, in the dashboard's order. Anything not listed here stays off, including new items.
export const SETUP_STEPS = ['programs', 'schedule', 'website', 'waiver', 'consent', 'coaches', 'contract', 'lessons', 'email', 'stripe', 'checkout', 'live', 'backup'] as const;

type Settings = Parameters<typeof launchChecklist>[1];

export async function setupStatus(db: D1Database, settings: Settings, today: string, now = Date.now()) {
  const {items} = await launchChecklist(db, settings, today, now);
  const steps: Record<string, boolean> = {};
  for (const key of SETUP_STEPS) { const item = items.find(i => i.key === key); if (item) steps[key] = item.status === 'done'; }
  const saved = async (id: string) => { try { return !!(await db.prepare('SELECT 1 AS ok FROM integration_secrets WHERE id=?').bind(id).first()); } catch { return false; } };
  const kinds = (settings.CHECKOUT_KINDS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  // The latest reason a family's card checkout couldn't start, in the last day (issue #319): the site's own short
  // wording from lib/stripe-key-check.ts (an error type, a permission or field name), never a key, date or person.
  let checkoutProblem: string | null = null;
  try {
    const row = await db.prepare("SELECT at,message FROM error_log WHERE path='/api/checkout' AND status=502 AND at>=? AND message LIKE 'Card checkout could not start: %' ORDER BY at DESC LIMIT 1")
      .bind(new Date(now - 86400000).toISOString()).first<{at: string; message: string}>();
    // Not once a checkout has started at Stripe since (issue #333): the problem is fixed, so the old reason would mislead.
    const since = row ? await db.prepare('SELECT 1 AS ok FROM orders WHERE stripe_session_id IS NOT NULL AND created_at>? LIMIT 1').bind(row.at).first() : null;
    const m = since ? null : row?.message.match(/^Card checkout could not start: ([A-Za-z0-9 ,.:()_\[\]-]{1,240}?)\. Check the key/);
    checkoutProblem = m ? m[1] : null;
  } catch { checkoutProblem = null; }
  // Which Stripe notices arrived in the last day and what the site did with each (issue #337): the event type, the site's
  // own outcome word and a count. Never an id, an amount or a person. Shows at a glance whether, say, a refund notice
  // arrived at all.
  let webhooks: {type: string; outcome: string; count: number}[] = [];
  try {
    const rows = (await db.prepare('SELECT type,outcome,COUNT(*) AS n FROM stripe_events WHERE received_at>=? GROUP BY type,outcome ORDER BY MAX(received_at) DESC LIMIT 30')
      .bind(new Date(now - 86400000).toISOString()).all<{type: string; outcome: string; n: number}>()).results;
    const safe = (v: string) => /^[A-Za-z0-9_.:-]{1,80}$/.test(v) ? v : 'other';
    webhooks = rows.map(r => ({type: safe(String(r.type)), outcome: safe(String(r.outcome)), count: Number(r.n)}));
  } catch { webhooks = []; }
  return {
    steps,
    stripe: {
      mode: settings.STRIPE_MODE === 'live' ? 'live' : 'test',
      // The test key is saved only after the owner confirms its account on Online payment setup (#255).
      testKey: await saved('stripe-test'),
      testWebhook: !!settings.STRIPE_TEST_WEBHOOK_SECRET,
      liveKey: await saved('stripe-live'),
      liveWebhook: !!settings.STRIPE_LIVE_WEBHOOK_SECRET,
      checkoutProblem,
      webhooks,
    },
    checkoutOpen: kinds.length ? kindList(kinds) : 'nothing',
  };
}
