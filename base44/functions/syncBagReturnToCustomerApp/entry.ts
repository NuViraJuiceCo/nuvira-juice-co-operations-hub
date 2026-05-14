import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CUSTOMER_APP_API = Deno.env.get('CUSTOMER_APP_API_URL');
const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    // Allow admin, operations_staff, or internal secret (service-role automation)
    const internalSecret = Deno.env.get('INTERNAL_FUNCTION_SECRET');
    const body = await req.json().catch(() => ({}));
    const isInternalCall = body._internalSecret && internalSecret && body._internalSecret === internalSecret;
    
    if (!isInternalCall && (!user || user.role !== 'admin')) {
      return Response.json({ error: 'Admin access or internal secret required — bag return sync is restricted' }, { status: 403 });
    }

    let payload;
     try {
       payload = await req.json();
     } catch {
       return Response.json({ error: 'Invalid JSON in request body' }, { status: 400 });
     }

     const { bagReturnId, returnData } = payload;

     if (!bagReturnId || !returnData) {
       return Response.json({ error: 'Missing bagReturnId or returnData' }, { status: 400 });
     }

    if (!CUSTOMER_APP_API || !SYNC_SECRET) {
      console.warn('[SYNC-BAG-RETURN] Customer app API not configured, skipping sync');
      return Response.json({ status: 'skipped', reason: 'Customer app API not configured' });
    }

    // Map hub BagReturn schema to customer app schema
    const syncPayload = {
      order_id: returnData.order_id,
      customer_email: returnData.customer_email,
      small_bags_requested: returnData.small_bags_requested || 0,
      tote_bags_requested: returnData.tote_bags_requested || 0,
      small_bags_accepted: returnData.small_bags_accepted || 0,
      tote_bags_accepted: returnData.tote_bags_accepted || 0,
      small_bag_status: returnData.small_bag_status,
      tote_bag_status: returnData.tote_bag_status,
      rejection_reason: returnData.rejection_reason || null,
      verification_status: returnData.verification_status,
      credit_issued: returnData.credit_issued || 0,
      verified_by: returnData.verified_by,
      verified_at: returnData.verified_at,
      photo_url: returnData.photo_url || null,
      driver_notes: returnData.driver_notes || null,
    };

    const response = await fetch(`${CUSTOMER_APP_API}/functions/syncBagReturnFromHub`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SYNC_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(syncPayload),
    });

    if (response.ok) {
      // Update sync status in hub
      await base44.asServiceRole.entities.BagReturn.update(bagReturnId, {
        sync_status: 'synced',
      });
      console.log(`[SYNC-BAG-RETURN] Successfully synced bag return ${bagReturnId} to customer app`);
      return Response.json({ status: 'success', synced: true });
    } else {
      const text = await response.text();
      console.error(`[SYNC-BAG-RETURN] Customer app error: ${response.status} - ${text}`);
      
      // Update sync status as failed
      await base44.asServiceRole.entities.BagReturn.update(bagReturnId, {
        sync_status: 'failed',
      });
      
      return Response.json({
        status: 'failed',
        reason: `Customer app error: ${response.status}`,
      });
    }
  } catch (error) {
    console.error('[SYNC-BAG-RETURN] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});