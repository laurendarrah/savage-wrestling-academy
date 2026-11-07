// Finding a family in the database (issue #46), so owner pages search every family instead of filtering the first few
// hundred in the browser. A search matches the parent's name, email, phone and wrestlers' names, ignoring case.
import {env} from 'cloudflare:workers';
import {likeAny} from './paging';

// The searchable text of a family_accounts row aliased `f`, in lower case.
export const FAMILY_TEXT = `lower(f.email || ' ' || COALESCE(json_extract(f.payload,'$.parentName'),'') || ' ' || COALESCE(json_extract(f.payload,'$.phone'),'') || ' ' ||
  COALESCE((SELECT group_concat(json_extract(w.value,'$.name'),' ') FROM json_each(f.payload,'$.wrestlers') w),''))`;

// SQL and value for "this family matches the search", or nothing for an empty search.
export function familyMatch(q: unknown): {sql: string; args: string[]} | null {
  const text = typeof q === 'string' ? q.trim().slice(0, 100) : '';
  return text ? {sql: `${FAMILY_TEXT} LIKE ? ESCAPE '\\'`, args: [likeAny(text)]} : null;
}

// A short list of families for a picker: the first `limit` matches by email, and whether there are more.
// Pickers say "Showing the first N; type more of a name" rather than paging.
export async function findFamilies(q: unknown, limit = 50) {
  const m = familyMatch(q);
  const rows = (await env.DB!.prepare(`SELECT f.user_id,f.email,f.payload FROM family_accounts f${m ? ' WHERE ' + m.sql : ''} ORDER BY f.email, f.user_id LIMIT ${limit + 1}`)
    .bind(...(m?.args ?? [])).all<{user_id: string; email: string; payload: string}>()).results;
  return {rows: rows.slice(0, limit), more: rows.length > limit};
}
