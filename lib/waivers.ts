// Waivers (issue #69). The owner publishes the approved waiver text; each publish is a new version that is never edited.
// While a published version is in force, a wrestler cannot book until a parent or guardian signs that version.
// With no waiver published, or the latest one retired, nothing is required. There is no yearly expiry: a new version is
// how the owner asks families to sign again.
// Since issue #195 the waiver is one kind of signed document (lib/documents.ts), beside the Parent Consent Form and
// coach contracts. These are the waiver's names for the shared functions that other files still use; publishing,
// retiring and signing go through lib/documents.ts directly.
import {academyToday} from './public-schedule';
import {FAMILY_KINDS, currentVersion, documentProblem, myDocuments, signedCopyHtml} from './documents';
export {signatureFor, signedCopy} from './documents';

// The version families must sign now, or null when no waiver is required.
export const currentWaiver = () => currentVersion('waiver');

// The message a family sees when booking is refused, or null when nothing needs signing. Booking (lib/quotes.ts,
// lib/lessons.ts) asks this one question, so it covers every family document: the waiver, then the Parent Consent Form
// (issue #195). Each counts only while a version of it is published, and each honors its own owner exceptions.
export async function waiverProblem(userId: string, w: {id: string; name: string}, dates: string[] = [academyToday()]) {
  for (const kind of FAMILY_KINDS) {
    const problem = await documentProblem(kind, userId, w, dates);
    if (problem) return problem;
  }
  return null;
}

// Family view: the waiver in force and which wrestlers have signed it, plus every earlier signed copy.
export async function familyWaivers(userId: string) {
  const d = await myDocuments('waiver', userId);
  return {...d, waiver: d.document};
}

export const waiverCopyHtml = signedCopyHtml;
