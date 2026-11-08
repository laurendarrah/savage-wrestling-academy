// One error path for every API route (issue #274). A route handler that throws used to become an empty 500 from the
// framework, which a page could only show as "Could not load". withApi() catches it, records it in error_log with a
// request id, the area (the path, never the query string) and the role of whoever asked (from the verified identity,
// not the cookie), with anything that looks like an email or a stored value taken out of the message, and answers
// JSON the page can show: {error, requestId}. A Supabase outage (lib/account-auth.ts throws SignInUnavailable) is a 503
// with its own wording, so it never looks like a sign-out.
import {env} from 'cloudflare:workers';
import {isSignInUnavailable, roleFor} from './account-auth';

export type Handler = (request: Request) => Promise<Response> | Response;
// Tells the Worker (build/worker.ts) the error is already in error_log, so it only alerts the owner.
export const RECORDED_HEADER = 'X-SWA-Error-Recorded';
export const REQUEST_ID_HEADER = 'X-Request-Id';
export const GENERIC_ERROR = 'Something went wrong. Try again.';
export const SIGN_IN_UNAVAILABLE = 'Sign-in is temporarily unavailable. Please try again in a few minutes.';

// Error messages can embed what was being saved. Emails, quoted text, ids and long tokens or numbers are replaced
// before the message is stored; the shape of the error (which table, which constraint) stays readable.
export function redact(message: string): string {
  return String(message ?? '')
    .replace(/[^\s@"'<>()]+@[^\s@"'<>()]+\.[^\s@"'<>()]+/g, '<email>')
    .replace(/"(?:[^"\\]|\\.)*"/g, '"…"')
    .replace(/'(?:[^'\\]|\\.)*'/g, "'…'")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
    .replace(/\b[A-Za-z0-9_-]*[0-9][A-Za-z0-9_-]{19,}\b/g, '<token>')
    .replace(/\b\d{6,}\b/g, '<number>')
    .slice(0, 300);
}

export async function recordApiError(db: D1Database | undefined, request: Request, status: number, message: string, requestId: string, role: string) {
  if (!db) return;
  try {
    const path = new URL(request.url).pathname.slice(0, 200);
    await db.batch([
      db.prepare('INSERT INTO error_log(id,at,method,path,status,message,request_id,role) VALUES (?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(), new Date().toISOString(), request.method, path, status, redact(message), requestId, role),
      db.prepare('DELETE FROM error_log WHERE id NOT IN (SELECT id FROM error_log ORDER BY at DESC LIMIT 500)')
    ]);
  } catch { /* never let error logging cause another error */ }
}

export function withApi(handler: Handler): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    try {
      return await handler(request);
    } catch (error) {
      const requestId = crypto.randomUUID(), unavailable = isSignInUnavailable(error), status = unavailable ? 503 : 500;
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      const role = await roleFor(request).catch(() => 'anon');
      await recordApiError((env as Cloudflare.Env & {DB?: D1Database}).DB, request, status, message, requestId, role);
      return Response.json({error: unavailable ? SIGN_IN_UNAVAILABLE : GENERIC_ERROR, requestId},
        {status, headers: {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', [REQUEST_ID_HEADER]: requestId, [RECORDED_HEADER]: '1'}});
    }
  };
}
