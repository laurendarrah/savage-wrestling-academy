// Plain names for the purchase types that can open for online payment (issue #127), so owner pages never show
// the internal ids listed in CHECKOUT_KINDS. Kept free of imports so any page or report can use it.
export const KIND_NAMES: Record<string, string> = {walkin: 'walk-ins', annual: 'memberships paid upfront', monthly: 'monthly memberships', event: 'camps & events', live: 'extra practices', lesson: 'private lessons'};
// "walk-ins, extra practices and camps & events": a plain list of the purchase types given.
export function kindList(kinds: Iterable<string>): string {
  const names = [...kinds].map(k => KIND_NAMES[k] ?? k);
  return names.length < 2 ? names.join('') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}
