import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * FIX MISSING ADDRESS: NV-MONL4I2M
 * - Attempt to retrieve address from Stripe subscription metadata
 * - If not found, create review queue entry for manual entry
 * - Validate address and unlock for Driver Portal
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { order_number = 'NV-MONL4I2M', manual_address = null } = await req.json().catch(() => ({}));

    // Step 1: Get order
    const orders = await base44.asServiceRole.entities.ShopifyOrder.filter({
      shopify_order_number: order_number,
    });

    if (!orders || orders.length === 0) {
      return Response.json({ error: 'Order not found', status: 404 });
    }

    const order = orders[0];

    // Step 2: If manual address provided, use it
    if (manual_address) {
      const updateData = {
        address_line1: manual_address.line1,
        address_line2: manual_address.line2,
        address_city: manual_address.city,
        address_state: manual_address.state,
        address_postal_code: manual_address.postal_code,
        address_country: manual_address.country || 'US',
        data_quality_status: 'complete',
        internal_notes: (order.internal_notes || '') + `\n[ADMIN-SYNC] Address manually entered on ${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })}`,
      };

      await base44.asServiceRole.functions.invoke('safeSyncOrderUpdate', {
        incomingData: updateData,
        source: 'operations',
        matchBy: { internal_id: order.id },
      });

      await base44.asServiceRole.entities.RepairAuditLog.create({
        timestamp: new Date().toISOString(),
        executed_by: user.email,
        user_role: user.role,
        repair_function: 'fixMissingAddress',
        action: 'repair',
        records_affected: 1,
        reason: `Address manually entered for order ${order_number}`,
        changes: {
          address_added: true,
          address_line1: manual_address.line1,
          city: manual_address.city,
        },
        details: { order_number, order_id: order.id },
      });

      return Response.json({
        status: 'success',
        message: 'Address added successfully',
        order_number,
        address: manual_address,
        next_steps: ['Order now ready for Driver Portal', 'Assign driver', 'Mark as assigned_for_delivery'],
      });
    }

    // Step 3: Try to fetch from Stripe subscription metadata
    if (order.stripe_subscription_id) {
      const stripeApiKey = Deno.env.get('STRIPE_API_KEY');
      
      try {
        const subResponse = await fetch(`https://api.stripe.com/v1/subscriptions/${order.stripe_subscription_id}`, {
          headers: { 'Authorization': `Bearer ${stripeApiKey}` },
        });

        if (subResponse.ok) {
          const sub = await subResponse.json();
          const shippingAddress = sub.metadata?.shipping_address || sub.customer_tax_ids?.[0];

          if (shippingAddress) {
            // Parse address from metadata
            const parts = shippingAddress.split(', ');
            const addressData = {
              line1: parts[0],
              city: parts[1],
              state: parts[2],
              postal_code: parts[3],
              country: 'US',
            };

            const updateData = {
              address_line1: addressData.line1,
              address_city: addressData.city,
              address_state: addressData.state,
              address_postal_code: addressData.postal_code,
              address_country: addressData.country,
              data_quality_status: 'complete',
              internal_notes: (order.internal_notes || '') + `\n[AUTO-SYNC] Address retrieved from Stripe subscription metadata`,
            };

            await base44.asServiceRole.functions.invoke('safeSyncOrderUpdate', {
              incomingData: updateData,
              source: 'operations',
              matchBy: { internal_id: order.id },
            });

            return Response.json({
              status: 'success',
              message: 'Address recovered from Stripe subscription',
              order_number,
              address: addressData,
              source: 'stripe_subscription',
            });
          }
        }
      } catch (stripeError) {
        console.warn('[FIX-ADDRESS] Stripe lookup failed:', stripeError.message);
      }
    }

    // Step 4: If no address found, create review queue entry
    const existingQueue = await base44.asServiceRole.entities.OrderReviewQueue.filter({
      existing_order_id: order.id,
      incident_type: 'missing_customer_info',
    });

    if (existingQueue.length === 0) {
      await base44.asServiceRole.entities.OrderReviewQueue.create({
        incident_type: 'missing_customer_info',
        customer_email: order.customer_email,
        customer_name: order.customer_name,
        existing_order_id: order.id,
        existing_order_number: order_number,
        existing_order_type: 'one_time',
        incoming_source: 'operations',
        issue_description: 'Delivery order missing address. Cannot enter Driver Portal without complete address.',
        recommended_action: 'manual_review',
        status: 'pending',
      });
    }

    return Response.json({
      status: 'address_not_found',
      message: 'Address not found in Stripe or order metadata. Added to review queue.',
      order_number,
      options: [
        'Option 1: Contact customer to re-checkout with address',
        'Option 2: Admin manually enters address via this function (pass manual_address param)',
        'Option 3: Wait for Customer App to sync address',
      ],
    });

  } catch (error) {
    console.error('[FIX-ADDRESS] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});