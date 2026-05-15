import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * shopifyWebhookProbe — Diagnostic endpoint to confirm Shopify can reach Base44
 *
 * NO HMAC verification — purely for connectivity testing.
 * After confirming connectivity, delete this function or disable it.
 *
 * Point a Shopify test webhook at this URL and check the delivery logs.
 * The function logs every header and body it receives.
 */
Deno.serve(async (req) => {
  const rawBody = await req.text();
  const headers = {};
  for (const [k, v] of req.headers.entries()) headers[k] = v;

  const topic = headers['x-shopify-topic'] || 'unknown';
  const hmacHeader = headers['x-shopify-hmac-sha256'] || 'MISSING';
  const shopDomain = headers['x-shopify-shop-domain'] || 'unknown';

  console.log(`[SHOPIFY-PROBE] *** WEBHOOK RECEIVED ***`);
  console.log(`[SHOPIFY-PROBE] topic=${topic} shop=${shopDomain}`);
  console.log(`[SHOPIFY-PROBE] hmac_header=${hmacHeader}`);
  console.log(`[SHOPIFY-PROBE] body_length=${rawBody.length}`);

  let parsed = null;
  try {
    parsed = JSON.parse(rawBody);
    console.log(`[SHOPIFY-PROBE] order_id=${parsed.id} order_number=${parsed.name || parsed.order_number} source_name=${parsed.source_name} location_id=${parsed.location_id} financial_status=${parsed.financial_status}`);
  } catch (_) {
    console.log(`[SHOPIFY-PROBE] body is not JSON: ${rawBody.substring(0, 200)}`);
  }

  // Log to HubAlert so it shows up in the Hub UI too
  try {
    const base44 = createClientFromRequest(req);
    await base44.asServiceRole.entities.HubAlert.create({
      title: `Shopify Probe: ${topic} received`,
      message: `Shop: ${shopDomain} | HMAC: ${hmacHeader.substring(0, 10)}... | Order: ${parsed?.name || parsed?.order_number || 'N/A'} | source_name: ${parsed?.source_name || 'N/A'} | location_id: ${parsed?.location_id || 'N/A'} | financial_status: ${parsed?.financial_status || 'N/A'}`,
      category: 'Sync',
      severity: 'info',
      source: 'shopifyWebhookProbe',
    });
  } catch (err) {
    console.log(`[SHOPIFY-PROBE] HubAlert log failed (non-critical): ${err.message}`);
  }

  return Response.json({ received: true, topic, probe: true }, { status: 200 });
});