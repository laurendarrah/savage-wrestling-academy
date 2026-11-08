// Launch checklist for the owner dashboard (issue #123). Shows, from the real records and the site's settings, what is
// ready and what is left before families use the site, each with the page that fixes it. Reads only; it changes
// nothing and never reveals a secret (only whether one is set). Issue #252: matches the Launch board (#246).
import {kindList} from './purchase-kinds';
import {publicSchedule} from './public-schedule';

type Settings = {APP_ORIGIN?: string; SUPABASE_URL?: string; SUPABASE_PUBLISHABLE_KEY?: string; EMAIL_API_KEY?: string; MAIL_FROM?: string;
  STRIPE_TEST_WEBHOOK_SECRET?: string; STRIPE_LIVE_WEBHOOK_SECRET?: string; STRIPE_MODE?: string; STRIPE_CONFIG_ENCRYPTION_KEY?: string;
  CHECKOUT_KINDS?: string; STAFF_MFA?: string};
// `action` names a one-click fix on the dashboard itself (publish-programs: save the default programs, issue #147).
export type Item = {key: string; group: string; label: string; status: 'done' | 'todo' | 'waiting' | 'info'; detail: string; href?: string; section?: string; action?: 'publish-programs'};

// Decisions and the attorney's review are tracked as GitHub issues, on the Launch board (#246), not on this checklist.
export const REPO_ISSUES = 'https://github.com/laurendarrah/savage-wrestling-academy/issues';
export const LAUNCH_BOARD = `${REPO_ISSUES}/246`;

const json = (v: unknown) => { try { return typeof v === 'string' ? JSON.parse(v) : null; } catch { return null; } };
const andList = (names: string[]) => names.length < 2 ? names.join('') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

// Every record the checklist reads, in one D1 batch (issue #274; it used to be 13 queries in a row). Each statement
// returns at most one row; a statement that fails (a table missing on a half-migrated database) reads as "nothing".
const READS = {
  academy: "SELECT payload FROM academy_state WHERE id='academy'",
  waiver: "SELECT title,retired_at FROM waiver_versions WHERE kind='waiver' ORDER BY published_at DESC, id DESC LIMIT 1",
  consent: "SELECT title,retired_at FROM waiver_versions WHERE kind='parent_consent' ORDER BY published_at DESC, id DESC LIMIT 1",
  contract: "SELECT title,retired_at FROM waiver_versions WHERE kind='coach_contract' ORDER BY published_at DESC, id DESC LIMIT 1",
  coaches: 'SELECT COUNT(*) AS n FROM staff_access WHERE active=1',
  invites: 'SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN expires_at<=? THEN 1 ELSE 0 END),0) AS expired FROM coach_invites WHERE used_at IS NULL AND revoked_at IS NULL',
  lessons: "SELECT payload FROM academy_settings WHERE id='lessons'",
  website: "SELECT payload FROM academy_settings WHERE id='website'",
  stripeKey: "SELECT updated_at FROM integration_secrets WHERE id='stripe-test'",
  liveKey: "SELECT updated_at FROM integration_secrets WHERE id='stripe-live'",
  backup: "SELECT created_at FROM security_events WHERE action='backup_exported' ORDER BY created_at DESC LIMIT 1",
  errors: 'SELECT COUNT(*) AS n FROM error_log WHERE at>=?',
  families: 'SELECT COUNT(*) AS n FROM family_accounts',
} as const;
type Reads = Record<keyof typeof READS, any>;
async function readAll(db: D1Database, nowIso: string, dayAgo: string): Promise<Reads> {
  const keys = Object.keys(READS) as (keyof typeof READS)[];
  const args: Record<string, unknown[]> = {invites: [nowIso], errors: [dayAgo]};
  const out = {} as Reads;
  try {
    const results = await db.batch(keys.map(k => db.prepare(READS[k]).bind(...(args[k] ?? []))));
    keys.forEach((k, i) => { out[k] = (results[i]?.results as any[] | undefined)?.[0] ?? null; });
  } catch {
    // One statement failing fails the batch; fall back to one query each, so the checklist still shows what it can.
    for (const k of keys) { try { out[k] = await db.prepare(READS[k]).bind(...(args[k] ?? [])).first(); } catch { out[k] = null; } }
  }
  return out;
}

