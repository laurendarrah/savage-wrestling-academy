// Normalizing the academy settings document as the owner workspace loads it (issue #45). Saving, revisions and the
// conflict warning stay in app/portal.html: the page sends its revision with each save and /api/academy refuses a stale one.
import {programDetails} from '../program-names';
import {STARTER_PRICE_CENTS, STARTER_WALK_IN_CENTS, starterDescription} from './programs';
import type {AcademyDoc, Program} from './types';

// A new academy starts empty. The server requires these keys; the sample lists in older documents are never read.
export function emptyAcademy(): AcademyDoc {
  return {kids: [], bookings: [], attendance: {}, messages: [], offers: [], settings: {}, seasons: [], staff: []};
}

export function ensureExtraPractices(doc: AcademyDoc): void {
  doc.extraPractices ??= [];
}

// Every event has an id, so bookings and check-ins can point at it.
export function ensureEventIds(doc: AcademyDoc, newId: () => string = () => crypto.randomUUID()): void {
  doc.events ??= [];
  doc.events.forEach(e => { e.id ??= newId(); });
}

// Fills in the programs and upgrades older names. With no programs saved, the programs the page shows now are the
// starting point, at the starter descriptions and prices. A document from before the names changed gets the current
// names, grades, descriptions and starter prices once (as upgradeProgramNames() in lib/program-names.ts does on the
// server). Returns a copy of the programs for the page to show.
export function hydratePrograms(doc: AcademyDoc, shown: readonly {id: string; name: string; grades: string}[]): Program[] {
  ensureExtraPractices(doc);
  doc.programs ??= shown.map(p => ({...p, description: starterDescription(p.id), priceCents: STARTER_PRICE_CENTS, walkInPriceCents: STARTER_WALK_IN_CENTS} as Program));
  if (!((doc.programNamingVersion ?? 0) >= 2)) {
    doc.programs = doc.programs.map(p => ({...p, ...programDetails[p.id], priceCents: STARTER_PRICE_CENTS, walkInPriceCents: STARTER_WALK_IN_CENTS}));
    doc.programNamingVersion = 2;
  }
  return structuredClone(doc.programs);
}
