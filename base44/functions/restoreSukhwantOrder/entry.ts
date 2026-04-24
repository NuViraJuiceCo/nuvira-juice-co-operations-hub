import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * PART 1: Restore Sukhwant Kahlon's missing Stripe order
 * Queries Stripe for all customer activity and reconstructs the order record
 */

const STRIPE_API_KEY = Deno.env.get('STRIPE_API_KEY');

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const result = {
      timestamp: new Date().toISOString(),
      customer_email: 'ksukhi2000@yahoo.com',
      action: 'restore_from_stripe',
      found: null,
      restored_order_id: null,
      details: {},
    };

    if (!STRIPE_API_KEY) {
      return Response.json({ error: 'Stripe API key not configured' }, { status: 500 });
    }

    // 1. Find Stripe customer by email
    const customersRes = await fetch('https://api.stripe.com/v1/customers?email=ksukhi2000@yahoo.com&limit=10', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${STRIPE_API_KEY}`,
      },
    });

    if (!customersRes.ok) {
      return Response.json({ error: `Stripe API error: ${customersRes.status}` }, { status: 500 });
    }

    const customersData = await customersRes.json();
    const stripeCustomers = customersData.data || [];

    if (stripeCustomers.length === 0) {
      return Response.json({
        success: false,
        message: 'No Stripe customer found for this email',
        result,
      });
    }

    result.details.stripe_customers_found = stripeCustomers.length;
    const stripeCustomerId = stripeCustomers[0].id;
    const stripeCustomerName = stripeCustomers[0].name || stripeCustomers[0].email || 'Unknown';

    // 2. Find all Stripe objects linked to this customer
    // Check for: checkout sessions, payment intents, invoices, subscriptions
    const [sessionsRes, intentsRes, invoicesRes, subsRes] = await Promise.all([
      fetch(`https://api.stripe.com/v1/checkout/sessions?customer=${stripeCustomerId}&limit=10`, {
        headers: { 'Authorization': `Bearer ${STRIPE_API_KEY}` },
      }),
      fetch(`https://api.stripe.com/v1/payment_intents?customer=${stripeCustomerId}&limit=10`, {
        headers: { 'Authorization': `Bearer ${STRIPE_API_KEY}` },
      }),
      fetch(`https://api.stripe.com/v1/invoices?customer=${stripeCustomerId}&limit=10`, {
        headers: { 'Authorization': `Bearer ${STRIPE_API_KEY}` },
      }),
      fetch(`https://api.stripe.com/v1/subscriptions?customer=${stripeCustomerId}&limit=10`, {
        headers: { 'Authorization': `Bearer ${STRIPE_API_KEY}` },
      }),
    ]);

    const sessions = sessionsRes.ok ? (await sessionsRes.json()).data : [];
    const intents = intentsRes.ok ? (await intentsRes.json()).data : [];
    const invoices = invoicesRes.ok ? (await invoicesRes.json()).data : [];
    const subscriptions = subsRes.ok ? (await subsRes.json()).data : [];

    result.details.sessions = sessions.length;
    result.details.intents = intents.length;
    result.details.invoices = invoices.length;
    result.details.subscriptions = subscriptions.length;

    // 3. Find most recent paid/completed transaction
    let bestObject = null;
    let objectType = null;
    let objectData = null;

    // Prefer completed sessions
    const completedSessions = sessions.filter(s => s.payment_status === 'paid');
    if (completedSessions.length > 0) {
      completedSessions.sort((a, b) => b.created - a.created);
      bestObject = completedSessions[0];
      objectType = 'checkout_session';
      objectData = bestObject;
    }

    // Fall back to payment intents
    if (!bestObject) {
      const succeededIntents = intents.filter(i => i.status === 'succeeded');
      if (succeededIntents.length > 0) {
        succeededIntents.sort((a, b) => b.created - a.created);
        bestObject = succeededIntents[0];
        objectType = 'payment_intent';
        objectData = bestObject;
      }
    }

    // Fall back to invoices
    if (!bestObject) {
      const paidInvoices = invoices.filter(i => i.status === 'paid');
      if (paidInvoices.length > 0) {
        paidInvoices.sort((a, b) => b.created - a.created);
        bestObject = paidInvoices[0];
        objectType = 'invoice';
        objectData = bestObject;
      }
    }

    // Fall back to subscriptions
    if (!bestObject) {
      if (subscriptions.length > 0) {
        subscriptions.sort((a, b) => b.created - a.created);
        bestObject = subscriptions[0];
        objectType = 'subscription';
        objectData = bestObject;
      }
    }

    if (!bestObject) {
      return Response.json({
        success: false,
        message: 'No completed payment found for this customer',
        result,
      });
    }

    result.found = objectType;
    result.details.stripe_object_id = bestObject.id;
    result.details.stripe_object_type = objectType;
    result.details.amount = objectData.amount_total || objectData.amount || 0;
    result.details.created_timestamp = new Date(bestObject.created * 1000).toISOString();

    // 4. Extract line items and reconstruct order
    let lineItems = [];
    let amount = 0;

    if (objectType === 'checkout_session' && objectData.line_items) {
      const itemsRes = await fetch(
        `https://api.stripe.com/v1/checkout/sessions/${objectData.id}/line_items?limit=10`,
        { headers: { 'Authorization': `Bearer ${STRIPE_API_KEY}` } }
      );
      if (itemsRes.ok) {
        const itemsData = await itemsRes.json();
        lineItems = (itemsData.data || []).map(item => ({
          title: item.description || 'Item',
          quantity: item.quantity,
          price: (item.amount_total || item.price?.unit_amount || 0) / 100,
        }));
        amount = objectData.amount_total / 100;
      }
    } else if (objectType === 'payment_intent') {
      amount = objectData.amount / 100;
      lineItems = [{ title: 'Payment', quantity: 1, price: amount }];
    } else if (objectType === 'invoice') {
      amount = objectData.amount_paid / 100;
      lineItems = (objectData.lines?.data || []).map(line => ({
        title: line.description || 'Item',
        quantity: line.quantity || 1,
        price: (line.amount || 0) / 100,
      }));
    }

    // 5. Check if order already exists locally (in any form)
    const existingByEmail = await base44.asServiceRole.entities.ShopifyOrder.filter({
      customer_email: 'ksukhi2000@yahoo.com',
    });

    let localOrderId = null;
    if (existingByEmail && existingByEmail.length > 0) {
      // Use first existing record (likely #unknown or incomplete)
      localOrderId = existingByEmail[0].id;
      result.details.overwriting_existing_id = localOrderId;
    }

    // 6. Build canonical order record with full Stripe linkage
    const orderPayload = {
      shopify_order_id: bestObject.id,
      shopify_order_number: `#${Math.floor(bestObject.created / 100)}`,
      customer_email: 'ksukhi2000@yahoo.com',
      customer_name: stripeCustomerName,
      customer_phone: stripeCustomers[0].phone || '',
      line_items: lineItems,
      total_price: amount,
      subtotal: amount,
      payment_status: 'paid',
      fulfillment_method: 'delivery',
      source_channel: objectType === 'subscription' ? 'subscription' : 'online',
      production_status: 'new',
      sync_status: 'synced',
      last_sync_at: new Date().toISOString(),
      customer_order_date: new Date(bestObject.created * 1000).toISOString(),
      // PART 7: Full Stripe linkage
      stripe_customer_id: stripeCustomerId,
      stripe_checkout_session_id: objectType === 'checkout_session' ? objectData.id : null,
      stripe_payment_intent_id: objectType === 'payment_intent' ? objectData.id : objectData.payment_intent || null,
      stripe_invoice_id: objectType === 'invoice' ? objectData.id : null,
      stripe_subscription_id: objectType === 'subscription' ? objectData.id : null,
      stripe_event_id_applied: null,
      repair_status: 'restored_from_stripe',
      repair_timestamp: new Date().toISOString(),
      repair_method: `canonical_${objectType}_lookup`,
    };

    // 7. Create or update the order
    if (localOrderId) {
      await base44.asServiceRole.entities.ShopifyOrder.update(localOrderId, orderPayload);
      result.restored_order_id = localOrderId;
      result.action = 'updated_existing';
    } else {
      const created = await base44.asServiceRole.entities.ShopifyOrder.create(orderPayload);
      result.restored_order_id = created.id;
      result.action = 'created_new';
    }

    console.log(`[RESTORE-SUKHWANT] ${result.action} order ${result.restored_order_id} from Stripe`);
    return Response.json({ success: true, result });
  } catch (error) {
    console.error('[RESTORE-SUKHWANT]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});