// A stand-in for USA Wrestling's public verify page (usawmembership.com/verify_membership), for local tests only
// (issue #202). It answers like the real page: a verify page with a CSRF token, a Livewire snapshot and its update
// address, session cookies, and a JSON update whose effects.html is the results table. The tables come from the
// sanitized samples in tests/fixtures/. Every card here is fictional.
//
// Point the site at it with USAW_LOOKUP_BASE=http://127.0.0.1:<port>. Never point a test at the real site.
import http from 'node:http';
import {readFileSync} from 'node:fs';

const fixture = name => readFileSync(new URL(`../../tests/fixtures/${name}`, import.meta.url), 'utf8');
export const CSRF = 'stubCsrfToken0123456789abcdef';
export const COOKIE = 'usaw_stub_session=s1';
export const SNAPSHOT = JSON.stringify({data: {filters: [{usaw_id: null}, {s: 'arr'}]}, memo: {id: 'stub1', name: 'data-tables.resources.verify-memberships', path: 'verify_membership', method: 'GET', children: [], scripts: [], assets: [], errors: [], locale: 'en'}, checksum: 'stub'});
const attr = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#039;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const verifyPage = (updateUri = '/livewire-stub/update') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="csrf-token" content="${CSRF}"><title>Verify Membership</title></head><body>
<div wire:snapshot="${attr(SNAPSHOT)}" wire:effects="[]" wire:id="stub1"><table><tbody></tbody></table></div>
<script src="/livewire-stub/livewire.min.js" data-csrf="${CSRF}" data-update-uri="${updateUri}" data-navigate-once="true"></script></body></html>`;

// The fictional cards this stand-in knows. Every other number is "not found".
export const CARDS = {'1234567890': 'active', '2222222222': 'inactive'};
export function resultsHtml(id) {
  const active = fixture('usaw-found-active.html');
  if (CARDS[id] === 'active') return active;
  if (CARDS[id] === 'inactive') return active.replace(/1234567890/g, id).replace('#66ff33', '#a94442');
  return fixture('usaw-not-found.html');
}

// Starts the stand-in. `seen` records each update request (headers and body), so tests can check what was sent.
export function start(port = 0) {
  const seen = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://stub');
    if (req.method === 'GET' && url.pathname === '/verify_membership') {
      res.writeHead(200, {'content-type': 'text/html; charset=utf-8', 'set-cookie': [`${COOKIE}; Path=/; HttpOnly`, 'XSRF-TOKEN=stub; Path=/']});
      return res.end(verifyPage());
    }
    if (req.method === 'POST' && url.pathname === '/livewire-stub/update') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        let data = null;
        try { data = JSON.parse(body); } catch {}
        seen.push({headers: req.headers, body: data});
        const c = data?.components?.[0];
        const ok = req.headers['x-livewire'] === '1' && req.headers['x-csrf-token'] === CSRF && String(req.headers.cookie || '').includes(COOKIE) &&
          data?._token === CSRF && c?.snapshot === SNAPSHOT && c?.calls?.[0]?.method === 'search';
        if (!ok) { res.writeHead(419, {'content-type': 'application/json'}); return res.end('{"message":"Page Expired"}'); }
        const id = String(c.updates?.['filters.usaw_id'] || '');
        res.writeHead(200, {'content-type': 'application/json'});
        res.end(JSON.stringify({components: [{snapshot: SNAPSHOT, effects: {html: resultsHtml(id), dirty: []}}], assets: []}));
      });
      return;
    }
    res.writeHead(404, {'content-type': 'text/plain'}); res.end('not found');
  });
  return new Promise(r => server.listen(port, '127.0.0.1', () => { server.seen = seen; r(server); }));
}

// Run on its own: node scripts/e2e/fake-usaw.mjs <port>
if (import.meta.url === `file://${process.argv[1]}`) {
  const s = await start(Number(process.argv[2] || 54331));
  console.log('USA Wrestling stand-in on http://127.0.0.1:' + s.address().port);
}
