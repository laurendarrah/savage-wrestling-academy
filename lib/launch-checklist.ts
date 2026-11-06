// Launch checklist for the owner dashboard (issue #123). Shows, from the real records and the site's settings, what is
// ready and what is left before families use the site, each with the page that fixes it. Reads only; it changes
// nothing and never reveals a secret (only whether one is set).
import {kindList} from './purchase-kinds';

type Settings = {APP_ORIGIN?: string; SUPABASE_URL?: string; SUPABASE_PUBLISHABLE_KEY?: string; EMAIL_API_KEY?: string; MAIL_FROM?: string;
  STRIPE_TEST_WEBHOOK_SECRET?: string; STRIPE_CONFIG_ENCRYPTION_KEY?: string; CHECKOUT_KINDS?: string};
// `action` names a one-click fix on the dashboard itself (publish-programs: save the default programs, issue #147).
export type Item = {key: string; group: string; label: string; status: 'done' | 'todo' | 'waiting' | 'info'; detail: string; href?: string; section?: string; action?: 'publish-programs'};

const json = (v: unknown) => { try { return typeof v === 'string' ? JSON.parse(v) : null; } catch { return null; } };

// `authenticators` is how many verified authenticators the signed-in owner has (issue #167); left out, the item is skipped.
export async function launchChecklist(db: D1Database, settings: Settings, today: string, now = Date.now(), authenticators?: number): Promise<{items: Item[]; ready: number; total: number}> {
  const first = async <T>(sql: string, ...args: unknown[]) => { try { return await db.prepare(sql).bind(...args).first<T>(); } catch { return null; } };
  const academy = json((await first<{payload: string}>("SELECT payload FROM academy_state WHERE id='academy'"))?.payload) ?? {};
  const programs: any[] = Array.isArray(academy.programs) ? academy.programs : [];
  const seasons: any[] = Array.isArray(academy.seasons) ? academy.seasons : [];
  const waiver = await first<{title: string; retired_at: string | null}>('SELECT title,retired_at FROM waiver_versions ORDER BY published_at DESC, id DESC LIMIT 1');
  const coaches = Number((await first<{n: number}>('SELECT COUNT(*) AS n FROM staff_access WHERE active=1'))?.n ?? 0);
  const lessons = json((await first<{payload: string}>("SELECT payload FROM academy_settings WHERE id='lessons'"))?.payload) ?? {};
  const stripeKey = await first<{updated_at: string}>("SELECT updated_at FROM integration_secrets WHERE id='stripe-test'");
  const weekAgo = new Date(now - 7 * 86400000).toISOString(), dayAgo = new Date(now - 86400000).toISOString();
  const backup = await first<{created_at: string}>("SELECT created_at FROM security_events WHERE action='backup_exported' ORDER BY created_at DESC LIMIT 1");
  const errors = Number((await first<{n: number}>('SELECT COUNT(*) AS n FROM error_log WHERE at>=?', dayAgo))?.n ?? 0);
  const families = Number((await first<{n: number}>('SELECT COUNT(*) AS n FROM family_accounts'))?.n ?? 0);

  // The programs families see on the welcome page and calendar (the same three the registration catalog lists).
  const listed = programs.filter(p => ['Elementary', 'Intermediate', 'Advanced'].includes(p?.id));
  const priced = listed.filter(p => Number(p.priceCents) > 0 || Number(p.walkInPriceCents) > 0);
  const current = seasons.filter(s => s.end >= today && (s.weekly ?? []).length);
  const lessonPrices = Object.values(lessons.prices ?? {}).filter(v => Number(v) > 0).length;
  const origin = settings.APP_ORIGIN?.trim() ?? '';
  const kinds = (settings.CHECKOUT_KINDS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const when = (iso: string) => new Date(iso).toLocaleDateString('en-US', {timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric'});

  const items: Item[] = [
    !listed.length
      ? {key: 'programs', group: 'Academy', label: 'Programs on the welcome page and calendar', status: 'todo', action: 'publish-programs',
        detail: 'Families see no programs yet. Publish SWA Development, SWA Intermediate and SWA Advance with the prices under Programs & pricing'}
      : {key: 'programs', group: 'Academy', label: 'Programs on the welcome page and calendar', section: 'Programs & pricing',
        status: priced.length ? 'done' : 'todo',
        detail: priced.length ? `${listed.length} program${listed.length === 1 ? '' : 's'} listed, ${priced.length} with prices` : 'Listed without prices. Set a membership or walk-in price for each program'},
    {key: 'schedule', group: 'Academy', label: 'Practice schedule', section: 'Schedules',
      status: current.length ? 'done' : 'todo', detail: current.length ? `${current.length} program schedule${current.length === 1 ? '' : 's'} published` : 'Publish weekly practices so families can see and book them'},
    {key: 'waiver', group: 'Academy', label: 'Waiver', href: '/waivers',
      status: waiver && !waiver.retired_at ? 'done' : 'todo', detail: waiver && !waiver.retired_at ? `“${waiver.title}” is published` : 'Publish the approved waiver. Families cannot book until they sign it'},
    {key: 'coaches', group: 'Academy', label: 'Coach access', href: '/staff',
      status: coaches ? 'done' : 'todo', detail: coaches ? `${coaches} coach${coaches === 1 ? '' : 'es'} can sign in` : 'Give each coach access to their programs'},
    {key: 'lessons', group: 'Academy', label: 'Private lesson prices', href: '/lesson-settings',
      status: lessonPrices ? 'done' : 'todo', detail: lessonPrices ? `${lessonPrices} lesson type${lessonPrices === 1 ? '' : 's'} priced` : 'Set lesson prices so families can book coach openings'},
    {key: 'address', group: 'Site', label: 'Site address', status: /^https:\/\/|^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin) ? 'done' : 'todo',
      detail: origin ? (/^http:\/\/(?!127\.0\.0\.1|localhost)/.test(origin) ? `${origin} must start with https://` : `Email links point to ${origin}`) : 'The site address is not set, so sign-up and password emails cannot be sent. Ask whoever maintains the site to set it'},
    {key: 'signin', group: 'Site', label: 'Family and staff sign-in', status: settings.SUPABASE_URL && settings.SUPABASE_PUBLISHABLE_KEY ? 'done' : 'todo',
      detail: settings.SUPABASE_URL && settings.SUPABASE_PUBLISHABLE_KEY ? 'Connected' : 'Sign-in is not connected'},
    {key: 'email', group: 'Site', label: 'Email notices', status: settings.EMAIL_API_KEY && settings.MAIL_FROM ? 'done' : 'waiting',
      detail: settings.EMAIL_API_KEY && settings.MAIL_FROM ? `Sent from ${settings.MAIL_FROM}` : 'Notices go to each family’s Messages inbox. Email starts once an email service is chosen and set up'},
    {key: 'stripe', group: 'Payments', label: 'Stripe test connection', href: '/payment-setup',
      status: stripeKey && settings.STRIPE_TEST_WEBHOOK_SECRET ? 'done' : 'todo',
      detail: stripeKey && settings.STRIPE_TEST_WEBHOOK_SECRET ? `Test key saved ${when(stripeKey.updated_at)}` : stripeKey ? 'Test key saved. Whoever maintains the site still needs to add the Stripe webhook secret' : 'Save the Stripe test key on Online payment setup'},
    {key: 'checkout', group: 'Payments', label: 'Online payment', href: '/payment-setup', status: kinds.length ? 'done' : 'info',
      detail: kinds.length ? `Open for ${kindList(kinds)}` : 'Closed. Families pay at the academy and you record it on Payments. Each purchase type opens after its terms are decided'},
    {key: 'backup', group: 'Safety', label: 'Recent backup', href: '/backups', status: backup && backup.created_at >= weekAgo ? 'done' : 'todo',
      detail: backup ? `Last downloaded ${when(backup.created_at)}${backup.created_at >= weekAgo ? '' : '. Download a fresh one'}` : 'Download an encrypted backup and keep it somewhere safe'},
    ...(authenticators === undefined ? [] : [{key: 'authenticator', group: 'Safety', label: 'Backup authenticator', href: '/security',
      status: authenticators >= 2 ? 'done' as const : 'todo' as const,
      detail: authenticators >= 2 ? `${authenticators} authenticators can open the dashboard` : 'Add a second authenticator, on another phone or in a password manager, so a lost phone can’t lock you out'}]),
    {key: 'health', group: 'Safety', label: 'Site health', href: '/site-health', status: errors ? 'todo' : 'done',
      detail: errors ? `${errors} server error${errors === 1 ? '' : 's'} in the last 24 hours` : 'No server errors in the last 24 hours'},
    {key: 'families', group: 'Families', label: 'Families signed up', href: '/accounts', status: 'info', detail: `${families} famil${families === 1 ? 'y' : 'ies'}`},
  ];
  const counted = items.filter(i => i.status === 'done' || i.status === 'todo');
  return {items, ready: counted.filter(i => i.status === 'done').length, total: counted.length};
}
