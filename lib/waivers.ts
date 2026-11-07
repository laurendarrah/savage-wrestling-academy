// Waivers (issue #69). The owner publishes the approved waiver text; each publish is a new version that is never edited.
// While a published version is in force, a wrestler cannot book until a parent or guardian signs that version.
// With no waiver published, or the latest one retired, nothing is required. There is no yearly expiry: a new version is
// how the owner asks families to sign again.
// Since issue #195 the waiver is one kind of signed document (lib/documents.ts), beside the Parent Consent Form and
// coach contracts. These are the waiver's names for the shared functions, so existing callers stay as they were.
import {academyToday} from './public-schedule';
import {DOCUMENTS, FAMILY_KINDS, currentVersion, documentProblem, latestVersion, myDocuments, ownerDocuments, publishDocument, retireDocument, signDocument, signedCopyHtml,
  type DocumentVersion, type SignatureRecord} from './documents';
export {sha256, signatureFor, signedCopy} from './documents';

export const waiverConsent = DOCUMENTS.waiver.consent;
export type WaiverVersion = DocumentVersion;
export type WaiverRecord = SignatureRecord;

export const latestWaiver = () => latestVersion('waiver');
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

export const publishWaiver = (title: unknown, body: unknown, ownerId: string) => publishDocument('waiver', title, body, ownerId);
export const retireWaiver = (ownerId: string) => retireDocument('waiver', ownerId);
export const signWaiver = (user: {id: string; email: string}, input: any) => signDocument('waiver', user, input);

// Family view: the waiver in force and which wrestlers have signed it, plus every earlier signed copy.
export async function familyWaivers(userId: string) {
  const d = await myDocuments('waiver', userId);
  return {...d, waiver: d.document};
}

// Owner view: every version, and every wrestler's status against the waiver in force.
export const ownerWaivers = () => ownerDocuments('waiver');
export const waiverCopyHtml = signedCopyHtml;
