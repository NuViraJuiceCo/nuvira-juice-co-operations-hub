import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_API_KEY'));

/**
 * Admin repair function to recover Stripe orders and process missed webhook events.
 * Can recover by: checkout session ID, payment intent, customer email, or undelivered events.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { action, session_id, customer_email, payment_intent_id, event_id } = body;

    console.log(`[STRIPE-RECOVERY] Admin recovery requested: ${action}`);

    // Action 1: Recover a specific checkout session
    if (action === 'recover_session' && session_id) {
      return await recoverSession(base44, session_id);
    }

    // Action 2: Recover by customer email
    if (action === 'recover_customer' && customer_email) {
      return await recoverCustomer(base44, customer_email);
    }

    // Action 3: Manually process a known Stripe event
    if (action === 'process_event' && event_id) {
      return await processStripeEvent(base44, event_id);
    }

    // Action 4: List failed/undelivered events
    if (action === 'list_failed_events') {
      return await listFailedEvents(base44);
    }

    // Action 5: Get recovery history for an order
    if (action === 'get_history' && session_id) {
      return await getRecoveryHistory(base44, session_id);
    }

    return Response.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error(`[STRIPE-RECOVERY] Error: ${error.message}`);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

async function recoverSession(base44, sessionId) {
  console.log(`[STRIPE-RECOVERY] Recovering session ${sessionId}`);

  try {
    // Fetch session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    console.log(`[STRIPE-RECOVERY] Retrieved session, customer: ${session.customer_details?.email}`);

    // Check if order already exists
    const existing = await base44.asServiceRole.entities.ShopifyOrder.filter({
      shopify_order_id: sessionId,
    });

    if (existing.length > 0) {
      return Response.json({
        success: true,
        action: 'exists',
        order_id: existing[0].id,
        message: 'Order already exists in database',
      });
    }

    // Fetch line items
    const lineItems = await stripe.checkout.sessions.listLineItems(sessionId);
    const items = (lineItems.data || []).map(item => ({
      title: item.description || item.name || 'Unknown',
      quantity: item.quantity || 0,
      price: (item.price?.unit_amount || 0) / 100,
    }));

    // Create order
    const order = await base44.asServiceRole.entities.ShopifyOrder.create({
      shopify_order_id: sessionId,
      shopify_order_number: `#STRIPE-${sessionId.slice(-8).toUpperCase()}`,
      customer_email: session.customer_details?.email || 'unknown@stripe.local',
      customer_phone: session.customer_details?.phone || '',
      customer_name: session.customer_details?.name || '',
      line_items: items,
      subtotal: (session.amount_subtotal || 0) / 100,
      total_price: (session.amount_total || 0) / 100,
      source_channel: 'online',
      fulfillment_method: 'shipping',
      payment_status: 'paid',
      production_status: 'new',
      sync_status: 'synced',
      customer_order_date: new Date(session.created * 1000).toISOString(),
      internal_notes: `Recovered via admin repair function on ${new Date().toISOString()}`,
    });

    // Log recovery
    await base44.asServiceRole.entities.StripeEventLog.create({
      stripe_event_id: `recovery_${sessionId}`,
      event_type: 'recovery',
      stripe_object_id: sessionId,
      stripe_customer_id: session.customer || '',
      customer_email: session.customer_details?.email || '',
      order_id: order.id,
      status: 'processed',
      notes: 'Recovered via admin recovery function',
    });

    return Response.json({
      success: true,
      action: 'created',
      order_id: order.id,
      customer: session.customer_details?.email,
      total: (session.amount_total || 0) / 100,
      message: 'Order recovered successfully',
    });
  } catch (error) {
    console.error(`[STRIPE-RECOVERY] Session recovery failed: ${error.message}`);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
}

async function recoverCustomer(base44, customerEmail) {
  console.log(`[STRIPE-RECOVERY] Recovering sessions for customer ${customerEmail}`);

  try {
    // Search Stripe for this customer's sessions
    const sessions = await stripe.checkout.sessions.list({
      limit: 100,
    });

    const matchingSessions = sessions.data.filter(s => s.customer_details?.email === customerEmail);
    console.log(`[STRIPE-RECOVERY] Found ${matchingSessions.length} sessions for ${customerEmail}`);

    const recovered = [];
    for (const session of matchingSessions) {
      // Skip if already in database
      const existing = await base44.asServiceRole.entities.ShopifyOrder.filter({
        shopify_order_id: session.id,
      });

      if (existing.length > 0) {
        recovered.push({ session_id: session.id, status: 'exists', order_id: existing[0].id });
        continue;
      }

      // Recover session
      const result = await recoverSession(base44, session.id);
      if (result.ok || result.status < 300) {
        const data = await result.json();
        recovered.push({ session_id: session.id, status: 'created', order_id: data.order_id });
      }
    }

    return Response.json({
      success: true,
      customer: customerEmail,
      recovered_count: recovered.length,
      sessions: recovered,
    });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
}

async function listFailedEvents(base44) {
  console.log('[STRIPE-RECOVERY] Listing failed events');

  try {
    const events = await stripe.events.list({
      type: 'checkout.session.completed',
      limit: 50,
    });

    // Filter for recent events that might have failed
    const recentEvents = events.data.filter(e => {
      const ageHours = (Date.now() - e.created * 1000) / (1000 * 60 * 60);
      return ageHours < 72; // Last 3 days
    });

    // Check which ones are in our log
    const results = [];
    for (const event of recentEvents) {
      const logged = await base44.asServiceRole.entities.StripeEventLog.filter({
        stripe_event_id: event.id,
      });

      results.push({
        event_id: event.id,
        type: event.type,
        object_id: event.data.object?.id,
        created: new Date(event.created * 1000).toISOString(),
        status: logged.length > 0 ? logged[0].status : 'unprocessed',
      });
    }

    return Response.json({
      success: true,
      total: results.length,
      events: results,
    });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
}

async function processStripeEvent(base44, eventId) {
  console.log(`[STRIPE-RECOVERY] Processing event ${eventId}`);

  try {
    const event = await stripe.events.retrieve(eventId);

    if (event.type !== 'checkout.session.completed') {
      return Response.json({
        success: false,
        error: 'Only checkout.session.completed events are supported',
      }, { status: 400 });
    }

    const session = event.data.object;

    // Check if already processed
    const logged = await base44.asServiceRole.entities.StripeEventLog.filter({
      stripe_event_id: eventId,
    });

    if (logged.length > 0 && logged[0].status === 'processed') {
      return Response.json({
        success: true,
        action: 'skipped',
        message: 'Event already processed',
      });
    }

    // Recover the session
    const result = await recoverSession(base44, session.id);
    const data = await result.json();

    return Response.json({
      success: true,
      event_id: eventId,
      ...data,
    });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
}

async function getRecoveryHistory(base44, sessionId) {
  console.log(`[STRIPE-RECOVERY] Getting history for session ${sessionId}`);

  try {
    const logs = await base44.asServiceRole.entities.StripeEventLog.filter({
      stripe_object_id: sessionId,
    });

    return Response.json({
      success: true,
      session_id: sessionId,
      events: logs.map(log => ({
        event_id: log.stripe_event_id,
        type: log.event_type,
        status: log.status,
        order_id: log.order_id,
        created: log.created_date,
        notes: log.notes,
      })),
    });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
}