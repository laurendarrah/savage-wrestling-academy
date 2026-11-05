// Stripe webhook endpoint (issue #19). Stripe already has a disabled endpoint registered for this path.
// Responds 200 once an event is recorded, including rejected ones, so Stripe does not retry forever.
import {env} from 'cloudflare:workers';
import {verifyStripeSignature, applyStripeEvent} from '../../../lib/stripe-webhook';
export const dynamic = 'force-dynamic';
const MAX_BODY = 512 * 1024;

export async function POST(request: Request) {
  const secret = (env as Cloudflare.Env & {STRIPE_TEST_WEBHOOK_SECRET?: string}).STRIPE_TEST_WEBHOOK_SECRET;
  if (!secret) return Response.json({error: 'Webhook not configured.'}, {status: 503});
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) return Response.json({error: 'Too large.'}, {status: 413});
  const raw = await request.text();
  if (raw.length > MAX_BODY) return Response.json({error: 'Too large.'}, {status: 413});
  if (!await verifyStripeSignature(raw, request.headers.get('stripe-signature'), secret)) return Response.json({error: 'Invalid signature.'}, {status: 400});
  let event: any;
  try { event = JSON.parse(raw); } catch { return Response.json({error: 'Invalid payload.'}, {status: 400}); }
  try {
    const result = await applyStripeEvent(event);
    return Response.json({received: true, outcome: result.outcome, duplicate: result.duplicate});
  } catch {
    // Not recorded: let Stripe retry.
    return Response.json({error: 'Could not process event.'}, {status: 500});
  }
}