// `authenticators` is how many verified authenticators the signed-in owner has (issue #167); left out, the item is skipped.
export async function launchChecklist(db: D1Database, settings: Settings, today: string, now = Date.now(), authenticators?: number): Promise<{items: Item[]; ready: number; total: number}> {
  const weekAgo = new Date(now - 7 * 86400000).toISOString(), dayAgo = new Date(now - 86400000).toISOString();
  const r = await readAll(db, new Date(now).toISOString(), dayAgo);
  const academy = json(r.academy?.payload) ?? {};
  const programs: any[] = Array.isArray(academy.programs) ? academy.programs : [];
  const seasons: any[] = Array.isArray(academy.seasons) ? academy.seasons : [];
  const waiver = r.waiver as {title: string; retired_at: string | null} | null, consent = r.consent as typeof waiver, contract = r.contract as typeof waiver;
  const coaches = Number(r.coaches?.n ?? 0);
  // Invites the owner sent from Coaches (#207) that are neither used nor canceled, as Coaches lists them.
  const pendingInvites = Number(r.invites?.n ?? 0), expiredInvites = Number(r.invites?.expired ?? 0);
  const lessons = json(r.lessons?.payload) ?? {};
  // The owner's public website content (#215). Until it is saved, the welcome page shows the defaults.
  const website = json(r.website?.payload);
  const headline = typeof website?.headline === 'string' ? website.headline.trim() : '';
  const stripeKey = r.stripeKey as {updated_at: string} | null, liveKey = r.liveKey as {updated_at: string} | null;
  const backup = r.backup as {created_at: string} | null;
  const errors = Number(r.errors?.n ?? 0);
  const families = Number(r.families?.n ?? 0);

  // The programs families see on the welcome page and calendar (the same three the registration catalog lists).
  const listed = programs.filter(p => ['Elementary', 'Intermediate', 'Advanced'].includes(p?.id));
  const priced = listed.filter(p => Number(p.priceCents) > 0 || Number(p.walkInPriceCents) > 0);
  // Names and upcoming camps, clinics and events exactly as the public calendar shows them.
  let shown: {programs: {id: string; name: string}[]; events: {type: string}[]} = {programs: [], events: []};
  try { shown = publicSchedule(academy, today.slice(0, 7), today); } catch {}
  const nameOf = (id: string) => shown.programs.find(p => p.id === id)?.name || id;
  // A program has practice times when one of its semesters has weekly practices and has not ended (current or upcoming).
  const hasTimes = (id: string) => seasons.some(s => s?.program === id && s.end >= today && (s.weekly ?? []).length);
  const noTimes = listed.filter(p => !hasTimes(p.id)).map(p => nameOf(p.id));
  const eventCounts = ['Camp', 'Clinic', 'Event'].map(t => [t, shown.events.filter(e => e.type === t).length] as const).filter(([, n]) => n);
  const lessonPrices = Object.values(lessons.prices ?? {}).filter(v => Number(v) > 0).length;
  const origin = settings.APP_ORIGIN?.trim() ?? '';
  const kinds = (settings.CHECKOUT_KINDS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  // Same rule as stripeMode() in lib/checkout-config.ts: live only when STRIPE_MODE is exactly "live" (#26).
  const live = settings.STRIPE_MODE === 'live';
  const emailMissing = [!settings.EMAIL_API_KEY && 'EMAIL_API_KEY', !settings.MAIL_FROM && 'MAIL_FROM'].filter(Boolean) as string[];
  const when = (iso: string) => new Date(iso).toLocaleDateString('en-US', {timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric'});
  const inviteNote = pendingInvites ? `${plural(pendingInvites, 'invite')} not accepted yet${expiredInvites ? ` (${expiredInvites} expired)` : ''}` : '';

  const items: Item[] = [
    !listed.length
      ? {key: 'programs', group: 'Academy', label: 'Programs on the welcome page and calendar', status: 'todo', action: 'publish-programs',
        detail: 'Families see no programs yet. Publish SWA Development, SWA Intermediate and SWA Advance with the prices under Programs & pricing'}
      : {key: 'programs', group: 'Academy', label: 'Programs on the welcome page and calendar', section: 'Programs & pricing',
        status: priced.length ? 'done' : 'todo',
        detail: priced.length ? `${plural(listed.length, 'program')} listed, ${priced.length} with prices` : 'Listed without prices. Set a membership or walk-in price for each program'},
    {key: 'schedule', group: 'Academy', label: 'Practice schedule', section: 'Schedules',
      status: listed.length && !noTimes.length ? 'done' : 'todo',
      detail: !listed.length ? 'Publish the programs, then add weekly practices so families can see and book them'
        : noTimes.length ? `${andList(noTimes)} ${noTimes.length === 1 ? 'has' : 'have'} no practice times yet. Add a semester under Schedules`
        : `Practice times for ${andList(listed.map(p => nameOf(p.id)))}`},
    {key: 'events', group: 'Academy', label: 'Camps and events', section: 'Camps & events', status: 'info',
      detail: eventCounts.length ? `${andList(eventCounts.map(([t, n]) => plural(n, t.toLowerCase())))} coming up` : 'No upcoming camps, clinics or events. Add them under Camps & events'},
    {key: 'website', group: 'Academy', label: 'Public website', href: '/website', status: headline ? 'done' : 'todo',
      detail: headline ? `Saved, with the headline “${headline}”` : 'Write your public website: the welcome page headline, introduction and mission, and the team page'},
    {key: 'waiver', group: 'Academy', label: 'Waiver', href: '/waivers',
      status: waiver && !waiver.retired_at ? 'done' : 'todo', detail: waiver && !waiver.retired_at ? `“${waiver.title}” is published` : 'Publish the approved waiver. Families cannot book until they sign it'},
    // Decision Q15 on #197: families also sign the Parent Consent Form, which waits for the attorney's review (issue #195).
    {key: 'consent', group: 'Academy', label: 'Parent Consent Form', href: '/consent-forms',
      status: consent && !consent.retired_at ? 'done' : 'todo', detail: consent && !consent.retired_at ? `“${consent.title}” is published` : 'Publish the Parent Consent Form (after attorney review). Until then families can book without it'},
    {key: 'coaches', group: 'Academy', label: 'Coach access', href: '/staff', status: coaches ? 'done' : 'todo',
      detail: (coaches ? `${plural(coaches, 'coach', 'coaches')} can sign in` : 'Give each coach access to their programs') + (inviteNote ? `. ${inviteNote}` : '')},
    // Coach contracts (decision Q17 on #197) are not a launch requirement, so this is counted only once published.
    {key: 'contract', group: 'Academy', label: 'Coach contract', href: '/contracts', status: contract && !contract.retired_at ? 'done' : 'info',
      detail: contract && !contract.retired_at ? `“${contract.title}” is published` : 'Publish the coach contract when it is ready. Coaches then see a to-do on coach home until they sign'},
    {key: 'lessons', group: 'Academy', label: 'Private lesson prices', href: '/lesson-settings',
      status: lessonPrices ? 'done' : 'todo', detail: lessonPrices ? `${plural(lessonPrices, 'lesson type')} priced` : 'Set lesson prices so families can book coach openings'},
    {key: 'address', group: 'Site', label: 'Site address', status: /^https:\/\/|^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin) ? 'done' : 'todo',
      detail: origin ? (/^http:\/\/(?!127\.0\.0\.1|localhost)/.test(origin) ? `${origin} must start with https://` : `Email links point to ${origin}`) : 'The site address is not set, so sign-up and password emails cannot be sent. Ask whoever maintains the site to set it'},
    {key: 'signin', group: 'Site', label: 'Family and staff sign-in', status: settings.SUPABASE_URL && settings.SUPABASE_PUBLISHABLE_KEY ? 'done' : 'todo',
      detail: settings.SUPABASE_URL && settings.SUPABASE_PUBLISHABLE_KEY ? 'Connected' : 'Sign-in is not connected'},
    // Justin sets up Resend on his own account (decided on #35); docs/RUNBOOK.md has the exact settings.
    {key: 'email', group: 'Site', label: 'Email notices', status: emailMissing.length ? 'waiting' : 'done',
      detail: !emailMissing.length ? `Sent from ${settings.MAIL_FROM}`
        : `Set up Resend on your account, then add its settings in Supabase and Cloudflare: Resend’s SMTP details under Supabase Authentication → Emails, and ${andList(emailMissing)} on the site in Cloudflare. Until then notices go to each family’s Messages inbox`},
    // Justin creates the Stripe account and its restricted key (#26). Card fees need the key's Balance (read) permission (#225).
    {key: 'stripe', group: 'Payments', label: 'Stripe test connection', href: '/payment-setup',
      status: stripeKey && settings.STRIPE_TEST_WEBHOOK_SECRET ? 'done' : 'todo',
      detail: stripeKey && settings.STRIPE_TEST_WEBHOOK_SECRET ? `Test key saved ${when(stripeKey.updated_at)}. Card fees need its Balance (read) permission`
        : stripeKey ? 'Test key saved. Whoever maintains the site still needs to add the Stripe webhook secret'
        : 'Create your Stripe account and save a restricted test key on Online payment setup. Give the key the Balance (read) permission so the site can read card fees'},
    {key: 'checkout', group: 'Payments', label: 'Online payment', href: '/payment-setup', status: kinds.length ? 'done' : 'info',
      detail: kinds.length ? `Open for ${kindList(kinds)}` : 'Closed. Families pay at the academy and you record it on Payments. Each purchase type opens after its terms are decided'},
    // Live charging needs live mode, a restricted live key saved on Online payment setup, and the live webhook secret.
    // Test and live keys and secrets stay separate: nothing here reads the test ones for live.
    !live
      ? {key: 'live', group: 'Payments', label: 'Live payments', href: '/payment-setup', status: 'info',
        detail: 'Test mode, so no real card is charged. Switch to live when you’re ready (#26)'}
      : {key: 'live', group: 'Payments', label: 'Live payments', href: '/payment-setup', status: liveKey && settings.STRIPE_LIVE_WEBHOOK_SECRET ? 'done' : 'todo',
        detail: liveKey && settings.STRIPE_LIVE_WEBHOOK_SECRET ? `Live. Live key saved ${when(liveKey.updated_at)}`
          : liveKey ? 'Live key saved. Whoever maintains the site still needs to add the live Stripe webhook secret'
          : 'The site is in live mode. Save a restricted live key on Online payment setup'},
    {key: 'backup', group: 'Safety', label: 'Recent backup', href: '/backups', status: backup && backup.created_at >= weekAgo ? 'done' : 'todo',
      detail: backup ? `Last downloaded ${when(backup.created_at)}${backup.created_at >= weekAgo ? '' : '. Download a fresh one'}` : 'Download an encrypted backup and keep it somewhere safe'},
    ...(authenticators === undefined ? [] : [{key: 'authenticator', group: 'Safety', label: 'Backup authenticator', href: '/security',
      status: authenticators >= 2 ? 'done' as const : 'todo' as const,
      detail: authenticators >= 2 ? `${authenticators} authenticators can open the dashboard` : 'Add a second authenticator, on another phone or in a password manager, so a lost phone can’t lock you out'}]),
    ...(String(settings.STAFF_MFA ?? '').trim().toLowerCase() === 'off' ? [{key: 'mfa-off', group: 'Safety', label: 'Authenticator sign-in is turned off', status: 'todo' as const,
      detail: 'Anyone with the owner or a coach password can sign in without an authenticator code. Before families join, ask whoever maintains the site to delete the STAFF_MFA setting in Cloudflare'}] : []),
    {key: 'health', group: 'Safety', label: 'Site health', href: '/site-health', status: errors ? 'todo' : 'done',
      detail: errors ? `${errors} site error${errors === 1 ? '' : 's'} in the last 24 hours` : 'No site errors in the last 24 hours'},
    {key: 'families', group: 'Families', label: 'Families signed up', href: '/accounts', status: 'info', detail: `${families} famil${families === 1 ? 'y' : 'ies'}`},
    // Membership terms, the refund policy and the attorney's review are decisions, not data, so they stay off the list.
    {key: 'decisions', group: 'Launch', label: 'Decisions and attorney review', href: LAUNCH_BOARD, status: 'info',
      detail: 'See the Launch board in GitHub for membership terms, the refund policy and the attorney’s review'},
  ];
  const counted = items.filter(i => i.status === 'done' || i.status === 'todo');
  return {items, ready: counted.filter(i => i.status === 'done').length, total: counted.length};
}
