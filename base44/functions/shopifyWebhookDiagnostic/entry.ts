import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function hubLegacyDiagnosticRepairToolsEnabled() {
  return Deno.env.get('ENABLE_HUB_LEGACY_DIAGNOSTIC_REPAIR_TOOLS') === 'true';
}

/**
 * shopifyWebhookDiagnostic — TEMPORARY DIAGNOSTIC ENDPOINT
 * 
 * Purpose: Capture raw request data to isolate where Shopify webhook verification fails.
 * Does NOT verify HMAC — only logs what Shopify sends.
 * 
 * Logs:
 * - Method, URL, all headers
 * - Raw body length and hash
 * - First 500 chars of body
 * - Presence of critical Shopify headers
 */

Deno.serve(async (req) => {
  if (!hubLegacyDiagnosticRepairToolsEnabled()) {
    return Response.json({
      success: true,
      skipped: true,
      reason: 'hub_legacy_diagnostic_repair_tools_disabled',
      message: 'Hub legacy diagnostic/repair tools are disabled for the May 30 launch freeze.',
    }, { status: 409 });
  }

  const timestamp = new Date().toISOString();
  const logs = [];
  
  try {
    // Capture raw body BEFORE any parsing
    const rawBody = await req.text();
    const rawBodyHash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(rawBody)
    );
    const rawBodyHashHex = Array.from(new Uint8Array(rawBodyHash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    // Log method and URL
    logs.push(`[DIAGNOSTIC] ${timestamp}`);
    logs.push(`[DIAGNOSTIC] Method: ${req.method}`);
    logs.push(`[DIAGNOSTIC] URL: ${req.url}`);
    logs.push(`[DIAGNOSTIC] Content-Type: ${req.headers.get('content-type') || 'NOT SET'}`);
    
    // Log ALL headers
    logs.push(`[DIAGNOSTIC] === ALL HEADERS ===`);
    req.headers.forEach((value, key) => {
      logs.push(`[DIAGNOSTIC]   ${key}: ${value}`);
    });
    
    // Check critical Shopify headers
    logs.push(`[DIAGNOSTIC] === SHOPIFY HEADERS CHECK ===`);
    const hmacHeader = req.headers.get('X-Shopify-Hmac-Sha256');
    const topicHeader = req.headers.get('X-Shopify-Topic');
    const shopHeader = req.headers.get('X-Shopify-Shop-Domain');
    const webhookIdHeader = req.headers.get('X-Shopify-Webhook-Id');
    const shopifySendAtHeader = req.headers.get('X-Shopify-Webhook-Send-At');
    
    logs.push(`[DIAGNOSTIC] X-Shopify-Hmac-Sha256: ${hmacHeader ? 'PRESENT ✓' : 'MISSING ✗'}`);
    logs.push(`[DIAGNOSTIC] X-Shopify-Topic: ${topicHeader ? 'PRESENT ✓' : 'MISSING ✗'} (${topicHeader || 'N/A'})`);
    logs.push(`[DIAGNOSTIC] X-Shopify-Shop-Domain: ${shopHeader ? 'PRESENT ✓' : 'MISSING ✗'} (${shopHeader || 'N/A'})`);
    logs.push(`[DIAGNOSTIC] X-Shopify-Webhook-Id: ${webhookIdHeader ? 'PRESENT ✓' : 'MISSING ✗'} (${webhookIdHeader || 'N/A'})`);
    logs.push(`[DIAGNOSTIC] X-Shopify-Webhook-Send-At: ${shopifySendAtHeader ? 'PRESENT ✓' : 'MISSING ✗'} (${shopifySendAtHeader || 'N/A'})`);
    
    // Log body info
    logs.push(`[DIAGNOSTIC] === BODY INFO ===`);
    logs.push(`[DIAGNOSTIC] Body length: ${rawBody.length} bytes`);
    logs.push(`[DIAGNOSTIC] Raw body SHA-256 (hex): ${rawBodyHashHex}`);
    logs.push(`[DIAGNOSTIC] First 500 chars of body:`);
    logs.push(`[DIAGNOSTIC] ${rawBody.substring(0, 500)}`);
    
    // Try to parse JSON for additional info (but don't use for HMAC)
    let parsedJson = null;
    try {
      parsedJson = JSON.parse(rawBody);
      logs.push(`[DIAGNOSTIC] === PARSED JSON INFO ===`);
      logs.push(`[DIAGNOSTIC] Order ID: ${parsedJson.id || 'N/A'}`);
      logs.push(`[DIAGNOSTIC] Order Number: ${parsedJson.name || parsedJson.order_number || 'N/A'}`);
      logs.push(`[DIAGNOSTIC] Email: ${parsedJson.email || parsedJson.customer?.email || 'N/A'}`);
      logs.push(`[DIAGNOSTIC] Total Price: ${parsedJson.total_price || 'N/A'}`);
      logs.push(`[DIAGNOSTIC] Financial Status: ${parsedJson.financial_status || 'N/A'}`);
    } catch (e) {
      logs.push(`[DIAGNOSTIC] Body is not valid JSON: ${e.message}`);
    }
    
    // Log everything to console
    logs.forEach(log => console.log(log));
    
    // Also create a HubAlert for easy viewing
    try {
      const base44 = createClientFromRequest(req);
      await base44.asServiceRole.entities.HubAlert.create({
        title: `Shopify Diagnostic — ${hmacHeader ? 'HMAC PRESENT' : 'HMAC MISSING'}`,
        message: logs.join('\n'),
        category: 'System',
        severity: hmacHeader ? 'info' : 'warning',
        source: 'shopifyWebhookDiagnostic',
        recommended_action: hmacHeader 
          ? 'Headers received correctly. Issue is likely HMAC calculation or secret mismatch.' 
          : 'Shopify is not sending HMAC header. Check webhook configuration in Shopify admin.',
      }).catch(() => null);
    } catch (e) {
      console.log('[DIAGNOSTIC] Could not create HubAlert:', e.message);
    }
    
    return Response.json({
      received: true,
      timestamp,
      method: req.method,
      url: req.url,
      headers_received: Object.fromEntries(req.headers.entries()),
      shopify_headers: {
        hmac_present: !!hmacHeader,
        topic_present: !!topicHeader,
        shop_present: !!shopHeader,
        webhook_id_present: !!webhookIdHeader,
      },
      body_length: rawBody.length,
      body_hash_sha256: rawBodyHashHex,
      body_preview: rawBody.substring(0, 500),
      parsed_order_info: parsedJson ? {
        id: parsedJson.id,
        name: parsedJson.name,
        email: parsedJson.email,
        total_price: parsedJson.total_price,
      } : null,
    }, { status: 200 });
    
  } catch (error) {
    const errorMsg = `[DIAGNOSTIC] ERROR: ${error.message}\n${error.stack}`;
    console.error(errorMsg);
    
    return Response.json({
      received: false,
      error: error.message,
      logs: logs.join('\n'),
    }, { status: 500 });
  }
});
