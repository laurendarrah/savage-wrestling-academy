// Stripe webhook endpoint (issues #19 and #26). Stripe already has a disabled endpoint registered for this path.
// Test and live endpoints can both point here with different signing secrets. An event must be signed with
// the secret for its own mode: a test-signed event claiming to be live, or the reverse, is refused.
// Responds 200 once an event is recorded, including rejected ones, so Stripe does not retry forever.
import {verifyStripeSignature, applyStripeEvent} from '../../../lib/stripe-webhook';
import {webhookSecret, type StripeMode} from '../../../lib/checkout-config';
export const dynamic = 'force-dynamic';
const MAX_BODY = 512 * 1024;

export async function POST(request: Request) {
  const secrets = (['test', 'live'] as StripeMode[]).map(mode => ({mode, secret: webhookSecret(mode)})).filter(s => s.secret);
  if (!secrets.length) return Response.json({error: 'Webhook not configured.'}, {status: 503});
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) return Response.json({error: 'Too large.'}, {status: 413});
  const raw = await request.text();
  if (raw.length > MAX_BODY) return Response.json({error: 'Too large.'}, {status: 413});
  const header = request.headers.get('stripe-signature');
  let signedMode: StripeMode | null = null;
  for (const s of secrets) if (await verifyStripeSignature(raw, header, s.secret!)) { signedMode = s.mode; break; }
  if (!signedMode) return Response.json({error: 'Invalid signature.'}, {status: 400});
  let event: any;
  try { event = JSON.parse(raw); } catch { return Response.json({error: 'Invalid payload.'}, {status: 400}); }
  if (Boolean(event?.livemode) !== (signedMode === 'live')) return Response.json({error: 'Event mode does not match its signing secret.'}, {status: 400});
  try {
    const result = await applyStripeEvent(event);
    return Response.json({received: true, outcome: result.outcome, duplicate: result.duplicate});
  } catch {
    // Not recorded: let Stripe retry.
    return Response.json({error: 'Could not process event.'}, {status: 500});
  }
}
