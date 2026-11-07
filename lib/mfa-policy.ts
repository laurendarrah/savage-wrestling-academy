// When an account counts as fully signed in (issue #204). Normally that needs a verified authenticator code (AAL2).
// Until launch, Lauren can turn the requirement off with the Worker setting STAFF_MFA=off: an account with no
// authenticator then counts as signed in. An account that has set one up still uses it. Deleting the setting turns
// the requirement back on; the owner's launch checklist shows it in red while it's off.
export function mfaSwitchedOff(setting: unknown): boolean {
  return String(setting ?? '').trim().toLowerCase() === 'off';
}
export function fullySignedIn(input: {emailConfirmed: boolean; aal2: boolean; hasVerifiedFactor: boolean; mfaOff: boolean}): boolean {
  if (!input.emailConfirmed) return false;
  if (input.hasVerifiedFactor) return input.aal2;
  return input.mfaOff;
}
