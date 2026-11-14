// Issue #351: a test must not depend on two records written in the same millisecond coming back in the order they
// were written. Timestamps are saved to the millisecond, and `security_events` is indexed on (created_at, id) with a
// random id, so a read ordered by the timestamp alone returns same-millisecond rows in id order: a different order
// on every run. That failed the checks now and then (first seen in tests/sites-leftovers.mjs).
// 1. Ordering by the timestamp and then `rowid` gives the order the rows were written, on the real schema.
// 2. No test reads rows ordered by `created_at` alone.
// 3. `nextMillisecond()` (tests/fixtures/clock.mjs) really moves a test on to a later timestamp, for tests that check
//    the order the site itself returns for something written "later".
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {nextMillisecond} from './fixtures/clock.mjs';

// ---------- 1. Same timestamp, random ids: rowid keeps the order written ----------
const sqlite = new DatabaseSync(':memory:');
for (const f of readdirSync('drizzle').filter(f => f.endsWith('.sql') && !f.includes('_starter_')).sort()) sqlite.exec(readFileSync('drizzle/' + f, 'utf8'));
const written = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];
for (let round = 0; round < 25; round++) {
  sqlite.exec('DELETE FROM security_events');
  for (const target of written)
    sqlite.prepare('INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,?,?,?)').run(crypto.randomUUID(), 'owner', 'test', target, '2026-11-14T12:00:00.000Z');
  assert.deepEqual(sqlite.prepare("SELECT target FROM security_events WHERE action='test' ORDER BY created_at,rowid").all().map(r => r.target), written,
    'rows written in the same millisecond are read in the order they were written');
}

// ---------- 2. No test orders by the timestamp alone ----------
const self = 'same-millisecond-order.mjs', alone = /ORDER BY\s+(?:\w+\.)?created_at\b(?!\s*(?:ASC|DESC)?\s*,)/gi, found = [];
for (const name of readdirSync('tests').filter(n => n.endsWith('.mjs') && n !== self))
  readFileSync('tests/' + name, 'utf8').split('\n').forEach((line, i) => { if (line.match(alone)) found.push(`tests/${name}:${i + 1}`); });
assert.deepEqual(found, [], 'These reads order by created_at alone. Add rowid as a tie-break (ORDER BY created_at,rowid, or created_at DESC,rowid DESC) so rows written in the same millisecond keep the order they were written');

// ---------- 3. The wait between "earlier" and "later" ----------
for (let i = 0; i < 5; i++) {
  const before = new Date().toISOString();
  await nextMillisecond();
  assert.ok(new Date().toISOString() > before, 'the next timestamp sorts after the one before the wait');
}

console.log('Passed: same-millisecond rows read in the order written with a rowid tie-break, no test orders by created_at alone, and nextMillisecond() reaches a later timestamp.');
