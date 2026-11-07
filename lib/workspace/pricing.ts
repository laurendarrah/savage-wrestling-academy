// Prices the owner sets in the workspace (issue #45): program memberships and walk-ins, additional practices and team
// codes. These only check and store what the owner typed in the settings document; the server checks every save
// (lib/academy-validation.ts). What a family pays is always worked out on the server, in lib/quotes.ts, never here.
import type {Checked, ExtraPractice, FormList, FormValues, Program, TeamCode} from './types';

// The highest price the settings document accepts, in cents ($10,000).
export const MAX_PRICE_CENTS = 1000000;

// "$1,234.50".
export function formatDollars(dollars: unknown): string {
  return new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2}).format(Number(dollars));
}

// Cents as dollars. A program saved without a price shows the starter $200.00.
export function formatPrice(cents: number | null | undefined): string {
  return formatDollars((cents ?? 20000) / 100);
}

// What the owner typed in a dollars box, in whole cents.
export function centsFromDollars(text: unknown): number {
  return Math.round(Number(text) * 100);
}

// A price box's value: "225.00".
export function dollarsText(cents: number): string {
  return (cents / 100).toFixed(2);
}

const validCents = (n: number) => Number.isFinite(n) && n >= 0 && n <= MAX_PRICE_CENTS;

// Programs & pricing: a name and a monthly price, and a walk-in price or none. Other fields stay as saved.
export function programFromForm(saved: Program, form: FormValues): Checked<Program> {
  const v = form as Record<string, string>, priceCents = centsFromDollars(v.price);
  if (!v.name.trim() || !validCents(priceCents)) return {error: 'Enter a valid name and price.'};
  const walkInPriceCents = v.walkInPrice === '' ? undefined : centsFromDollars(v.walkInPrice);
  if (walkInPriceCents !== undefined && !validCents(walkInPriceCents)) return {error: 'Enter a valid walk-in price.'};
  return {value: {...saved, walkInPriceCents, name: v.name.trim(), grades: v.grades.trim(), description: v.description.trim(), priceCents}};
}

// Additional practices: a name, 1 to 366 dates, a start before the end, and member and non-member prices per date.
export function extraPracticeFromForm(form: FormValues, dates: string[], id: () => string): Checked<ExtraPractice> {
  const f = form as Record<string, string>, memberCents = centsFromDollars(f.member), nonMemberCents = centsFromDollars(f.nonMember);
  if (!f.name.trim() || f.name.length > 120 || !dates.length || dates.length > 366 || !f.start || !f.end || f.start >= f.end || [memberCents, nonMemberCents].some(n => !Number.isInteger(n) || n < 0 || n > MAX_PRICE_CENTS))
    return {error: 'Enter a practice name, select dates, and check the times and prices.'};
  return {value: {id: id(), name: f.name.trim(), gradeRange: (f.gradeRange ?? '').trim(), description: (f.description ?? '').trim(), dates, start: f.start, end: f.end, memberCents, nonMemberCents, enabled: f.enabled === 'on'}};
}

// Two shown practices with the same name and start time can't share a date.
export function extraPracticeClash(list: readonly ExtraPractice[], v: ExtraPractice): boolean {
  return list.some(p => p.id !== v.id && p.enabled && v.enabled && p.name === v.name && p.start === v.start && p.dates.some(d => v.dates.includes(d)));
}

// Team codes: a team name, a code of 3 to 32 letters, numbers or hyphens (not case-sensitive, unique), a whole
// 1 to 100 percent off and at least one program. At most 200 codes. index is the code being edited, or -1.
export function teamCodeFromForm(fields: FormList, codes: readonly TeamCode[], index: number, programIds: readonly string[], newId: () => string = () => crypto.randomUUID()): Checked<TeamCode> {
  const name = String(fields.get('name') || '').trim(), code = String(fields.get('code') || '').trim().toUpperCase(), percent = Number(fields.get('percent')), eligible = fields.getAll('programs').map(String);
  if (!name || name.length > 80 || !/^[A-Z0-9][A-Z0-9-]{2,31}$/.test(code) || !Number.isInteger(percent) || percent < 1 || percent > 100 || !eligible.length
    || eligible.some(id => !programIds.includes(id)) || codes.some((c, i) => i !== index && c.code === code) || index < 0 && codes.length >= 200)
    return {error: 'Enter a unique code, team name, 1–100% discount, and at least one eligible program.'};
  return {value: {id: codes[index]?.id || newId(), name, code, percent, programs: eligible, active: fields.get('active') === 'on'}};
}
