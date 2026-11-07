// A local stand-in for Cloudflare D1 on node:sqlite, for paging and load tests (issue #46). It applies every migration
// to an empty in-memory database and enforces D1's per-statement limits, so code that would fail on D1 fails here:
// at most 100 bound values per statement, no bound value or SQL text over the documented sizes. It also counts
// statements, so a test can check that a job's database work stays within D1's per-run query limit.
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
import ts from 'typescript';
import path from 'node:path';

export const D1_LIMITS = {params: 100, valueBytes: 2000000, sqlBytes: 100000, queriesPerRun: 1000};

export function makeDb() {
  const sqlite = new DatabaseSync(':memory:');
  for (const f of readdirSync('drizzle').filter(f => f.endsWith('.sql') && !f.includes('_starter_')).sort()) sqlite.exec(readFileSync('drizzle/' + f, 'utf8'));
  const stats = {queries: 0};
  const check = (sql, args) => {
    if (Buffer.byteLength(sql) > D1_LIMITS.sqlBytes) throw Error(`D1 limit: SQL statement is ${Buffer.byteLength(sql)} bytes`);
    if (args.length > D1_LIMITS.params) throw Error(`D1 limit: ${args.length} bound values in one statement`);
    for (const a of args) if (typeof a === 'string' && Buffer.byteLength(a) > D1_LIMITS.valueBytes) throw Error(`D1 limit: a bound value of ${Buffer.byteLength(a)} bytes`);
  };
  const DB = {
    prepare(sql) {
      let args = [];
      const stmt = {
        bind(...v) { args = v; return stmt; },
        async first() { check(sql, args); stats.queries++; return sqlite.prepare(sql).get(...args) ?? null; },
        async all() { check(sql, args); stats.queries++; return {results: sqlite.prepare(sql).all(...args)}; },
        async run() { check(sql, args); stats.queries++; return {meta: sqlite.prepare(sql).run(...args)}; },
        _execute() { check(sql, args); const s = sqlite.prepare(sql); return s.columns().length ? {results: s.all(...args), meta: {}} : {results: [], meta: s.run(...args)}; }
      };
      return stmt;
    },
    // A batch is one round trip (one query against the per-run limit) and one transaction.
    async batch(list) { stats.queries++; sqlite.exec('BEGIN'); try { const r = list.map(s => s._execute()); sqlite.exec('COMMIT'); return r; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } }
  };
  return {sqlite, DB, stats};
}

// Loads app and lib TypeScript files into a VM, with the platform modules replaced by test stand-ins. `actor` is read
// on every call, so a test can switch between the owner and a family.
export function loader(env, actor = {owner: true, id: 'owner-id'}) {
  const cache = new Map();
  function load(file) {
    file = path.resolve(file);
    if (cache.has(file)) return cache.get(file);
    const module = {exports: {}}; cache.set(file, module.exports);
    vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
      {module, exports: module.exports, crypto, btoa, atob, TextEncoder, TextDecoder, Uint8Array, Intl, Date, URL, URLSearchParams, Response, Request, Headers, ReadableStream, JSON, Math, Number, String, Array, Set, Map, Object, Promise, console, setTimeout,
        fetch: async () => { throw Error('no network in tests'); },
        require(name) {
          if (name === 'cloudflare:workers') return {env};
          if (name.endsWith('/account-auth')) return {appOrigin: () => 'https://swa.test', OWNER_EMAIL: 'owner@example.test',
            ownerIdentity: async () => ({owner: actor.owner ? {userId: actor.id} : null, user: {id: actor.id}, headers: new Headers()}),
            strongAccount: async () => ({user: {id: actor.id, email: actor.id + '@example.test', email_confirmed_at: 'y'}, strong: true, headers: new Headers()}),
            sameOrigin: () => true, accountReply: (b, s = 200, h) => Response.json(b, {status: s, headers: h})};
          if (name.endsWith('/rate-limit')) return {rateLimited: async () => false};
          if (name.endsWith('/access-control')) return {accountRole: async () => ({role: actor.owner ? 'owner' : 'family', staff: null})};
          if (name.endsWith('/stripe-test')) return {storedStripeKeyFor: async () => null, stripeClientFor: () => null, stripeMode: () => 'test'};
          if (name.endsWith('/usaw-check')) return {checkCard: async () => ({outcome: 'unavailable', reason: 'not in tests'})};
          if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
          throw Error('unexpected import ' + name);
        }});
    return module.exports;
  }
  return load;
}

// Calls a route handler and returns the status and JSON (or text) body.
export async function call(route, url, init) {
  const r = await route[init?.method ?? 'GET'](new Request('https://swa.test' + url, init && {...init, headers: {'content-type': 'application/json', origin: 'https://swa.test'}, body: JSON.stringify(init.body)}));
  const text = await r.text();
  try { return {status: r.status, body: JSON.parse(text), headers: r.headers}; } catch { return {status: r.status, body: text, headers: r.headers}; }
}
