import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Get all Stripe events for Sukhwant
    const events = await base44.asServiceRole.entities.StripeEventLog.list('-created_date', 50);
    
    const sukhwantEvents = events.filter(e => 
      e.customer_email === 'ksukhi2000@yahoo.com' || 
      (e.raw_event && e.raw_event.customer_email === 'ksukhi2000@yahoo.com')
    );

    return Response.json({
      total_events: events.length,
      sukhwant_events: sukhwantEvents.map(e => ({
        id: e.id,
        stripe_event_id: e.stripe_event_id,
        event_type: e.event_type,
        stripe_object_id: e.stripe_object_id,
        status: e.status,
        customer_email: e.customer_email,
        order_id: e.order_id,
        created_date: e.created_date,
        has_raw_event: !!e.raw_event,
        raw_event_summary: e.raw_event ? {
          id: e.raw_event.id,
          customer_email: e.raw_event.customer_email,
          amount_total: e.raw_event.amount_total,
          payment_status: e.raw_event.payment_status,
        } : null,
      })),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});