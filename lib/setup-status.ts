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
  return {
    steps,
    stripe: {
      mode: settings.STRIPE_MODE === 'live' ? 'live' : 'test',
      // The test key is saved only after the owner confirms its account on Online payment setup (#255).
      testKey: await saved('stripe-test'),
      testWebhook: !!settings.STRIPE_TEST_WEBHOOK_SECRET,
      liveKey: await saved('stripe-live'),
      liveWebhook: !!settings.STRIPE_LIVE_WEBHOOK_SECRET,
    },
    checkoutOpen: kinds.length ? kindList(kinds) : 'nothing',
  };
}
