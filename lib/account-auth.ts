import { env } from 'cloudflare:workers';
import { createServerClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr';
import type { User } from '@supabase/supabase-js';
import { fullySignedIn, mfaSwitchedOff } from './mfa-policy';
import { SUPABASE_TIMEOUT_MS, timedFetch } from './net';

export const OWNER_EMAIL = 'savagewrestlingclub@gmail.com';
// Origin used in sign-up, resend and password-reset email links.
// Set APP_ORIGIN per environment (for example http://127.0.0.1:5173 locally, or a custom domain later).
// Every origin used here must also be in the Supabase Auth redirect allowlist.
// There is no default (issue #119): the site moved off its old chatgpt.site address, and an email link to the wrong
// address is worse than a clear error. Set APP_ORIGIN on every deployment.
export function appOrigin(): string {
 const configured = (env as {APP_ORIGIN?: string}).APP_ORIGIN?.trim();
 if (!configured) throw new Error('APP_ORIGIN is not set. Set it to the site address, for example https://register.savagewrestling.com.');
 let url: URL;
 try { url = new URL(configured); } catch { throw new Error('APP_ORIGIN must be an absolute URL.'); }
 const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
 if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) throw new Error('APP_ORIGIN must use https outside local development.');
 return url.origin;
}
// The Supabase project address, checked like APP_ORIGIN (issue #274): https, except a local stand-in on loopback.
export function supabaseUrl(configured: string | undefined): string {
 const value = configured?.trim();
 if (!value) throw new Error('Account sign-in is not configured.');
 let url: URL;
 try { url = new URL(value); } catch { throw new Error('SUPABASE_URL must be an absolute URL.'); }
 const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
 if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) throw new Error('SUPABASE_URL must use https outside local development.');
 return url.origin;
}
// The browser's access to device features (issue #274): the camera for the roster's pass scanner, nothing else.
export const PERMISSIONS_POLICY = 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()';
export function securityHeaders() {
 return new Headers({'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY',
  'Content-Security-Policy':"frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",'Permissions-Policy':PERMISSIONS_POLICY});
}
export function accountClient(request: Request) {
 const headers = securityHeaders();
 const config=env as Cloudflare.Env & {SUPABASE_URL?:string;SUPABASE_PUBLISHABLE_KEY?:string};
 if(!config.SUPABASE_URL||!config.SUPABASE_PUBLISHABLE_KEY) throw new Error('Account sign-in is not configured.');
 const client=createServerClient(supabaseUrl(config.SUPABASE_URL),config.SUPABASE_PUBLISHABLE_KEY,{
  // Every call to Supabase gives up after a few seconds (issue #274) instead of holding the request open.
  global:{fetch:timedFetch(SUPABASE_TIMEOUT_MS)},
  cookieOptions:{httpOnly:true,secure:true,sameSite:'lax',path:'/'},
  cookies:{getAll(){return parseCookieHeader(request.headers.get('cookie')??'').map(c=>({name:c.name,value:c.value??''}))},setAll(cookies,cacheHeaders){for(const {name,value,options} of cookies)headers.append('Set-Cookie',serializeCookieHeader(name,value,{...options,httpOnly:true,secure:true,sameSite:'lax',path:'/'}));for(const [name,value] of Object.entries(cacheHeaders??{})) headers.set(name,value)}},
 });
 return {client,headers};
}
export function verifiedOwner(user: User | null): boolean {return !!user?.email_confirmed_at && user.email?.toLowerCase()===OWNER_EMAIL}

// Supabase could not be reached, or answered with a server error (issue #274). This is not "signed out": routes let
// it through to the API wrapper (lib/api.ts), which answers 503 and records it, so an outage never looks like a
// mass sign-out and never redirects people to the sign-in page.
export class SignInUnavailable extends Error {
 status = 503;
 constructor(message = 'The sign-in service could not be reached.') { super(message); this.name = 'SignInUnavailable'; }
}
export const isSignInUnavailable = (e: unknown): e is SignInUnavailable => e instanceof Error && e.name === 'SignInUnavailable';
const retryable = (error: {status?: number; name?: string; code?: string} | null) =>
 !!error && (error.name === 'AuthRetryableFetchError' || error.status === 0 || (typeof error.status === 'number' && error.status >= 500) || error.code === 'unexpected_failure');

