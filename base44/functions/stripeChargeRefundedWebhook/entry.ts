import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET');

/**
 * STRIPE WEBHOOK HANDLER: charge.refunded
 * 
 * Receives Stripe charge.refunded events and routes to processStripeRefund.
 * Verifies webhook signature for security.
 * Idempotent via Stripe event ID.
 */

async function verifyWebhookSignature(body, signature) {
  if (!STRIPE_WEBHOOK_SECRET) {
    throw new Error('Stripe webhook secret not configured');
  }

  const encoder = new TextEncoder();
  const key = encoder.encode(STRIPE_WEBHOOK_SECRET);
  const algorithm = { name: 'HMAC', hash: 'SHA-256' };
  const cryptoKey = await crypto.subtle.importKey('raw', key, algorithm, false, ['sign']);

  const parts = signature.split(',');
  let ts = null, sig = null;
  for (const part of parts) {
    if (part.startsWith('t=')) ts = part.split('=')[1];
    if (part.startsWith('v1=')) sig = part.split('=')[1];
  }

  if (!ts || !sig) {
    throw new Error('Invalid signature format');
  }

  const signedContent = `${ts}.${body}`;
  const signatureBuffer = await crypto.subtle.sign(algorithm, cryptoKey, encoder.encode(signedContent));
  const computedSignature = Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  if (computedSignature !== sig) {
    throw new Error('Signature verification failed');
  }

  const now = Math.floor(Date.now() / 1000);
  const diff = Math.abs(now - parseInt(ts));
  if (diff > 300) {
    throw new Error('Webhook signature too old');
  }

  return true;
}

Deno.serve(async (req) => {
  if (req.method === 'POST') {
    const body = await req.text();
    const signature = req.headers.get('stripe-signature');

    // Verify signature
    try {
      await verifyWebhookSignature(body, signature);
    } catch (error) {
      console.error('[STRIPE-CHARGE-REFUNDED] Signature verification failed:', error.message);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    // Return 2xx immediately
    const asyncProcess = (async () => {
      try {
        const event = JSON.parse(body);

        if (event.type !== 'charge.refunded') {
          console.log(`[STRIPE-CHARGE-REFUNDED] Skipping non-refund event: ${event.type}`);
          return;
        }

        const charge = event.data.object;
        console.log(`[STRIPE-CHARGE-REFUNDED] Processing refund for charge ${charge.id}`);

        // Route to processStripeRefund — pass internal secret so the auth guard allows this system call
        const base44 = createClientFromRequest(req);
        const result = await base44.asServiceRole.functions.invoke('processStripeRefund', {
          _internalSecret: Deno.env.get('INTERNAL_FUNCTION_SECRET'),
          stripe_charge_id: charge.id,
          stripe_payment_intent_id: charge.payment_intent,
          stripe_refund_id: charge.refunds?.data?.[0]?.id,
          stripe_event_id: event.id,
          refund_amount: (charge.amount_refunded || 0) / 100,
          charge_amount: (charge.amount || 0) / 100,
        });

        console.log(`[STRIPE-CHARGE-REFUNDED] Processed:`, result.data?.status);
      } catch (error) {
        console.error('[STRIPE-CHARGE-REFUNDED] Processing error:', error.message);
      }
    })();

    asyncProcess.catch(err => console.error('[STRIPE-CHARGE-REFUNDED] Async error:', err.message));

    return new Response(JSON.stringify({ received: true }), { status: 200 });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
});