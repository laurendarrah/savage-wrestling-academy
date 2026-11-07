// Signed documents (issue #195), generalized from the waiver (issue #69). Three kinds share one system:
// - waiver: families sign it for each wrestler; while a version is in force, a wrestler cannot book until it is signed.
// - parent_consent: the Parent Consent Form. Exactly like the waiver, and it blocks booking only once the owner
//   publishes a version (decision Q15 on #197). The wording waits for the attorney, so nothing is published by code.
// - coach_contract: each coach signs for themselves. It never blocks anything a coach does (that is not decided); a
//   coach who has not signed the version in force sees a to-do on coach home.
// The owner publishes each kind's text as a new version that is never edited (waiver_versions, by kind). With no version
// published, or the latest one retired, nothing is asked. A new version is how the owner asks everyone to sign again.
// Family documents are always signed by a parent or guardian, also for wrestlers 18 and older (decision Q16 on #197).
// Signatures (waiver_signatures) are immutable: version, signer, account, time and the drawn strokes, with the text's
// SHA-256 so a signed copy shows if the published text was ever altered.
import {env} from 'cloudflare:workers';
import {cleanSignature, type Point} from './scholarship-signatures';
import {familyProfile} from './program-approval';
import {exceptionFor, type Rule} from './exceptions';
import {academyToday} from './public-schedule';
import {allFamilies, pageOf, PAGE_SIZE} from './paging';

export type Kind = 'waiver' | 'parent_consent' | 'coach_contract';
type Spec = {
  name: string;                  // in sentences: "the waiver", "the Parent Consent Form", "the contract"
  label: string;                 // on its own: "Waiver", "Parent Consent Form", "Coach contract"
  signer: 'parent' | 'coach';
  rule?: Rule;                   // the owner exception that lets a wrestler book without it
  consent: string;               // the electronic-signature consent stored with every signature
};
export const DOCUMENTS: Record<Kind, Spec> = {
  waiver: {name: 'waiver', label: 'Waiver', signer: 'parent', rule: 'waiver',
    consent: 'I consent to use an electronic signature for this waiver and intend my drawn signature to record my agreement. I can save or print a copy of the signed waiver.'},
  parent_consent: {name: 'Parent Consent Form', label: 'Parent Consent Form', signer: 'parent', rule: 'parent_consent',
    consent: 'I consent to use an electronic signature for this form and intend my drawn signature to record my agreement. I can save or print a copy of the signed form.'},
  coach_contract: {name: 'contract', label: 'Coach contract', signer: 'coach',
    consent: 'I consent to use an electronic signature for this contract and intend my drawn signature to record my agreement. I can save or print a copy of the signed contract.'},
};
export const KINDS = Object.keys(DOCUMENTS) as Kind[];
export const FAMILY_KINDS = KINDS.filter(k => DOCUMENTS[k].signer === 'parent');
export const isKind = (k: unknown): k is Kind => typeof k === 'string' && (KINDS as string[]).includes(k);

export type DocumentVersion = {id: string; kind: Kind; title: string; body: string; sha256: string; published_at: string; published_by: string; retired_at: string | null};
// The stored signature record. Field names come from the waiver (#69) and stay the same for every kind, so waiver
// signatures from before #195 read exactly as before; `kind` and `signerRole` were added with #195.
export type SignatureRecord = {version: 1; method: 'drawn'; strokes: Point[][]; waiverId: string; waiverSha256: string; signedAt: string; signer: string; accountEmail: string; consent: string; kind?: Kind; signerRole?: 'parent' | 'coach'};

export async function sha256(text: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))).map(b => b.toString(16).padStart(2, '0')).join('');
}
const sameName = (a: unknown, b: unknown) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

export async function latestVersion(kind: Kind) {
  return await env.DB!.prepare('SELECT * FROM waiver_versions WHERE kind=? ORDER BY published_at DESC, id DESC LIMIT 1').bind(kind).first<DocumentVersion>();
}
// The version people must sign now, or null when nothing of this kind is asked.
export async function currentVersion(kind: Kind) {
  const v = await latestVersion(kind);
  return v && !v.retired_at ? v : null;
}

