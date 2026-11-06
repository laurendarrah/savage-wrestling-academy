// A stand-in for Supabase Auth, for local end-to-end tests only (never production). It answers GET /auth/v1/user
// for the test accounts below, so the real Worker can run signed-in pages without a Supabase project.
import http from 'node:http';

const b64url = s => Buffer.from(s).toString('base64url');
const day = 86400;
export const users = {
  owner: {id: 'e2e-owner', email: 'savagewrestlingclub@gmail.com', factors: [{id: 'f-owner', status: 'verified', factor_type: 'totp'}], aal: 'aal2'},
  family: {id: 'e2e-family-a', email: 'family.a@example.test', factors: [], aal: 'aal1'},
  family2: {id: 'e2e-family-b', email: 'family.b@example.test', factors: [], aal: 'aal1'},
  coach: {id: 'e2e-coach', email: 'coach.dana@example.test', factors: [{id: 'f-coach', status: 'verified', factor_type: 'totp'}], aal: 'aal2'},
};
const userJson = u => ({id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: '2026-01-01T00:00:00Z', confirmed_at: '2026-01-01T00:00:00Z',
  app_metadata: {provider: 'email'}, user_metadata: {}, identities: [], factors: u.factors, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z'});
export function token(name) {
  const u = users[name], now = Math.floor(Date.now() / 1000);
  return [b64url(JSON.stringify({alg: 'HS256', typ: 'JWT'})), b64url(JSON.stringify({sub: u.id, email: u.email, aal: u.aal, amr: [{method: 'password', timestamp: now}], role: 'authenticated', aud: 'authenticated', session_id: 's-' + name, exp: now + day, iat: now})), b64url('e2e')].join('.');
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
    // Authenticator setup on /security: start enrolling, remove an unfinished one, and refuse every code except 123456
    // (a correct code would need a new session, which this stand-in does not issue).
    const factor = req.url.match(/^\/auth\/v1\/factors(?:\/([^/?]+))?(?:\/(challenge|verify))?/);
    if (factor && name) {
      const u = users[name], [, id, act] = factor;
      if (req.method === 'POST' && !id) { const f = {id: 'f-new-' + Date.now(), status: 'unverified', factor_type: 'totp', friendly_name: 'e2e'}; u.factors = [...u.factors, f];
        return send(200, {id: f.id, type: 'totp', friendly_name: f.friendly_name, totp: {qr_code: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>', secret: 'E2ETESTSECRET', uri: 'otpauth://totp/e2e'}}); }
      if (req.method === 'DELETE' && id) { u.factors = u.factors.filter(f => f.id !== id || f.status === 'verified'); return send(200, {id}); }
      if (act === 'challenge') return send(200, {id: 'c-' + id, type: 'totp', expires_at: Math.floor(Date.now() / 1000) + 300});
      if (act === 'verify') return send(422, {code: 'mfa_verification_failed', msg: 'Invalid TOTP code entered'});
    }
    res.writeHead(401, {'content-type': 'application/json'}); res.end(JSON.stringify({code: 401, msg: 'invalid token'}));
  });
  return new Promise(r => server.listen(port, '127.0.0.1', () => r(server)));
}
