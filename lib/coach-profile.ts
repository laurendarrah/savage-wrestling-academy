// Coach profiles (issue #190): a coach's display name, short bio, specialties and phone, written by the coach and
// editable by the owner. Families see the name, bio and specialties beside a coach's lesson times; the phone is for
// the academy only and never leaves the owner and coach pages.
// Photos come later (#192, R2 storage). The seam: coach_profiles.photo_key stays null, profileView() always returns
// photo: null, and the pages show the coach's initials where the photo will go.
import {env} from 'cloudflare:workers';

export type CoachProfile = {displayName: string; bio: string; specialties: string[]; phone: string};
export const LIMITS = {name: 60, bio: 500, specialty: 40, specialties: 6, phone: 20};

// Letters, digits and ordinary punctuation only: no control characters (a bio may keep line breaks).
const controls = /[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029]/;
const oneLine = (v: unknown) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : null;

export function cleanProfile(input: any): {profile: CoachProfile} | {error: string} {
  if (!input || typeof input !== 'object') return {error: 'Check the profile.'};
  const name = oneLine(input.displayName);
  if (!name) return {error: 'Enter the name families will see.'};
  if (name.length > LIMITS.name || controls.test(name)) return {error: `Keep the name to ${LIMITS.name} characters.`};
  if (typeof input.bio !== 'string') return {error: 'Check the bio.'};
  const bio = input.bio.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (bio.length > LIMITS.bio) return {error: `Keep the bio to ${LIMITS.bio} characters.`};
  if (/[\u0000-\u0009\u000b-\u001f\u007f\u2028\u2029]/.test(bio)) return {error: 'The bio has characters that can’t be saved.'};
  // Specialties: a list, or one line separated by commas.
  const raw = Array.isArray(input.specialties) ? input.specialties : typeof input.specialties === 'string' ? input.specialties.split(',') : null;
  if (!raw) return {error: 'Check the specialties.'};
  const specialties: string[] = [];
  for (const s of raw) {
    const v = oneLine(s);
    if (v === null) return {error: 'Check the specialties.'};
    if (!v) continue;
    if (v.length > LIMITS.specialty || controls.test(v)) return {error: `Keep each specialty to ${LIMITS.specialty} characters.`};
    if (!specialties.some(x => x.toLowerCase() === v.toLowerCase())) specialties.push(v);
  }
  if (specialties.length > LIMITS.specialties) return {error: `List up to ${LIMITS.specialties} specialties.`};
  const phone = oneLine(input.phone ?? '');
  if (phone === null) return {error: 'Check the phone number.'};
  const digits = phone.replace(/\D/g, '').length;
  if (phone && (phone.length > LIMITS.phone || !/^[0-9+().\-\s]+$/.test(phone) || digits < 7 || digits > 15)) return {error: 'Enter a phone number with 7 to 15 digits, or leave it blank.'};
  return {profile: {displayName: name, bio, specialties, phone}};
}

type Row = {email: string; display_name: string; bio: string; specialties: string; phone: string; photo_key: string | null; updated_at: string};
const fromRow = (r: Row) => ({displayName: r.display_name, bio: r.bio, specialties: JSON.parse(r.specialties) as string[], phone: r.phone, photo: null, updatedAt: r.updated_at});

// A coach's profile, or a starting one from their staff name when they have not saved one yet.
export async function profileView(email: string, fallbackName: string) {
  const r = await env.DB!.prepare('SELECT * FROM coach_profiles WHERE email=?').bind(email.toLowerCase()).first<Row>();
  return r ? {...fromRow(r), saved: true} : {displayName: fallbackName, bio: '', specialties: [] as string[], phone: '', photo: null, updatedAt: null, saved: false};
}

export async function saveProfile(email: string, profile: CoachProfile, actor: string) {
  const at = new Date().toISOString();
  await env.DB!.batch([
    env.DB!.prepare(`INSERT INTO coach_profiles(email,display_name,bio,specialties,phone,photo_key,updated_at,updated_by) VALUES (?,?,?,?,?,NULL,?,?)
      ON CONFLICT(email) DO UPDATE SET display_name=excluded.display_name,bio=excluded.bio,specialties=excluded.specialties,phone=excluded.phone,updated_at=excluded.updated_at,updated_by=excluded.updated_by`)
      .bind(email.toLowerCase(), profile.displayName, profile.bio, JSON.stringify(profile.specialties), profile.phone, at, actor),
    env.DB!.prepare('INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), actor, 'coach_profile_saved', email.toLowerCase(), at)
  ]);
}

// What families may see about each coach: name, bio and specialties. Never the email or phone.
export async function publicProfiles(emails: string[]) {
  const out = new Map<string, {name: string; bio: string; specialties: string[]}>();
  const list = [...new Set(emails.map(e => e.toLowerCase()))];
  for (let i = 0; i < list.length; i += 90) {
    const part = list.slice(i, i + 90);
    const rows = (await env.DB!.prepare(`SELECT * FROM coach_profiles WHERE email IN (${part.map(() => '?').join(',')})`).bind(...part).all<Row>()).results;
    for (const r of rows) out.set(r.email, {name: r.display_name, bio: r.bio, specialties: JSON.parse(r.specialties)});
  }
  return out;
}
