import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * RECOVER MISSING ORDER: NV-MOOPFCUS
 * - Check Stripe for payment event
 * - Create order in Hub if Stripe event found
 * - Log recovery action
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { order_number = 'NV-MOOPFCUS' } = await req.json().catch(() => ({}));

    // Step 1: Check if order already exists (avoid duplicate)
    const existing = await base44.asServiceRole.entities.ShopifyOrder.filter({
      shopify_order_number: order_number,
    });

    if (existing && existing.length > 0) {
      return Response.json({
        status: 'already_exists',
        order_id: existing[0].id,
        message: 'Order already in Hub',
      });
    }

    // Step 2: Search Stripe for payment events matching this order
    const stripeEvents = await base44.asServiceRole.entities.StripeEventLog.filter({}, '-timestamp', 500);
    const matchingEvent = stripeEvents.find(e => 
      e.notes?.includes(order_number) || 
      e.stripe_object_id?.includes(order_number)
    );

    if (!matchingEvent) {
      return Response.json({
        status: 'not_found_in_stripe',
        message: 'No Stripe events found for this order',
        recommendation: 'Check Customer App logs for creation failure',
      });
    }

    // Step 3: Extract order data from Stripe event
    const stripeData = matchingEvent.raw_event?.data?.object || {};
    
    if (!stripeData.customer_email) {
      return Response.json({
        status: 'incomplete_stripe_data',
        message: 'Stripe event missing customer email',
        stripe_event_id: matchingEvent.stripe_event_id,
      });
    }

    // Step 4: Create order in Hub from Stripe data
    const newOrder = await base44.asServiceRole.entities.ShopifyOrder.create({
      shopify_order_id: matchingEvent.stripe_object_id,
      shopify_order_number: order_number,
      customer_email: stripeData.customer_email,
      customer_name: stripeData.customer_name || 'Unknown',
      customer_phone: stripeData.customer_phone,
      payment_status: 'paid',
      production_status: 'new',
      order_lock_status: 'unlocked',
      total_price: (stripeData.amount_total || 0) / 100,
      subtotal: (stripeData.amount_subtotal || 0) / 100,
      stripe_event_id_applied: matchingEvent.stripe_event_id,
      source_type: 'stripe_webhook',
      data_quality_status: 'incomplete',
      internal_notes: `[RECOVERED] Created from Stripe event ${matchingEvent.stripe_event_id} on ${new Date().toISOString()}. Missing address and items — requires manual sync from Customer App.`,
      line_items: [],
      address_line1: stripeData.shipping?.address?.line1,
      address_line2: stripeData.shipping?.address?.line2,
      address_city: stripeData.shipping?.address?.city,
      address_state: stripeData.shipping?.address?.state,
      address_postal_code: stripeData.shipping?.address?.postal_code,
      address_country: stripeData.shipping?.address?.country,
    });

    // Step 5: Create audit log
    await base44.asServiceRole.entities.RepairAuditLog.create({
      timestamp: new Date().toISOString(),
      executed_by: user.email,
      user_role: user.role,
      repair_function: 'recoverMissingOrder',
      action: 'recovery',
      records_affected: 1,
      reason: `Order NV-MOOPFCUS not found in Hub but Stripe event exists. Recovered from Stripe event ${matchingEvent.stripe_event_id}.`,
      changes: {
        created: true,
        source: 'stripe',
        payment_status: 'paid',
        needs_address_sync: true,
        needs_items_sync: true,
      },
      details: {
        order_number: order_number,
        order_id: newOrder.id,
        stripe_event_id: matchingEvent.stripe_event_id,
        customer_email: stripeData.customer_email,
      },
    });

    // Step 6: Add to OrderReviewQueue for manual sync
    await base44.asServiceRole.entities.OrderReviewQueue.create({
      incident_type: 'recovery_needs_review',
      customer_email: stripeData.customer_email,
      customer_name: stripeData.customer_name || 'Unknown',
      existing_order_id: newOrder.id,
      existing_order_number: order_number,
      existing_order_type: 'one_time',
      incoming_payload: stripeData,
      incoming_source: 'stripe_webhook',
      issue_description: `Order recovered from Stripe but missing address and line items. Requires sync from Customer App or manual entry.`,
      recommended_action: 'manual_review',
      status: 'pending',
    });

    return Response.json({
      status: 'success',
      order_created: true,
      order_id: newOrder.id,
      order_number: order_number,
      message: 'Order recovered from Stripe. Added to review queue for address/items sync.',
      next_steps: [
        'Sync address from Customer App checkout',
        'Sync line items from Customer App',
        'Verify payment captured in Stripe',
        'Mark as ready for production',
      ],
    });

  } catch (error) {
    console.error('[RECOVER-ORDER] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});