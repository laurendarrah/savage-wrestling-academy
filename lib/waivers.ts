// Waivers (issue #69). The owner publishes the approved waiver text; each publish is a new version that is never edited.
// While a published version is in force, a wrestler cannot book until a parent (or the adult wrestler) signs that version.
// With no waiver published, or the latest one retired, nothing is required. There is no yearly expiry: a new version is
// how the owner asks families to sign again.
import {env} from 'cloudflare:workers';
import {cleanSignature, type Point} from './scholarship-signatures';
import {familyProfile} from './program-approval';
import {exceptionFor} from './exceptions';
import {academyToday} from './public-schedule';

export const waiverConsent = 'I consent to use an electronic signature for this waiver and intend my drawn signature to record my agreement. I can save or print a copy of the signed waiver.';
export type WaiverVersion = {id: string; title: string; body: string; sha256: string; published_at: string; published_by: string; retired_at: string | null};
export type WaiverRecord = {version: 1; method: 'drawn'; strokes: Point[][]; waiverId: string; waiverSha256: string; signedAt: string; signer: string; accountEmail: string; consent: string};

export async function sha256(text: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function latestWaiver() {
  return await env.DB!.prepare('SELECT * FROM waiver_versions ORDER BY published_at DESC, id DESC LIMIT 1').first<WaiverVersion>();
}
// The version families must sign now, or null when no waiver is required.
export async function currentWaiver() {
  const w = await latestWaiver();
  return w && !w.retired_at ? w : null;
}

// A signature belongs to the wrestler it was signed for, by name as well as id (issue #97): renaming a signed entry
// to another child does not carry the signature over.
export async function signatureFor(versionId: string, userId: string, wrestlerId: string, name: string) {
  return await env.DB!.prepare('SELECT id,signer,signed_at FROM waiver_signatures WHERE version_id=? AND user_id=? AND wrestler_id=? AND lower(trim(wrestler_name))=lower(trim(?))')
    .bind(versionId, userId, wrestlerId, name).first<{id: string; signer: string; signed_at: string}>();
}

// The message a family sees when booking is refused, or null when no waiver is needed or it is signed.
export async function waiverProblem(userId: string, w: {id: string; name: string}, dates: string[] = [academyToday()]) {
  const current = await currentWaiver();
  if (!current || await signatureFor(current.id, userId, w.id, w.name)) return null;
  if (await exceptionFor(userId, w.id, 'waiver', dates)) return null; // owner exception covering every booked date (issue #89)
  return `${w.name} needs a signed ${current.title} before booking. Sign it in your family account; it takes about a minute.`;
}

export async function publishWaiver(title: unknown, body: unknown, ownerId: string) {
  const t = typeof title === 'string' ? title.trim() : '', b = typeof body === 'string' ? body.replace(/\r\n/g, '\n').trim() : '';
  if (t.length < 3 || t.length > 120) return {status: 400, error: 'Give the waiver a title between 3 and 120 characters.'};
  if (b.length < 200 || b.length > 60000) return {status: 400, error: 'Paste the full approved waiver text (at least 200 characters).'};
  const latest = await latestWaiver(), hash = await sha256(t + '\n\n' + b);
  if (latest && !latest.retired_at && latest.sha256 === hash) return {status: 409, error: 'This exact waiver is already in force.'};
  const id = crypto.randomUUID(), at = new Date().toISOString();
  await env.DB!.batch([
    env.DB!.prepare('INSERT INTO waiver_versions(id,title,body,sha256,published_at,published_by,retired_at) VALUES (?,?,?,?,?,?,NULL)').bind(id, t, b, hash, at, ownerId),
    env.DB!.prepare('INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), ownerId, 'waiver_published', id, at)
  ]);
  return {status: 200, id};
}

export async function retireWaiver(ownerId: string) {
  const current = await currentWaiver();
  if (!current) return {status: 409, error: 'No waiver is in force.'};
  const at = new Date().toISOString();
  await env.DB!.batch([
    env.DB!.prepare('UPDATE waiver_versions SET retired_at=? WHERE id=? AND retired_at IS NULL').bind(at, current.id),
    env.DB!.prepare('INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), ownerId, 'waiver_retired', current.id, at)
  ]);
  return {status: 200};
}

export async function signWaiver(user: {id: string; email: string}, input: any) {
  const current = await currentWaiver();
  if (!current) return {status: 409, error: 'No waiver needs signing right now.'};
  if (!input || input.versionId !== current.id) return {status: 409, error: 'The waiver was updated. Reload the page and read the current version before signing.'};
  const profile = await familyProfile(user.id), w = profile?.wrestlers.find(x => x.id === input.wrestlerId);
  if (!w) return {status: 404, error: 'Choose a saved wrestler from your family account.'};
  const signer = typeof input.signer === 'string' ? input.signer.trim() : '';
  if (signer.length < 2 || signer.length > 120) return {status: 400, error: 'Type your full printed name.'};
  if (input.accepted !== true || input.electronicConsent !== true) return {status: 400, error: 'Confirm that you have read the waiver and agree to sign electronically.'};
  const signature = cleanSignature(input.signature);
  if (!signature || signature.method !== 'drawn') return {status: 400, error: 'Draw your signature in the box.'};
  if (await signatureFor(current.id, user.id, w.id, w.name)) return {status: 409, error: `${w.name}'s waiver is already signed.`};
  const at = new Date().toISOString(), id = crypto.randomUUID();
  const record: WaiverRecord = {version: 1, method: 'drawn', strokes: signature.strokes, waiverId: current.id, waiverSha256: current.sha256, signedAt: at, signer, accountEmail: user.email, consent: waiverConsent};
  try {
    await env.DB!.batch([
      env.DB!.prepare('INSERT INTO waiver_signatures(id,version_id,user_id,wrestler_id,wrestler_name,signer,email,signature_record,signed_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .bind(id, current.id, user.id, w.id, w.name, signer, user.email, JSON.stringify(record), at),
      env.DB!.prepare('INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), user.id, 'waiver_signed', `${current.id}/${w.id}`, at)
    ]);
  } catch {
    return {status: 409, error: `${w.name}'s waiver is already signed.`};
  }
  return {status: 200, id};
}

// Family view: the waiver in force and which wrestlers have signed it, plus every earlier signed copy.
export async function familyWaivers(userId: string) {
  const current = await currentWaiver();
  const names = new Map(((await familyProfile(userId))?.wrestlers ?? []).map(w => [w.id, w.name.trim().toLowerCase()]));
  const signed = (await env.DB!.prepare(`SELECT s.id,s.version_id,s.wrestler_id,s.wrestler_name,s.signer,s.signed_at,v.title FROM waiver_signatures s JOIN waiver_versions v ON v.id=s.version_id
    WHERE s.user_id=? ORDER BY s.signed_at DESC`).bind(userId).all<any>()).results;
  return {
    waiver: current ? {id: current.id, title: current.title, body: current.body, publishedAt: current.published_at} : null,
    // Wrestlers the owner is letting book without signing for now (issue #89).
    exceptions: Object.fromEntries((await env.DB!.prepare("SELECT wrestler_id,max(ends_on) AS ends FROM booking_exceptions WHERE user_id=? AND rule='waiver' AND revoked_at IS NULL AND starts_on<=? AND ends_on>=? GROUP BY wrestler_id").bind(userId, academyToday(), academyToday()).all<{wrestler_id: string; ends: string}>()).results.map(r => [r.wrestler_id, r.ends])),
    signatures: signed.map(s => ({id: s.id, versionId: s.version_id, wrestlerId: s.wrestler_id, wrestler: s.wrestler_name, signer: s.signer, signedAt: s.signed_at, title: s.title,
      current: s.version_id === current?.id && names.get(s.wrestler_id) === String(s.wrestler_name).trim().toLowerCase()}))
  };
}

// Owner view: every version, and every wrestler's status against the waiver in force.
export async function ownerWaivers() {
  const versions = (await env.DB!.prepare('SELECT v.id,v.title,v.published_at,v.retired_at,(SELECT COUNT(*) FROM waiver_signatures s WHERE s.version_id=v.id) AS signed FROM waiver_versions v ORDER BY v.published_at DESC').all<any>()).results;
  const current = await currentWaiver();
  const families = (await env.DB!.prepare('SELECT user_id,email,payload FROM family_accounts ORDER BY email LIMIT 2000').all<{user_id: string; email: string; payload: string}>()).results;
  const sigs = current ? (await env.DB!.prepare('SELECT id,user_id,wrestler_id,wrestler_name,signer,signed_at FROM waiver_signatures WHERE version_id=?').bind(current.id).all<any>()).results : [];
  const byKey = new Map(sigs.map(s => [s.user_id + '/' + s.wrestler_id + '/' + String(s.wrestler_name).trim().toLowerCase(), s]));
  const wrestlers = families.flatMap(f => {
    const p = JSON.parse(f.payload || '{}');
    return (p.wrestlers || []).map((w: any) => {
      const s = byKey.get(f.user_id + '/' + w.id + '/' + String(w.name).trim().toLowerCase());
      return {userId: f.user_id, email: f.email, parentName: p.parentName || '', wrestlerId: w.id, wrestler: w.name, grade: w.grade, signed: !!s, signatureId: s?.id ?? null, signer: s?.signer ?? null, signedAt: s?.signed_at ?? null};
    });
  });
  return {current: current ? {id: current.id, title: current.title, body: current.body, publishedAt: current.published_at} : null, versions, wrestlers};
}

// A signed copy for the owner or the family that signed it. The stored text hash must still match the version.
export async function signedCopy(id: string, viewer: {userId: string; owner: boolean}) {
  const s = await env.DB!.prepare('SELECT * FROM waiver_signatures WHERE id=?').bind(id).first<any>();
  if (!s || (!viewer.owner && s.user_id !== viewer.userId)) return null;
  const v = await env.DB!.prepare('SELECT * FROM waiver_versions WHERE id=?').bind(s.version_id).first<WaiverVersion>();
  let record: WaiverRecord;
  try { record = JSON.parse(s.signature_record); } catch { return {error: 'The signature record needs review. Contact SWA.'}; }
  if (!v || !cleanSignature(record) || record.waiverSha256 !== v.sha256 || await sha256(v.title + '\n\n' + v.body) !== v.sha256) return {error: 'The waiver record needs review. Contact SWA.'};
  return {signature: s, version: v, record};
}

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]!));
export function waiverCopyHtml(c: {signature: any; version: WaiverVersion; record: WaiverRecord}, nonce: string) {
  const {signature: s, version: v, record: r} = c;
  const ink = `<svg role="img" aria-label="Drawn signature" viewBox="0 0 800 200">${r.strokes.map(stroke => `<polyline points="${stroke.map(([x, y]) => (x * 800).toFixed(2) + ',' + (y * 200).toFixed(2)).join(' ')}" fill="none" stroke="#18191c" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}</svg>`;
  const date = new Intl.DateTimeFormat('en-US', {timeZone: 'America/New_York', dateStyle: 'long', timeStyle: 'short'}).format(new Date(s.signed_at));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Signed waiver | Savage Wrestling Academy</title><style>body{font:16px/1.65 Arial;color:#18191c;max-width:860px;margin:24px auto;padding:24px}h1,h2{line-height:1.2}button{padding:10px 14px;background:#fff;border:1px solid #aaa;border-radius:5px;font:inherit;cursor:pointer}.terms{white-space:pre-wrap;overflow-wrap:anywhere;border-top:1px solid #ccc;border-bottom:1px solid #ccc;padding:20px 0}.signature{max-width:600px;border-bottom:1px solid #18191c;margin:20px 0;break-inside:avoid}.signature svg{width:100%;height:150px}.metadata{font-size:13px;overflow-wrap:anywhere}@media print{body{margin:0;padding:0;max-width:none}button{display:none}}</style></head><body><h1>Savage Wrestling Academy</h1><h2>${esc(v.title)}</h2><p><strong>Wrestler</strong> ${esc(s.wrestler_name)}<br><strong>Signed by</strong> ${esc(s.signer)}</p><p><button id="print">Print / Save as PDF</button></p><div class="terms">${esc(v.body)}</div><h2>Signature</h2><div class="signature">${ink}</div><p>Signed electronically by <strong>${esc(s.signer)}</strong> · ${esc(date)} New York time</p><p class="metadata">Account · ${esc(r.accountEmail)}<br>Consent · ${esc(r.consent)}<br>Waiver version · ${esc(v.id)} published ${esc(v.published_at.slice(0, 10))}<br>Waiver text SHA-256 · ${esc(v.sha256)}<br>Signature ID · ${esc(s.id)}</p><script nonce="${esc(nonce)}">document.getElementById('print').addEventListener('click',()=>window.print());</script></body></html>`;
}