// A family signature belongs to the wrestler it was signed for, by name as well as id (issue #97): renaming a signed
// entry to another child does not carry the signature over. A coach's own signature has an empty wrestler id and name.
export async function signatureFor(versionId: string, userId: string, wrestlerId: string, name: string) {
  return await env.DB!.prepare('SELECT id,signer,signed_at FROM waiver_signatures WHERE version_id=? AND user_id=? AND wrestler_id=? AND lower(trim(wrestler_name))=lower(trim(?))')
    .bind(versionId, userId, wrestlerId, name).first<{id: string; signer: string; signed_at: string}>();
}

// The message a family sees when booking is refused for this document, or null when it is not needed or signed.
export async function documentProblem(kind: Kind, userId: string, w: {id: string; name: string}, dates: string[] = [academyToday()]) {
  const spec = DOCUMENTS[kind], current = await currentVersion(kind);
  if (spec.signer !== 'parent' || !current || await signatureFor(current.id, userId, w.id, w.name)) return null;
  if (spec.rule && await exceptionFor(userId, w.id, spec.rule, dates)) return null; // owner exception covering every booked date (issue #89)
  // The waiver is named by its title, as before #195. The consent form always uses its fixed name, which the booking
  // pages look for to link to /consent.
  return `${w.name} needs a signed ${kind === 'waiver' ? current.title : spec.name} before booking. Sign it in your family account; it takes about a minute.`;
}

