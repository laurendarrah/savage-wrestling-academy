// Every owner destination, in one place (issue #261). The owner shell's sidebar on every owner page
// (lib/owner-shell.ts) and the dashboard (app/portal.html, through /portal-workspace.js) are both drawn from this list,
// so they cannot drift apart. An item opens a tool page, or a dashboard section through a deep link such as /#programs.
//
// Phase 4 of the redesign (issue #283) folded the list to about fourteen items in four groups. Pages that merged into
// one item keep their own addresses: an item names them in `also` (the sidebar then marks the item), and `tabs` draws a
// switch between them under the page's title row. A dashboard section that lost its own sidebar item (/#schedules,
// /#events) keeps its deep link as a hidden item `under` the one that shows it.

export type OwnerNavTab = {href: string; label: string};
export type OwnerNavItem = {
  href: string;
  label: string;
  // The dashboard section a deep link opens (app/portal.html's page names).
  section?: string;
  // Other owner pages that light this item.
  also?: string[];
  // A short line about the destination (the owner guide uses it).
  blurb?: string;
  // Opens a page outside the owner shell (Coach view is the coach home).
  leaves?: boolean;
  // Not drawn in the sidebar: a deep link shown under this other item's href.
  under?: string;
  // The switch drawn under the title row on this item's pages (the item's own page first).
  tabs?: OwnerNavTab[];
};
export type OwnerNavGroup = {label: string; items: OwnerNavItem[]; folded?: boolean};

const DOCUMENT_TABS: OwnerNavTab[] = [
  {href: '/cards', label: 'USA Wrestling cards'}, {href: '/waivers', label: 'Waiver'}, {href: '/consent-forms', label: 'Parent Consent Form'}, {href: '/contracts', label: 'Coach contract'},
];
const APPROVAL_TABS: OwnerNavTab[] = [{href: '/approvals', label: 'SWA Advance approvals'}, {href: '/scholarships', label: 'Scholarships'}, {href: '/transfers', label: 'Program transfers'}];
const ACADEMY_TABS: OwnerNavTab[] = [{href: '/#programs', label: 'Programs & pricing'}, {href: '/#schedules', label: 'Schedules'}, {href: '/#events', label: 'Camps & events'}];
const COACH_TABS: OwnerNavTab[] = [{href: '/staff', label: 'Coaches'}, {href: '/lesson-settings', label: 'Private lesson prices'}, {href: '/timesheets', label: 'Coach hours'}, {href: '/coach', label: 'Coach view'}];
const MONEY_TABS: OwnerNavTab[] = [{href: '/financials', label: 'Income & expenses'}, {href: '/coach-pay', label: 'Coach pay'}];
const CALENDAR_TABS: OwnerNavTab[] = [{href: '/#practice-calendar', label: 'Practice calendar'}, {href: '/curricula', label: 'Curricula'}];

export const OWNER_NAV: OwnerNavGroup[] = [
  {label: 'Today', items: [
    {href: '/', label: 'Dashboard', section: 'Dashboard'},
    {href: '/roster', label: 'Roster & check-in', blurb: 'Who has paid for each session. Check wrestlers in at the door.'},
    {href: '/payments', label: 'Payments', blurb: 'Every payment, online and offline. Record cash or check.'},
    {href: '/messages', label: 'Messages', blurb: 'Announcements and private conversations with families.'},
  ]},
  {label: 'Families', items: [
    {href: '/accounts', label: 'Families', also: ['/account-setup'], blurb: 'Every family and wrestler, with their approvals and transfers.'},
    {href: '/cards', label: 'Cards & documents', also: ['/waivers', '/consent-forms', '/contracts'], tabs: DOCUMENT_TABS, blurb: 'USA Wrestling cards, the waiver, the Parent Consent Form and coach contracts.'},
    {href: '/approvals', label: 'Approvals & scholarships', also: ['/scholarships', '/transfers'], tabs: APPROVAL_TABS, blurb: 'SWA Advance approvals, scholarships and program transfers.'},
  ]},
  {label: 'Academy', items: [
    {href: '/#practice-calendar', label: 'Calendar & plans', section: 'Calendar', also: ['/practice-plans', '/curricula'], tabs: CALENDAR_TABS},
    {href: '/#programs', label: 'Programs, schedules & events', section: 'Programs & pricing', tabs: ACADEMY_TABS},
    {href: '/#schedules', label: 'Schedules', section: 'Schedules', under: '/#programs'},
    {href: '/#events', label: 'Camps & events', section: 'Camps & events', under: '/#programs'},
    {href: '/staff', label: 'Coaches & lessons', also: ['/coach-openings', '/coach-profile', '/lesson-settings', '/timesheets'], tabs: COACH_TABS},
    {href: '/financials', label: 'Money', also: ['/coach-pay'], tabs: MONEY_TABS},
    {href: '/website', label: 'Public website'},
  ]},
  {label: 'Settings & records', folded: true, items: [
    {href: '/coach', label: 'Coach view', leaves: true},
    {href: '/payment-setup', label: 'Online payment setup'},
    {href: '/backups', label: 'Backups'},
    {href: '/site-health', label: 'Site health'},
    {href: '/data-requests', label: 'Data requests'},
    {href: '/security-log', label: 'Security activity'},
    {href: '/help/owner', label: 'Owner guide'},
  ]},
];

export const OWNER_NAV_ITEMS: OwnerNavItem[] = OWNER_NAV.flatMap(g => g.items);
// The items the sidebar draws (hidden section aliases stay out).
export const OWNER_NAV_SHOWN: OwnerNavItem[] = OWNER_NAV_ITEMS.filter(i => !i.under);

// Every page shown in the owner shell, by path: a move between two of them is a View Transition; a move anywhere else
// (Coach view, what families see) is an ordinary page load.
export const OWNER_SHELL_PAGES: string[] = [...new Set([
  ...OWNER_NAV_ITEMS.filter(i => !i.leaves).map(i => i.href.split('#')[0] || '/'),
  ...OWNER_NAV_ITEMS.flatMap(i => i.also ?? []),
  '/security',
])];

// The sidebar item to mark as the current page. The server sees only the path, so on the dashboard it marks Dashboard
// and the page corrects it from the address's #section before it is drawn (lib/owner-shell.ts). A hidden section
// (/#schedules) marks the item it sits under. Null for an owner page outside the list (Account security).
export function currentOwnerHref(pathname: string, hash = ''): string | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/') {
    const section = hash.split('?')[0];
    const item = section.length > 1 ? OWNER_NAV_ITEMS.find(i => i.href === '/' + section) : null;
    return item ? item.under ?? item.href : '/';
  }
  const item = OWNER_NAV_ITEMS.find(i => i.href === path || i.also?.includes(path));
  return item ? item.under ?? item.href : null;
}

// The group and item an address belongs to, for the header's breadcrumb. The dashboard stands alone ("Dashboard").
export function ownerNavPlace(href: string | null): {group: string; label: string} | null {
  for (const g of OWNER_NAV) for (const i of g.items) if (i.href === href) return {group: href === '/' ? '' : g.label, label: i.label};
  return null;
}

// The switch to draw under a page's title row: the tabs of the item this address belongs to, when it has any.
export function ownerNavTabs(pathname: string, hash = ''): OwnerNavTab[] {
  const current = currentOwnerHref(pathname, hash);
  return OWNER_NAV_ITEMS.find(i => i.href === current)?.tabs ?? [];
}
