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

    const { request_id, denial_reason, customer_message, add_to_waitlist } = await req.json();
    if (!request_id || !denial_reason) {
      return Response.json({ error: 'request_id and denial_reason are required' }, { status: 400 });
    }

    const requests = await base44.asServiceRole.entities.DeliveryApprovalRequest.filter({ id: request_id });
    const approvalReq = requests?.[0];
    if (!approvalReq) return Response.json({ error: 'Request not found' }, { status: 404 });
    if (approvalReq.status !== 'pending_review') {
      return Response.json({ error: `Request is already ${approvalReq.status}` }, { status: 409 });
    }

    // Cancel the PaymentIntent (release authorization hold)
    let cancelResult;
    try {
      cancelResult = await stripe.paymentIntents.cancel(approvalReq.stripe_payment_intent_id);
    } catch (stripeErr) {
      return Response.json({ error: `Stripe cancel failed: ${stripeErr.message}` }, { status: 422 });
    }

    const now = new Date().toISOString();

    // Create waitlist record if requested
    let waitlistId = null;
    if (add_to_waitlist !== false) {
      const waitlistRecord = await base44.asServiceRole.entities.Zone3Waitlist.create({
        customer_name: approvalReq.customer_name,
        customer_email: approvalReq.customer_email,
        customer_phone: approvalReq.customer_phone,
        delivery_address: approvalReq.delivery_address,
        zone_name: approvalReq.zone_name,
        estimated_distance_miles: approvalReq.estimated_distance_miles,
        original_request_id: approvalReq.id,
        denial_reason: denial_reason,
        customer_message: customer_message || 'Thank you for your interest. We are currently unable to fulfill deliveries to your area, but we have added you to our waitlist and will reach out when service becomes available.',
        status: 'active',
      });
      waitlistId = waitlistRecord.id;
    }

    // Update the request
    const existingTrail = Array.isArray(approvalReq.audit_trail) ? approvalReq.audit_trail : [];
    await base44.asServiceRole.entities.DeliveryApprovalRequest.update(approvalReq.id, {
      status: 'denied',
      denied_by: user.email,
      denied_at: now,
      denial_reason: denial_reason,
      denial_customer_message: customer_message,
      created_waitlist_id: waitlistId,
      audit_trail: [...existingTrail, {
        timestamp: now,
        action: 'denied',
        performed_by: user.email,
        prior_status: 'pending_review',
        new_status: 'denied',
        reason: denial_reason,
        stripe_result: { cancel_status: cancelResult.status },
      }],
    });

    return Response.json({
      success: true,
      waitlist_id: waitlistId,
      stripe_cancel_status: cancelResult.status,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});