export async function publishDocument(kind: Kind, title: unknown, body: unknown, ownerId: string) {
  const spec = DOCUMENTS[kind], t = typeof title === 'string' ? title.trim() : '', b = typeof body === 'string' ? body.replace(/\r\n/g, '\n').trim() : '';
  if (t.length < 3 || t.length > 120) return {status: 400, error: `Give the ${spec.name} a title between 3 and 120 characters.`};
  if (b.length < 200 || b.length > 60000) return {status: 400, error: `Paste the full approved ${spec.name} text (at least 200 characters).`};
  const latest = await latestVersion(kind), hash = await sha256(t + '\n\n' + b);
  if (latest && !latest.retired_at && latest.sha256 === hash) return {status: 409, error: `This exact ${spec.name} is already in force.`};
  const id = crypto.randomUUID(), at = new Date().toISOString();
  await env.DB!.batch([
    env.DB!.prepare('INSERT INTO waiver_versions(id,kind,title,body,sha256,published_at,published_by,retired_at) VALUES (?,?,?,?,?,?,?,NULL)').bind(id, kind, t, b, hash, at, ownerId),
    env.DB!.prepare('INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), ownerId, kind + '_published', id, at)
  ]);
  return {status: 200, id};
}

export async function retireDocument(kind: Kind, ownerId: string) {
  const current = await currentVersion(kind);
  if (!current) return {status: 409, error: `No ${DOCUMENTS[kind].name} is in force.`};
  const at = new Date().toISOString();
  await env.DB!.batch([
    env.DB!.prepare('UPDATE waiver_versions SET retired_at=? WHERE id=? AND retired_at IS NULL').bind(at, current.id),
    env.DB!.prepare('INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), ownerId, kind + '_retired', current.id, at)
  ]);
  return {status: 200};
}

// Signs the version in force. A family document is signed for one of the family's saved wrestlers by a parent or
// guardian; a coach contract is signed by the coach for themselves (the route checks they are a coach).
export async function signDocument(kind: Kind, user: {id: string; email: string}, input: any) {
  const spec = DOCUMENTS[kind], current = await currentVersion(kind);
  if (!current) return {status: 409, error: `No ${spec.name} needs signing right now.`};
  if (!input || input.versionId !== current.id) return {status: 409, error: `The ${spec.name} was updated. Reload the page and read the current version before signing.`};
  let who = {id: '', name: ''};
  if (spec.signer === 'parent') {
    const w = (await familyProfile(user.id))?.wrestlers.find(x => x.id === input.wrestlerId);
    if (!w) return {status: 404, error: 'Choose a saved wrestler from your family account.'};
    who = {id: w.id, name: w.name};
  }
  const signer = typeof input.signer === 'string' ? input.signer.trim() : '';
  if (signer.length < 2 || signer.length > 120) return {status: 400, error: 'Type your full printed name.'};
  // Decision Q16 on #197: a parent or guardian always signs, also for wrestlers 18 and older.
  if (spec.signer === 'parent' && sameName(signer, who.name)) return {status: 400, error: `A parent or guardian signs for every wrestler, including wrestlers 18 and older. Type the parent's or guardian's name.`};
  if (input.accepted !== true || input.electronicConsent !== true) return {status: 400, error: `Confirm that you have read the ${spec.name} and agree to sign electronically.`};
  const signature = cleanSignature(input.signature);
  if (!signature || signature.method !== 'drawn') return {status: 400, error: 'Draw your signature in the box.'};
  const already = spec.signer === 'parent' ? `${who.name}'s ${spec.name} is already signed.` : `Your ${spec.name} is already signed.`;
  if (await signatureFor(current.id, user.id, who.id, who.name)) return {status: 409, error: already};
  const at = new Date().toISOString(), id = crypto.randomUUID();
  const record: SignatureRecord = {version: 1, method: 'drawn', strokes: signature.strokes, waiverId: current.id, waiverSha256: current.sha256, signedAt: at, signer, accountEmail: user.email, consent: spec.consent, kind, signerRole: spec.signer};
  try {
    await env.DB!.batch([
      env.DB!.prepare('INSERT INTO waiver_signatures(id,version_id,user_id,wrestler_id,wrestler_name,signer,email,signature_record,signed_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .bind(id, current.id, user.id, who.id, who.name, signer, user.email, JSON.stringify(record), at),
      env.DB!.prepare('INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), user.id, kind + '_signed', spec.signer === 'parent' ? `${current.id}/${who.id}` : current.id, at)
    ]);
  } catch {
    return {status: 409, error: already};
  }
  return {status: 200, id};
}

// What one person sees: the version in force and every copy they have signed of this kind. `current` marks a
// signature that still counts (this version, and for a wrestler the same name).
export async function myDocuments(kind: Kind, userId: string) {
  const current = await currentVersion(kind), parent = DOCUMENTS[kind].signer === 'parent';
  const names = parent ? new Map(((await familyProfile(userId))?.wrestlers ?? []).map(w => [w.id, w.name.trim().toLowerCase()])) : new Map([['', '']]);
  const signed = (await env.DB!.prepare(`SELECT s.id,s.version_id,s.wrestler_id,s.wrestler_name,s.signer,s.signed_at,v.title FROM waiver_signatures s JOIN waiver_versions v ON v.id=s.version_id
    WHERE s.user_id=? AND v.kind=? ORDER BY s.signed_at DESC`).bind(userId, kind).all<any>()).results;
  const rule = DOCUMENTS[kind].rule, today = academyToday();
  return {
    kind,
    document: current ? {id: current.id, title: current.title, body: current.body, publishedAt: current.published_at} : null,
    consent: DOCUMENTS[kind].consent,
    // Wrestlers the owner is letting book without signing for now (issue #89).
    exceptions: rule ? Object.fromEntries((await env.DB!.prepare('SELECT wrestler_id,max(ends_on) AS ends FROM booking_exceptions WHERE user_id=? AND rule=? AND revoked_at IS NULL AND starts_on<=? AND ends_on>=? GROUP BY wrestler_id')
      .bind(userId, rule, today, today).all<{wrestler_id: string; ends: string}>()).results.map(r => [r.wrestler_id, r.ends])) : {},
    signatures: signed.map(s => ({id: s.id, versionId: s.version_id, wrestlerId: s.wrestler_id, wrestler: s.wrestler_name, signer: s.signer, signedAt: s.signed_at, title: s.title,
      current: s.version_id === current?.id && names.get(s.wrestler_id) === String(s.wrestler_name).trim().toLowerCase()}))
  };
}

// Owner view: every version of this kind, and each person's status against the version in force. Family documents
// list every saved wrestler; the coach contract lists every active coach except `exclude` (the owner, who may also
// coach but does not sign a contract with the academy).
export async function ownerDocuments(kind: Kind, exclude = '') {
  const versions = (await env.DB!.prepare('SELECT v.id,v.title,v.published_at,v.retired_at,(SELECT COUNT(*) FROM waiver_signatures s WHERE s.version_id=v.id) AS signed FROM waiver_versions v WHERE v.kind=? ORDER BY v.published_at DESC').bind(kind).all<any>()).results;
  const current = await currentVersion(kind);
  const sigs = current ? (await env.DB!.prepare('SELECT id,user_id,email,wrestler_id,wrestler_name,signer,signed_at FROM waiver_signatures WHERE version_id=?').bind(current.id).all<any>()).results : [];
  const head = {kind, current: current ? {id: current.id, title: current.title, body: current.body, publishedAt: current.published_at} : null, versions};
  if (DOCUMENTS[kind].signer === 'coach') {
    const byEmail = new Map(sigs.map(s => [String(s.email).toLowerCase(), s]));
    const staff = (await env.DB!.prepare('SELECT s.email,s.name,p.display_name FROM staff_access s LEFT JOIN coach_profiles p ON p.email=s.email WHERE s.active=1 AND s.email<>? ORDER BY s.name')
      .bind(exclude.toLowerCase()).all<{email: string; name: string; display_name: string | null}>()).results;
    return {...head, coaches: staff.map(c => {
      const s = byEmail.get(c.email.toLowerCase());
      return {email: c.email, name: c.display_name || c.name, signed: !!s, signatureId: s?.id ?? null, signer: s?.signer ?? null, signedAt: s?.signed_at ?? null};
    })};
  }
  // Every family, read in batches (issue #46); the owner's page shows them a page at a time (signersPage).
  const families = (await allFamilies()).sort((a, b) => a.email < b.email ? -1 : a.email > b.email ? 1 : 0);
  const byKey = new Map(sigs.map(s => [s.user_id + '/' + s.wrestler_id + '/' + String(s.wrestler_name).trim().toLowerCase(), s]));
  const wrestlers = families.flatMap(f => {
    const p = JSON.parse(f.payload || '{}');
    return (p.wrestlers || []).map((w: any) => {
      const s = byKey.get(f.user_id + '/' + w.id + '/' + String(w.name).trim().toLowerCase());
      return {userId: f.user_id, email: f.email, parentName: p.parentName || '', wrestlerId: w.id, wrestler: w.name, grade: w.grade, signed: !!s, signatureId: s?.id ?? null, signer: s?.signer ?? null, signedAt: s?.signed_at ?? null};
    });
  });
  return {...head, wrestlers};
}

// One page of the owner's list of who signed (issue #46): counts over everyone, and the people that match the filter
// ("missing": not signed, or "all") and the search, a page at a time. Wrestlers are in family email order; coaches
// (coach contracts) by name.
type Signer = {signed: boolean; email: string; userId?: string; wrestlerId?: string; wrestler?: string; parentName?: string; name?: string};
export function signersPage<T extends Signer>(rows: T[], o: {show?: string | null; q?: string | null; cursor?: string | null; limit?: number}) {
  const text = (o.q ?? '').trim().toLowerCase(), missingOnly = o.show === 'missing';
  const matching = rows.filter(x => (!missingOnly || !x.signed) && (!text || [x.wrestler, x.parentName, x.name, x.email].filter(Boolean).join(' ').toLowerCase().includes(text)));
  const key = (x: T) => x.wrestlerId !== undefined ? [String(x.email).toLowerCase(), String(x.userId), String(x.wrestlerId)] : [String(x.name ?? '').toLowerCase(), String(x.email).toLowerCase()];
  const page = pageOf(matching, key, o.cursor, o.limit ?? PAGE_SIZE);
  return {rows: page.rows, next: page.next, matched: matching.length,
    totals: {all: rows.length, signed: rows.filter(x => x.signed).length, missing: rows.filter(x => !x.signed).length}};
}

// A signed copy for the owner or the person who signed it. The stored text hash must still match the version.
export async function signedCopy(id: string, viewer: {userId: string; owner: boolean}) {
  const s = await env.DB!.prepare('SELECT * FROM waiver_signatures WHERE id=?').bind(id).first<any>();
  if (!s || (!viewer.owner && s.user_id !== viewer.userId)) return null;
  const v = await env.DB!.prepare('SELECT * FROM waiver_versions WHERE id=?').bind(s.version_id).first<DocumentVersion>();
  const label = DOCUMENTS[isKind(v?.kind) ? v!.kind : 'waiver'].name;
  let record: SignatureRecord;
  try { record = JSON.parse(s.signature_record); } catch { return {error: 'The signature record needs review. Contact SWA.'}; }
  if (!v || !isKind(v.kind) || !cleanSignature(record) || record.waiverSha256 !== v.sha256 || (record.kind && record.kind !== v.kind) || await sha256(v.title + '\n\n' + v.body) !== v.sha256)
    return {error: `The ${label} record needs review. Contact SWA.`};
  return {signature: s, version: v, record};
}

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]!));
export function signedCopyHtml(c: {signature: any; version: DocumentVersion; record: SignatureRecord}, nonce: string) {
  const {signature: s, version: v, record: r} = c, spec = DOCUMENTS[isKind(v.kind) ? v.kind : 'waiver'];
  const ink = `<svg role="img" aria-label="Drawn signature" viewBox="0 0 800 200">${r.strokes.map(stroke => `<polyline points="${stroke.map(([x, y]) => (x * 800).toFixed(2) + ',' + (y * 200).toFixed(2)).join(' ')}" fill="none" stroke="#18191c" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}</svg>`;
  const date = new Intl.DateTimeFormat('en-US', {timeZone: 'America/New_York', dateStyle: 'long', timeStyle: 'short'}).format(new Date(s.signed_at));
  // Waivers signed before #195 could be signed by an adult wrestler, so only records that say so name the parent role.
  const who = spec.signer === 'coach' ? `<strong>Coach</strong> ${esc(s.signer)}` : `<strong>Wrestler</strong> ${esc(s.wrestler_name)}<br><strong>Signed by</strong> ${esc(s.signer)}${r.signerRole === 'parent' ? ', parent or guardian' : ''}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Signed ${esc(spec.name)} | Savage Wrestling Academy</title><style>body{font:16px/1.65 Arial;color:#18191c;max-width:860px;margin:24px auto;padding:24px}h1,h2{line-height:1.2}button{padding:10px 14px;background:#fff;border:1px solid #aaa;border-radius:5px;font:inherit;cursor:pointer}.terms{white-space:pre-wrap;overflow-wrap:anywhere;border-top:1px solid #ccc;border-bottom:1px solid #ccc;padding:20px 0}.signature{max-width:600px;border-bottom:1px solid #18191c;margin:20px 0;break-inside:avoid}.signature svg{width:100%;height:150px}.metadata{font-size:13px;overflow-wrap:anywhere}@media print{body{margin:0;padding:0;max-width:none}button{display:none}}</style></head><body><h1>Savage Wrestling Academy</h1><h2>${esc(v.title)}</h2><p>${who}</p><p><button id="print">Print / Save as PDF</button></p><div class="terms">${esc(v.body)}</div><h2>Signature</h2><div class="signature">${ink}</div><p>Signed electronically by <strong>${esc(s.signer)}</strong> · ${esc(date)} New York time</p><p class="metadata">Account · ${esc(r.accountEmail)}<br>Consent · ${esc(r.consent)}<br>${esc(spec.label)} version · ${esc(v.id)} published ${esc(v.published_at.slice(0, 10))}<br>${esc(spec.label)} text SHA-256 · ${esc(v.sha256)}<br>Signature ID · ${esc(s.id)}</p><script nonce="${esc(nonce)}">document.getElementById('print').addEventListener('click',()=>window.print());</script></body></html>`;
}
