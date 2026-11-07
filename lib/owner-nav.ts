// Every owner destination, in one place (issue #261). The owner shell's sidebar on every owner page
// (lib/owner-shell.ts) and the dashboard's "Run the academy" card (app/portal.html, through /portal-workspace.js) are
// both drawn from this list, so they cannot drift apart. An item opens a tool page, or a dashboard section through a
// deep link such as /#programs. Pages that belong to an item without being in the list (a coach's lesson openings, the
// practice plan editor) name it in `also`, so the sidebar still marks where the owner is.

export type OwnerNavItem = {
  href: string;
  label: string;
  // The dashboard section a deep link opens (app/portal.html's page names).
  section?: string;
  // Other owner pages that light this item.
  also?: string[];
  // The daily tiles' line on the dashboard.
  blurb?: string;
  // Opens a page outside the owner shell (Coach view is the coach home).
  leaves?: boolean;
};
export type OwnerNavGroup = {label: string; items: OwnerNavItem[]; folded?: boolean};

export const OWNER_NAV: OwnerNavGroup[] = [
  {label: '', items: [{href: '/', label: 'Dashboard', section: 'Dashboard'}]},
  {label: 'Every day', items: [
    {href: '/roster', label: 'Roster & check-in', blurb: 'Who has paid for each session. Check wrestlers in at the door.'},
    {href: '/payments', label: 'Payments', blurb: 'Every payment, online and offline. Record cash or check.'},
    {href: '/messages', label: 'Messages', blurb: 'Announcements and private conversations with families.'},
    {href: '/cards', label: 'USA Wrestling cards', blurb: 'Missing or expired cards block booking.'},
  ]},
  {label: 'Families', items: [
    {href: '/accounts', label: 'Family accounts', also: ['/account-setup']},
    {href: '/approvals', label: 'SWA Advance approvals'},
    {href: '/scholarships', label: 'Scholarships'},
    {href: '/waivers', label: 'Waivers'},
    {href: '/consent-forms', label: 'Parent Consent Form'},
    {href: '/transfers', label: 'Program transfers'},
  ]},
  {label: 'Schedule & programs', items: [
    {href: '/#practice-calendar', label: 'Practice calendar', section: 'Calendar', also: ['/practice-plans']},
    {href: '/#schedules', label: 'Practice schedules', section: 'Schedules'},
    {href: '/#programs', label: 'Programs & pricing', section: 'Programs & pricing'},
    {href: '/#events', label: 'Camps & events', section: 'Camps & events'},
    {href: '/curricula', label: 'Curricula'},
    {href: '/website', label: 'Public website'},
  ]},
  {label: 'Coaches & lessons', items: [
    {href: '/staff', label: 'Coaches', also: ['/coach-openings', '/coach-profile']},
    {href: '/coach', label: 'Coach view', leaves: true},
    {href: '/contracts', label: 'Coach contracts'},
    {href: '/lesson-settings', label: 'Private lesson prices'},
    {href: '/timesheets', label: 'Coach hours'},
  ]},
  {label: 'Money', items: [
    {href: '/financials', label: 'Income & expenses'},
    {href: '/coach-pay', label: 'Coach pay'},
  ]},
  {label: 'Settings & records', folded: true, items: [
    {href: '/payment-setup', label: 'Online payment setup'},
    {href: '/backups', label: 'Backups'},
    {href: '/site-health', label: 'Site health'},
    {href: '/data-requests', label: 'Data requests'},
    {href: '/security-log', label: 'Security activity'},
    {href: '/help/owner', label: 'Owner guide'},
  ]},
];

export const OWNER_NAV_ITEMS: OwnerNavItem[] = OWNER_NAV.flatMap(g => g.items);

// Every page shown in the owner shell, by path: a move between two of them is a View Transition; a move anywhere else
// (Coach view, what families see) is an ordinary page load.
export const OWNER_SHELL_PAGES: string[] = [...new Set([
  ...OWNER_NAV_ITEMS.filter(i => !i.leaves).map(i => i.href.split('#')[0] || '/'),
  ...OWNER_NAV_ITEMS.flatMap(i => i.also ?? []),
  '/security',
])];

// The item to mark as the current page. The server sees only the path, so on the dashboard it marks Dashboard and
// the page corrects it from the address's #section before it is drawn (lib/owner-shell.ts). Null for an owner page
// outside the list (Account security, in the Account menu).
export function currentOwnerHref(pathname: string, hash = ''): string | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/') {
    const section = hash.split('?')[0];
    return section.length > 1 && OWNER_NAV_ITEMS.some(i => i.href === '/' + section) ? '/' + section : '/';
  }
  return OWNER_NAV_ITEMS.find(i => i.href === path || i.also?.includes(path))?.href ?? null;
}

// The group and item an address belongs to, for the header's breadcrumb.
export function ownerNavPlace(href: string | null): {group: string; label: string} | null {
  for (const g of OWNER_NAV) for (const i of g.items) if (i.href === href) return {group: g.label, label: i.label};
  return null;
}
