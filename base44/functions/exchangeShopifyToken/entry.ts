import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Exchange Shopify Client Credentials for Admin API Access Token
 * Supports the new Shopify Dev Dashboard token exchange flow
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized: Admin access required' }, { status: 401 });
    }

    // Get credentials from environment
    const shopDomain = Deno.env.get('SHOPIFY_SHOP_DOMAIN');
    const clientId = Deno.env.get('SHOPIFY_CLIENT_ID');
    const clientSecret = Deno.env.get('SHOPIFY_CLIENT_SECRET');

    // Validate required credentials
    if (!shopDomain || !clientId || !clientSecret) {
      return Response.json({
        error: 'Missing required credentials',
        missing: {
          shop_domain: !shopDomain,
          client_id: !clientId,
          client_secret: !clientSecret
        }
      }, { status: 400 });
    }

    // Exchange client credentials for access token
    const tokenUrl = `https://${shopDomain}/admin/oauth/access_token`;
    
    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials'
      })
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      return Response.json({
        error: 'Token exchange failed',
        status: tokenResponse.status,
        details: tokenData
      }, { status: tokenResponse.status });
    }

    // Extract access token from response
    const accessToken = tokenData.access_token;
    const expiresIn = tokenData.expires_in || 86400; // Default 24 hours
    const scope = tokenData.scope || '';

    if (!accessToken) {
      return Response.json({
        error: 'No access token returned from Shopify',
        response: tokenData
      }, { status: 500 });
    }

    // Return token with metadata
    return Response.json({
      success: true,
      access_token: accessToken,
      token_type: tokenData.token_type || 'Bearer',
      expires_in: expiresIn,
      scope: scope,
      obtained_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + expiresIn * 1000).toISOString()
    });

  } catch (error) {
    return Response.json({
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
});