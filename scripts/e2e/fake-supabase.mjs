// A stand-in for Supabase Auth, for local end-to-end tests only (never production). It answers GET /auth/v1/user
// for the test accounts below, so the real Worker can run signed-in pages without a Supabase project.
import http from 'node:http';

const b64url = s => Buffer.from(s).toString('base64url');
const day = 86400;
// Sign-in is an email and a password, nothing more (issues #306, #347), so every session here is a password one. The
// owner and Coach Dana still have an authenticator saved on their accounts from before Nov 14, as real accounts may:
// the site must never ask for it, and the whole walkthrough runs as them to show that it doesn't.
const leftover = id => [{id, status: 'verified', factor_type: 'totp'}];
export const users = {
  owner: {id: 'e2e-owner', email: 'savagewrestlingclub@gmail.com', factors: leftover('f-owner')},
  family: {id: 'e2e-family-a', email: 'family.a@example.test', factors: []},
  family2: {id: 'e2e-family-b', email: 'family.b@example.test', factors: []},
  // A family that has only just signed up and saved nothing yet (issue #132).
  newfam: {id: 'e2e-family-new', email: 'new.family@example.test', factors: []},
  // The owner's very first sign-in (issue #175).
  freshowner: {id: 'e2e-owner-fresh', email: 'savagewrestlingclub@gmail.com', factors: []},
  coach: {id: 'e2e-coach', email: 'coach.dana@example.test', factors: leftover('f-coach')},
  // A coach the owner invites (issue #190): signed up and confirmed.
  invitee: {id: 'e2e-coach-lee', email: 'coach.lee@example.test', factors: []},
};
// Every request the site makes about authenticators. There should be none; the walkthrough checks at the end.
export const factorCalls = [];
const userJson = u => ({id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: '2026-01-01T00:00:00Z', confirmed_at: '2026-01-01T00:00:00Z',
  app_metadata: {provider: 'email'}, user_metadata: {}, identities: [], factors: u.factors, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z'});
export function token(name) {
  const u = users[name], now = Math.floor(Date.now() / 1000);
  return [b64url(JSON.stringify({alg: 'HS256', typ: 'JWT'})), b64url(JSON.stringify({sub: u.id, email: u.email, aal: 'aal1', amr: [{method: 'password', timestamp: now}], role: 'authenticated', aud: 'authenticated', session_id: 's-' + name, exp: now + day, iat: now})), b64url('e2e')].join('.');
}
// The cookie @supabase/ssr reads: sb-<first label of the Supabase host>-auth-token, base64url JSON of the session.
export function sessionCookie(name, supabaseUrl) {
  const u = users[name], now = Math.floor(Date.now() / 1000);
  const session = {access_token: token(name), token_type: 'bearer', expires_in: day, expires_at: now + day, refresh_token: 'r-' + name, user: userJson(u)};
  return {name: `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url')};
}
export function start(port) {
  const server = http.createServer((req, res) => {
    let sub = null;
    try { sub = JSON.parse(Buffer.from(String(req.headers.authorization || '').replace(/^Bearer /, '').split('.')[1] || '', 'base64url').toString()).sub; } catch {}
    const name = Object.keys(users).find(n => users[n].id === sub);
    const send = (status, body) => { res.writeHead(status, {'content-type': 'application/json'}); res.end(JSON.stringify(body)); };
    if (req.url.startsWith('/auth/v1/user') && name) return send(200, userJson(users[name]));
    if (req.url.startsWith('/auth/v1/factors')) { factorCalls.push(req.method + ' ' + req.url); return send(404, {code: 404, msg: 'not found'}); }
    res.writeHead(401, {'content-type': 'application/json'}); res.end(JSON.stringify({code: 401, msg: 'invalid token'}));
  });
  return new Promise(r => server.listen(port, '127.0.0.1', () => r(server)));
}
