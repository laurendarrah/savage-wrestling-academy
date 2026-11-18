// The last step before anything leaves the site (issue #363): each renamed program's built-in name is replaced by the
// owner's name. The owner renames a program on Programs & pricing; the names are saved with the academy settings as
// `programNames` (lib/program-names.ts). Everything inside the site keeps the built-in names, so this is the one place
// that decides what people read:
//   - every page, data reply and spreadsheet the Worker sends (renameResponse, called from build/worker.ts),
//   - every email (lib/email.ts),
//   - the product name sent to Stripe (lib/checkout.ts).
// With no renamed program nothing is read and nothing is rewritten.
//
// Left exactly as they are: the owner's raw settings (the Programs form reads the names from them itself), backups
// (a backup file must hold what the database holds), the Stripe webhook's replies and the health checks.
import {env} from 'cloudflare:workers';
import {applyProgramNames, customProgramNames} from './program-names';

type DB = D1Database | undefined;
// The names are read once and kept for a few seconds, so a page that makes several requests reads them once. The Worker
// that saves the owner's settings forgets them straight away; another one catches up within this time.
export const NAMES_KEPT_MS = 5000;
let kept: {at: number; names: Record<string, string>} | null = null;
export function forgetProgramNames() { kept = null; }

export async function currentProgramNames(db: DB = (env as {DB?: D1Database}).DB, now = Date.now()): Promise<Record<string, string>> {
  if (kept && now - kept.at < NAMES_KEPT_MS && now >= kept.at) return kept.names;
  let names: Record<string, string> = {};
  try {
    const row = db ? await db.prepare("SELECT json_extract(payload,'$.programNames') AS names FROM academy_state WHERE id='academy'").first<{names: string | null}>() : null;
    names = row?.names ? customProgramNames({programNames: JSON.parse(row.names)}) : {};
  } catch { names = {}; }
  kept = {at: now, names};
  return names;
}
// One piece of text on its way out: an email's subject and words, a product name for Stripe.
export async function withProgramNames(text: string, db?: DB): Promise<string> {
  return applyProgramNames(text, await currentProgramNames(db));
}

const TEXT_TYPES = /^(?:text\/html|application\/json|text\/csv|text\/plain)\b/i;
const AS_STORED = ['/api/academy', '/api/backups', '/api/stripe-webhook', '/api/health', '/api/setup-status'];
// A response on its way out of the Worker. Never fails the request: if the names cannot be read, the response goes out
// with the built-in names.
export async function renameResponse(request: Request, response: Response, db: DB): Promise<Response> {
  let pathname = '';
  try { pathname = new URL(request.url).pathname; } catch { return response; }
  // The owner just saved the settings, perhaps with a new name: read the names again next time.
  if (pathname === '/api/academy' && request.method !== 'GET') forgetProgramNames();
  if (request.method === 'HEAD' || !response.body || response.status === 204 || response.status === 304) return response;
  if (!TEXT_TYPES.test(response.headers.get('Content-Type') ?? '')) return response;
  if (AS_STORED.some(p => pathname === p || pathname.startsWith(p + '/'))) return response;
  const names = await currentProgramNames(db);
  if (!Object.keys(names).length) return response;
  const text = await response.text();
  const headers = new Headers(response.headers);
  headers.delete('Content-Length');
  return new Response(applyProgramNames(text, names), {status: response.status, statusText: response.statusText, headers});
}
