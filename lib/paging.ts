// Paging and batch reads (issue #46). No list or job stops silently at a fixed number of rows.
//
// Owner and coach lists use keyset (cursor) paging: a page ends at a row, and the next page starts strictly after that
// row's sort key. Unlike OFFSET, a row added or removed while someone pages through never makes another row appear
// twice or go missing, and the database never reads past the rows it skips. Every sort ends with a unique column, so the
// key always names one row.
//
// Background jobs, exports and backups read every row in batches (eachBatch), never a capped first page, and stay
// inside D1's limits: at most 100 bound values per statement (IN_CHUNK), and a few queries per batch.
import {env} from 'cloudflare:workers';

export const PAGE_SIZE = 50;
export const BATCH_SIZE = 500;
// D1 allows 100 bound values per statement; keep room for a few more in the same query.
export const IN_CHUNK = 90;

export type Key = (string | number)[];
// A sort column: a SQL expression that is never NULL (wrap nullable columns in COALESCE) and its direction.
export type SortCol = {expr: string; desc?: boolean};

// Base64url over UTF-8, in plain JavaScript (no btoa or TextEncoder), so cursors work the same everywhere.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export const utf8Length = (s: string) => unescape(encodeURIComponent(s)).length;
function b64(text: string) {
  const bytes = unescape(encodeURIComponent(text));
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes.charCodeAt(i) << 16) | ((bytes.charCodeAt(i + 1) || 0) << 8) | (bytes.charCodeAt(i + 2) || 0);
    out += ALPHABET[n >> 18 & 63] + ALPHABET[n >> 12 & 63] + (i + 1 < bytes.length ? ALPHABET[n >> 6 & 63] : '') + (i + 2 < bytes.length ? ALPHABET[n & 63] : '');
  }
  return out;
}
function unb64(text: string) {
  let bytes = '';
  for (let i = 0; i < text.length; i += 4) {
    const v = [0, 1, 2, 3].map(j => i + j < text.length ? ALPHABET.indexOf(text[i + j]) : 0), n = v[0] << 18 | v[1] << 12 | v[2] << 6 | v[3];
    bytes += String.fromCharCode(n >> 16 & 255) + (i + 2 < text.length ? String.fromCharCode(n >> 8 & 255) : '') + (i + 3 < text.length ? String.fromCharCode(n & 255) : '');
  }
  return decodeURIComponent(escape(bytes));
}

// A cursor is the last row's sort key, as opaque URL-safe text.
export function encodeCursor(key: Key): string { return b64(JSON.stringify(key)); }

// The key in a cursor, or null when it is missing, damaged or not the expected shape. A bad cursor shows the first page.
export function decodeCursor(raw: unknown, length: number): Key | null {
  if (typeof raw !== 'string' || !raw || raw.length > 2000 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const key = JSON.parse(unb64(raw));
    return Array.isArray(key) && key.length === length && key.every(v => (typeof v === 'string' && v.length <= 500) || (typeof v === 'number' && Number.isFinite(v))) ? key : null;
  } catch { return null; }
}

// A page size from a query string, within bounds.
export function pageSize(raw: unknown, fallback = PAGE_SIZE, max = 200): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, max) : fallback;
}

export const orderBy = (cols: SortCol[]) => cols.map(c => `${c.expr} ${c.desc ? 'DESC' : 'ASC'}`).join(', ');

// "Comes after this key in this order", as SQL: (a > ?) OR (a = ? AND b > ?) OR ..., with < for descending columns.
export function afterKey(cols: SortCol[], key: Key): {sql: string; args: Key} {
  const parts: string[] = [], args: Key = [];
  cols.forEach((c, i) => {
    const eq = cols.slice(0, i).map(p => `${p.expr} = ?`);
    parts.push('(' + [...eq, `${c.expr} ${c.desc ? '<' : '>'} ?`].join(' AND ') + ')');
    args.push(...key.slice(0, i), key[i]);
  });
  return {sql: '(' + parts.join(' OR ') + ')', args};
}

// "Comes before this key in this order": the same test with every direction turned around.
export const flip = (cols: SortCol[]) => cols.map(c => ({expr: c.expr, desc: !c.desc}));
export const beforeKey = (cols: SortCol[], key: Key) => afterKey(flip(cols), key);

// next: cursor for the page after this one. prev (pages that can go back): cursor for the page before it.
export type Page<T> = {rows: T[]; next: string | null; prev?: string | null};

