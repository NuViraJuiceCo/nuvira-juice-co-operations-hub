import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * shopifyWebhookProbe — Simple webhook reachability test
 * 
 * Purpose: Prove the endpoint is externally reachable and logs requests.
 * Returns 200 for ANY POST request, logs all headers/body.
 * Does NOT verify HMAC — that's added later after reachability is proven.
 */

Deno.serve(async (req) => {
  const timestamp = new Date().toISOString();
  const logs = [];
  
  try {
    // Capture raw body
    const rawBody = await req.text();
    
    // Log method and URL
    logs.push(`[PROBE] ${timestamp}`);
    logs.push(`[PROBE] Method: ${req.method}`);
    logs.push(`[PROBE] URL: ${req.url}`);
    logs.push(`[PROBE] Content-Type: ${req.headers.get('content-type') || 'NOT SET'}`);
    logs.push(`[PROBE] Body length: ${rawBody.length} bytes`);
    logs.push(`[PROBE] Body preview: ${rawBody.substring(0, 200)}`);
    
    // Check for Shopify headers (but don't require them)
    const hmacHeader = req.headers.get('X-Shopify-Hmac-Sha256');
    const topicHeader = req.headers.get('X-Shopify-Topic');
    const shopHeader = req.headers.get('X-Shopify-Shop-Domain');
    
    logs.push(`[PROBE] X-Shopify-Hmac-Sha256: ${hmacHeader ? 'PRESENT' : 'MISSING'}`);
    logs.push(`[PROBE] X-Shopify-Topic: ${topicHeader ? 'PRESENT' : 'MISSING'}`);
    logs.push(`[PROBE] X-Shopify-Shop-Domain: ${shopHeader ? 'PRESENT' : 'MISSING'}`);
    
    // Log to console
    logs.forEach(log => console.log(log));
    
    // Try to create HubAlert (will fail if permissions issue, but that's OK)
    try {
      const base44 = createClientFromRequest(req);
      await base44.asServiceRole.entities.HubAlert.create({
        title: `Webhook Probe — ${topicHeader || 'No Topic'}`,
        message: logs.join('\n'),
        category: 'System',
        severity: hmacHeader ? 'info' : 'warning',
        source: 'shopifyWebhookProbe',
        recommended_action: hmacHeader 
          ? 'HMAC present — ready to enable full verification' 
          : 'No HMAC — this is a test or Shopify test notification',
      }).catch(() => null);
    } catch (e) {
      console.log('[PROBE] Could not create HubAlert:', e.message);
    }
    
    // Always return 200 so Shopify knows we received it
    return Response.json({
      received: true,
      timestamp,
      method: req.method,
      shopify_headers: {
        hmac_present: !!hmacHeader,
        topic_present: !!topicHeader,
        shop_present: !!shopHeader,
      },
      body_length: rawBody.length,
    }, { status: 200 });
    
  } catch (error) {
    console.error('[PROBE] ERROR:', error.message);
    
    // Still return 200 to acknowledge receipt
    return Response.json({
      received: false,
      error: error.message,
    }, { status: 200 });
  }
});