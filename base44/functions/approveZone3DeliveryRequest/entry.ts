import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_API_KEY'));

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { request_id, approved_delivery_fee, fee_reason, admin_notes } = await req.json();
    if (!request_id || approved_delivery_fee == null) {
      return Response.json({ error: 'request_id and approved_delivery_fee are required' }, { status: 400 });
    }

    // Load the request
    const requests = await base44.asServiceRole.entities.DeliveryApprovalRequest.filter({ id: request_id });
    const approvalReq = requests?.[0];
    if (!approvalReq) return Response.json({ error: 'Request not found' }, { status: 404 });
    if (approvalReq.status !== 'pending_review') {
      return Response.json({ error: `Request is already ${approvalReq.status}` }, { status: 409 });
    }

    // Capture the PaymentIntent
    let captureResult;
    try {
      captureResult = await stripe.paymentIntents.capture(approvalReq.stripe_payment_intent_id, {
        amount_to_capture: Math.round((approvalReq.cart_subtotal + approved_delivery_fee) * 100),
      });
    } catch (stripeErr) {
      return Response.json({ error: `Stripe capture failed: ${stripeErr.message}`, stripe_error: stripeErr.message }, { status: 422 });
    }

    const now = new Date().toISOString();

    // Build Hub order payload
    const hubOrder = {
      shopify_order_id: `zone3_${approvalReq.id}_${Date.now()}`,
      shopify_order_number: approvalReq.request_number || `ZR3-${approvalReq.id.slice(-6).toUpperCase()}`,
      customer_name: approvalReq.customer_name,
      customer_email: approvalReq.customer_email,
      customer_phone: approvalReq.customer_phone,
      address_line1: approvalReq.address_line1 || approvalReq.delivery_address,
      address_line2: approvalReq.address_line2 || '',
      address_city: approvalReq.address_city || '',
      address_state: approvalReq.address_state || '',
      address_postal_code: approvalReq.address_postal_code || '',
      delivery_address: approvalReq.delivery_address,
      line_items: (approvalReq.cart_items || []),
      subtotal: approvalReq.cart_subtotal,
      total_price: (approvalReq.cart_subtotal || 0) + approved_delivery_fee,
      payment_status: 'paid',
      fulfillment_method: 'delivery',
      fulfillment_status: 'unfulfilled',
      production_status: 'new',
      order_lock_status: 'unlocked',
      data_quality_status: 'complete',
      selected_delivery_date: approvalReq.requested_delivery_date,
      delivery_window_label: '5 PM – 8 PM',
      stripe_payment_intent_id: approvalReq.stripe_payment_intent_id,
      stripe_capture_id: captureResult.id,
      order_type: 'one_time',
      fulfillment_mode: 'single_delivery',
      source_type: 'admin_create',
      sync_status: 'synced',
      tags: ['zone3_delivery', `zone_${approvalReq.zone_key || 'zone3'}`],
      internal_notes: [
        `Zone 3 Delivery — Approved by ${user.email} at ${now}`,
        `Distance: ${approvalReq.estimated_distance_miles} mi | Drive: ${approvalReq.estimated_drive_time_minutes} min`,
        `Delivery Fee: $${approved_delivery_fee}`,
        admin_notes ? `Admin Notes: ${admin_notes}` : '',
        `Approval Request ID: ${approvalReq.id}`,
      ].filter(Boolean).join('\n'),
      // Zone metadata fields
      delivery_zone_key: approvalReq.zone_key || 'zone3',
      delivery_zone_name: approvalReq.zone_name || 'Zone 3',
      delivery_zone_type: approvalReq.zone_type || 'extended',
      delivery_fee: approved_delivery_fee,
      distance_miles: approvalReq.estimated_distance_miles,
      drive_time_minutes: approvalReq.estimated_drive_time_minutes,
      approval_request_id: approvalReq.id,
      last_sync_at: now,
    };

    const createdOrder = await base44.asServiceRole.entities.ShopifyOrder.create(hubOrder);

    // Update the approval request
    const existingTrail = Array.isArray(approvalReq.audit_trail) ? approvalReq.audit_trail : [];
    await base44.asServiceRole.entities.DeliveryApprovalRequest.update(approvalReq.id, {
      status: 'captured',
      approved_by: user.email,
      approved_at: now,
      approved_delivery_fee: approved_delivery_fee,
      stripe_capture_id: captureResult.id,
      created_hub_order_id: createdOrder.id,
      admin_notes: admin_notes || approvalReq.admin_notes,
      audit_trail: [...existingTrail, {
        timestamp: now,
        action: 'approved_and_captured',
        performed_by: user.email,
        prior_status: 'pending_review',
        new_status: 'captured',
        reason: fee_reason || admin_notes || 'Approved by admin',
        stripe_result: { capture_id: captureResult.id, amount_captured: captureResult.amount_received },
      }],
    });

    return Response.json({
      success: true,
      hub_order_id: createdOrder.id,
      hub_order_number: hubOrder.shopify_order_number,
      capture_id: captureResult.id,
      amount_captured: (captureResult.amount_received / 100).toFixed(2),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});