// One page of a query, in keyset order: SELECT <select> <from> WHERE <where> AND <after the cursor>. `args` are the
// values for placeholders in `from` and `where`, in that order. `keyOf` returns a row's values for `cols`. Reads
// limit+1 rows to know whether another page follows. With `before`, it reads the page that ends just before that
// cursor instead (a "Previous" link), still returned in the list's order.
export type KeysetQuery<T> = {select: string; from: string; where?: string; args?: unknown[]; cols: SortCol[]; keyOf: (row: T) => Key; cursor?: unknown; before?: unknown; limit?: number; db?: D1Database};
export async function keysetPage<T>(q: KeysetQuery<T>): Promise<Page<T>> {
  const db = q.db ?? env.DB!, limit = q.limit ?? PAGE_SIZE, back = decodeCursor(q.before, q.cols.length), key = back ?? decodeCursor(q.cursor, q.cols.length);
  const cols = back ? flip(q.cols) : q.cols, after = key ? afterKey(cols, key) : null, conditions = [q.where, after?.sql].filter(Boolean);
  const rows = (await db.prepare(`SELECT ${q.select} ${q.from}${conditions.length ? ' WHERE ' + conditions.join(' AND ') : ''} ORDER BY ${orderBy(cols)} LIMIT ${limit + 1}`)
    .bind(...(q.args ?? []), ...(after?.args ?? [])).all<T>()).results;
  const more = rows.length > limit, shown = rows.slice(0, limit);
  if (back) {
    shown.reverse();
    return {rows: shown, next: shown.length ? encodeCursor(q.keyOf(shown.at(-1)!)) : null, prev: more ? encodeCursor(q.keyOf(shown[0])) : null};
  }
  return {rows: shown, next: more ? encodeCursor(q.keyOf(shown.at(-1)!)) : null, prev: key && shown.length ? encodeCursor(q.keyOf(shown[0])) : null};
}

// Compares two keys in ascending order, value by value. Numbers before text, as SQLite orders them.
export function compareKeys(a: Key, b: Key): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i], y = b[i];
    if (x === y) continue;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (typeof x !== typeof y) return typeof x === 'number' ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

// Keyset paging over a list worked out in memory (card and waiver status are computed from each family's record, so
// they cannot be sorted in SQL). The key must end with something unique. Rows are sorted here.
export function pageOf<T>(all: T[], keyOf: (row: T) => Key, cursor: unknown, limit = PAGE_SIZE): Page<T> & {total: number} {
  const keyed = all.map(row => ({row, key: keyOf(row)})).sort((a, b) => compareKeys(a.key, b.key));
  const first = keyed.length ? keyed[0].key.length : 0, key = first ? decodeCursor(cursor, first) : null;
  const rest = key ? keyed.filter(r => compareKeys(r.key, key) > 0) : keyed, shown = rest.slice(0, limit);
  return {rows: shown.map(r => r.row), next: rest.length > limit ? encodeCursor(shown.at(-1)!.key) : null, total: all.length};
}

// Every row of a query, in batches, for jobs, exports and backups. `key` is a unique column (or columns) to walk in
// order, selected under the same name; the query has no ORDER BY or LIMIT of its own. Ends after the last row.
export async function* eachBatch<T>(q: {select: string; from: string; where?: string; args?: unknown[]; key: string[]; size?: number; db?: D1Database}): AsyncGenerator<T[]> {
  const cols = q.key.map(expr => ({expr})), size = q.size ?? BATCH_SIZE;
  let cursor: string | null = null;
  do {
    const page: Page<T> = await keysetPage<T>({...q, cols, keyOf: row => q.key.map(k => (row as any)[k.split('.').at(-1)!]), cursor, limit: size});
    if (page.rows.length) yield page.rows;
    cursor = page.next;
  } while (cursor);
}

export type FamilyRow = {user_id: string; email: string; payload: string};
// Every family account, in batches of BATCH_SIZE, by user id.
export const eachFamily = (size = BATCH_SIZE, db?: D1Database) => eachBatch<FamilyRow>({select: 'user_id,email,payload', from: 'FROM family_accounts', key: ['user_id'], size, db});
export const allFamilies = async (db?: D1Database) => { const out: FamilyRow[] = []; for await (const rows of eachFamily(BATCH_SIZE, db)) out.push(...rows); return out; };

// Splits a list into pieces of at most `size`, for IN (...) lists and multi-row inserts.
export function chunks<T>(list: T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// Splits rows into pieces whose JSON stays under `maxBytes`, so one bound value never reaches D1's 2 MB limit.
export function jsonChunks<T>(rows: T[], maxBytes = 500000): T[][] {
  const out: T[][] = [];
  let current: T[] = [], size = 2;
  for (const row of rows) {
    const n = utf8Length(JSON.stringify(row)) + 1;
    if (current.length && size + n > maxBytes) { out.push(current); current = []; size = 2; }
    current.push(row); size += n;
  }
  if (current.length) out.push(current);
  return out;
}

// A LIKE pattern that matches the text anywhere, with % and _ in the search taken literally (use with ESCAPE '\').
export const likeAny = (text: string) => '%' + text.toLowerCase().replace(/[\\%_]/g, c => '\\' + c) + '%';