// The claims in the session's own token: `aal` (authenticator level) and `sub` (user id). Read from the cookie, so it
// costs no call to Supabase. Never a substitute for getUser(): only getUser() proves the session is still valid.
export type SessionClaims = {sub?: string; aal?: string; amr?: {method: string}[]};
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export function decodeClaims(token: string | undefined | null): SessionClaims | null {
 if (!token) return null;
 try {
  const part = (token.split('.')[1] ?? '').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  let bytes = '';
  for (let i = 0; i < part.length; i += 4) {
   const v = [0, 1, 2, 3].map(j => i + j < part.length ? B64.indexOf(part[i + j]) : 0), n = v[0] << 18 | v[1] << 12 | v[2] << 6 | v[3];
   bytes += String.fromCharCode(n >> 16 & 255) + (i + 2 < part.length ? String.fromCharCode(n >> 8 & 255) : '') + (i + 3 < part.length ? String.fromCharCode(n & 255) : '');
  }
  return JSON.parse(decodeURIComponent(escape(bytes)));
 } catch { return null; }
}
export async function sessionClaims(client: {auth: {getSession(): Promise<{data: {session: {access_token: string} | null}}>}}): Promise<SessionClaims | null> {
 try { return decodeClaims((await client.auth.getSession()).data.session?.access_token); } catch { return null; }
}

// Who is asking, worked out once per request (issue #274): one getUser() round trip, the authenticator level from the
// session token, and the role once lib/access-control.ts has looked it up. Every helper below reads this.
export type Identity = {client: ReturnType<typeof accountClient>['client']; headers: Headers; user: User | null; aal2: boolean};
const identities = new WeakMap<Request, Promise<Identity>>();
async function resolveIdentity(request: Request): Promise<Identity> {
 const auth = accountClient(request);
 const {data: {user}, error} = await auth.client.auth.getUser();
 if (error && retryable(error)) throw new SignInUnavailable();
 const claims = !error && user ? await sessionClaims(auth.client) : null;
 return {...auth, user: error ? null : user, aal2: claims?.aal === 'aal2'};
}
export function identityFor(request: Request): Promise<Identity> {
 let pending = identities.get(request);
 if (!pending) { pending = resolveIdentity(request); identities.set(request, pending); }
 return pending;
}
// The role of whoever made this request, for the error log (lib/api.ts): from the verified identity, never from the
// cookie alone. Only read on the error path, so the coach lookup there costs nothing on a normal request.
export async function roleFor(request: Request): Promise<'owner' | 'coach' | 'family' | 'anon'> {
 const pending = identities.get(request);
 if (!pending) return 'anon';
 try {
  const id = await pending;
  if (!id.user?.email_confirmed_at) return 'anon';
  if (verifiedOwner(id.user)) return 'owner';
  const staff = await (env as Cloudflare.Env & {DB?: D1Database}).DB?.prepare('SELECT 1 FROM staff_access WHERE email=? AND active=1').bind(id.user.email!.toLowerCase()).first();
  return staff ? 'coach' : 'family';
 } catch { return 'anon'; }
}

export async function verifiedAccount(request: Request) {
 const id = await identityFor(request);
 return {client: id.client, headers: id.headers, user: id.user};
}
export async function strongAccount(request: Request) {
 const id = await identityFor(request), auth = {client: id.client, headers: id.headers, user: id.user};
 let strong=false;
 if(auth.user?.email_confirmed_at){
 const hasVerifiedFactor=!!auth.user.factors?.some(f=>f.status==='verified'&&f.factor_type==='totp');
 // STAFF_MFA=off lets accounts without an authenticator through until launch (issue #204, lib/mfa-policy.ts).
 strong=fullySignedIn({emailConfirmed:true,aal2:id.aal2,hasVerifiedFactor,mfaOff:mfaSwitchedOff((env as {STAFF_MFA?:string}).STAFF_MFA)});
 }
 return {...auth,strong};
}
export async function ownerIdentity(request: Request) {
 const auth=await strongAccount(request);
 return {...auth,mfaRequired:verifiedOwner(auth.user)&&!auth.strong,owner:verifiedOwner(auth.user)&&auth.strong?{userId:'supabase:'+auth.user!.id,displayName:auth.user!.email!}:null};
}
export function sameOrigin(request:Request){return request.headers.get('origin')===new URL(request.url).origin}
export function accountReply(body:unknown,status=200,headers?:Headers){return Response.json(body,{status,headers:headers??{'Cache-Control':'private, no-store'}})}
