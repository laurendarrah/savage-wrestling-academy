// The restore drill's check (issue #25, docs/RESTORE_DRILL.md): opens an encrypted backup file with the same code as the
// Backups page (public/security-backup.js) and compares the rows in each of its sections with the rows in a local
// database. Used by scripts/restore-drill.mjs and tests/restore-drill.mjs. Never reads or writes the passphrase anywhere.
import {openAsBlob} from 'node:fs';
import {openBackup} from '../public/security-backup.js';

// Sections of a backup file and the table each one is restored into. Every other section has its table's name.
export const SECTION_TABLES = {families: 'family_accounts', openings: 'coach_openings'};
// In the file but never restored, by design (lib/backup-records.ts): the security log stays as it is on the site.
export const NOT_RESTORED = {security_events: 'Security activity is in the file but never restored, so the log cannot be rewritten from a file.'};
export const tableFor = section => SECTION_TABLES[section] ?? section;
const safeName = name => /^[a-z][a-z0-9_]{0,63}$/.test(name);

// Decrypts and checks a backup file: its header (when it was made) and the number of rows in each section.
export async function openBackupFile(file, passphrase) {
  const opened = await openBackup(await openAsBlob(file), passphrase);
  return {createdAt: opened.header.createdAt, version: opened.header.version, academy: !!opened.header.academy, rows: opened.rows};
}

// One query that counts the rows of every table that exists in the local database, as one row with a column per table.
// (D1 refuses a long UNION ALL: "too many terms in compound SELECT".)
export function countSql(tables) {
  const names = [...new Set(tables)].filter(safeName);
  return names.length ? 'SELECT ' + names.map(t => `(SELECT count(*) FROM "${t}") AS "${t}"`).join(', ') : null;
}

// Each section of the file against its table in the local database. `status`:
//   match    the same number of rows
//   extra    more rows locally than in the file (rows the local site made itself, such as an alert marker)
//   missing  fewer rows locally: these did not all come back
//   skipped  never restored by design, or not a table this site has
export function compareCounts(fileRows, localCounts) {
  return Object.entries(fileRows).map(([section, inFile]) => {
    const table = tableFor(section), local = localCounts[table];
    if (NOT_RESTORED[section]) return {section, table, inFile, local: null, status: 'skipped', note: NOT_RESTORED[section]};
    if (local === undefined) return {section, table, inFile, local: null, status: inFile ? 'missing' : 'skipped', note: 'This local site has no such table.'};
    return {section, table, inFile, local, status: local === inFile ? 'match' : local > inFile ? 'extra' : 'missing', note: ''};
  }).sort((a, b) => a.table < b.table ? -1 : 1);
}

// The comparison as lines for the terminal, and whether every restored table came back.
export function report(rows) {
  const width = Math.max(...rows.map(r => r.table.length), 5);
  const word = {match: 'match', extra: 'more here', missing: 'MISSING', skipped: 'not restored'};
  const lines = [`${'Table'.padEnd(width)}  ${'In file'.padStart(8)}  ${'Local'.padStart(8)}  Result`,
    ...rows.map(r => `${r.table.padEnd(width)}  ${String(r.inFile).padStart(8)}  ${(r.local === null ? '-' : String(r.local)).padStart(8)}  ${word[r.status]}${r.note ? '  (' + r.note + ')' : ''}`)];
  const missing = rows.filter(r => r.status === 'missing');
  return {lines, ok: !missing.length, missing: missing.map(r => r.table)};
}
