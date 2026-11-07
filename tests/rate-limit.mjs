// Issue #114: per-address rate limits are counted per feature, so families on a shared network cannot lock each other
// out of unrelated features. Sign-in keeps one per-address counter across every account.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
import ts from 'typescript';

const sqlite = new DatabaseSync(':memory:');
for (const f of readdirSync('drizzle').filter(f => f.endsWith('.sql') && !f.includes('_starter_')).sort()) sqlite.exec(readFileSync('drizzle/' + f, 'utf8'));
const DB = {prepare(sql) { let a = []; return {bind(...v) { a = v; return this; }, async first() { return sqlite.prepare(sql).get(...a) ?? null; }, async run() { return {meta: sqlite.prepare(sql).run(...a)}; }}; }};
const module = {exports: {}};
vm.runInNewContext(ts.transpileModule(readFileSync('lib/rate-limit.ts', 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
  {module, exports: module.exports, crypto, TextEncoder, Uint8Array, Array, Math, Date, require: n => { if (n === 'cloudflare:workers') return {env: {DB}}; throw Error(n); }});
const {rateLimited} = module.exports;
const from = ip => new Request('https://a.test/x', {headers: {'cf-connecting-ip': ip}});
const times = async (n, fn) => { const out = []; for (let i = 0; i < n; i++) out.push(await fn(i)); return out; };

// One account, one feature: the feature's limit applies.
let r = await times(6, () => rateLimited(from('203.0.113.1'), 'my-data:p1', 5));
assert.deepEqual(r, [false, false, false, false, false, true]);

// Busy families on the academy WiFi doing other things do not block data downloads for another family.
await times(40, i => rateLimited(from('198.51.100.7'), 'waiver:family' + i, 30));
assert.equal(await rateLimited(from('198.51.100.7'), 'my-data:family-z', 5), false, 'unrelated feature not blocked');
// Within one feature, the shared address is still limited (one network cannot hammer one feature).
r = await times(6, i => rateLimited(from('192.0.2.9'), 'my-data:other' + i, 5));
assert.equal(r.at(-1), true, 'per-address limit within a feature still applies');

// Sign-in: one counter per address across all emails, so trying many accounts from one address is still stopped.
r = await times(11, i => rateLimited(from('203.0.113.50'), `user${i}@example.test`, 10));
assert.equal(r.at(-1), true, 'sign-in attempts across accounts from one address are limited');
assert.equal(await rateLimited(from('203.0.113.50'), 'payments:owner', 60), false, 'sign-in attempts do not block other features');

// Issue #202: an hourly window, and a separate limit for the shared address. USA Wrestling card checks allow a few per
// family per hour while families on the academy WiFi share a higher address limit.
r = await times(6, () => rateLimited(from('203.0.113.77'), 'usaw-lookup:fam1', 5, {windowMinutes: 60, ipLimit: 40}));
assert.deepEqual(r, [false, false, false, false, false, true], 'five an hour for one family');
r = await times(10, i => rateLimited(from('203.0.113.77'), 'usaw-lookup:other' + i, 5, {windowMinutes: 60, ipLimit: 40}));
assert.ok(r.every(x => !x), 'other families on the same network are not blocked by one family');
r = await times(40, i => rateLimited(from('203.0.113.77'), 'usaw-lookup:more' + i, 5, {windowMinutes: 60, ipLimit: 40}));
assert.equal(r.at(-1), true, 'the address limit still applies');
// An hourly counter never shares a row with a one-minute counter of the same name.
assert.equal(await rateLimited(from('203.0.113.78'), 'usaw-lookup:fam1', 5), false);
// ipLimit null counts the account only (a site-wide cap).
r = await times(4, i => rateLimited(from('198.51.100.' + i), 'usaw-site:all', 3, {windowMinutes: 60, ipLimit: null}));
assert.deepEqual(r, [false, false, false, true]);
const rows = sqlite.prepare('SELECT id,bucket FROM auth_attempts').all();
assert.ok(rows.filter(x => x.bucket % 60 === 0).length >= 3, 'hourly buckets start on the hour');
console.log('Rate limit tests passed');
