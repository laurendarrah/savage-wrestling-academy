// When an account counts as fully signed in (issues #204, #306). The owner and coaches sign in with email and password
// only, as Lauren and Justin decided on Nov 13 (#306): no authenticator is required unless the Worker setting
// STAFF_MFA is exactly "on". Off is the default so that a deploy that drops the setting can never turn the requirement
// back on. An account that has set up an authenticator still uses it; deleting its factors in Supabase stops that.
export function mfaSwitchedOff(setting: unknown): boolean {
  return String(setting ?? '').trim().toLowerCase() !== 'on';
}
export function fullySignedIn(input: {emailConfirmed: boolean; aal2: boolean; hasVerifiedFactor: boolean; mfaOff: boolean}): boolean {
  if (!input.emailConfirmed) return false;
  if (input.hasVerifiedFactor) return input.aal2;
  return input.mfaOff;
}
