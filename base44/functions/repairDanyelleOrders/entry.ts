import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_API_KEY'));

const SESSION_IDS = [
  'cs_live_b1SPu9H8MoVMzF0rHrn6nForBgkwl0RNfhDDoJtbh57tSfTlMvb39nPWG1', // NV-MOILVI17
  'cs_live_b1hDa3CK0NLXcOeUOeE8oBboSsZITioLj3xxHNCWIXSiEwehiLROoFXZQi', // NV-MOILSACV
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run !== false; // default to dry run for safety

    const created = [];
    const skipped = [];
    const errors = [];

    for (const sessionId of SESSION_IDS) {
      // Fetch session with line items expanded
      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ['line_items', 'line_items.data.price.product', 'payment_intent'],
      });

      const orderNumber = session.metadata?.order_number;
      const customerEmail = session.metadata?.customer_email || session.customer_details?.email;
      const customerName = session.customer_details?.name || '';
      const piId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;

      if (!orderNumber) {
        errors.push({ session: sessionId, error: 'No order_number in metadata' });
        continue;
      }

      // Check if already exists
      const existing = await base44.asServiceRole.entities.ShopifyOrder.filter({ shopify_order_number: orderNumber });
      if (existing.length > 0) {
        skipped.push({ order_number: orderNumber, reason: 'Already exists' });
        continue;
      }

      // Build line items from Stripe
      const lineItems = (session.line_items?.data || []).map(item => ({
        title: item.description || item.price?.product?.name || 'Unknown',
        quantity: item.quantity,
        price: (item.amount_total / 100) / item.quantity,
      }));

      const orderData = {
        shopify_order_id: sessionId,
        shopify_order_number: orderNumber,
        customer_email: customerEmail,
        customer_name: customerName,
        source_channel: 'online',
        source_type: 'stripe_checkout',
        payment_status: 'authorized',
        production_status: 'new',
        data_quality_status: 'complete',
        order_lock_status: 'unlocked',
        sync_status: 'synced',
        stripe_checkout_session_id: sessionId,
        stripe_payment_intent_id: piId,
        total_price: session.amount_total / 100,
        subtotal: session.amount_subtotal / 100,
        line_items: lineItems,
        customer_order_date: new Date(session.created * 1000).toISOString(),
        repair_status: 'restored_from_stripe',
        repair_timestamp: new Date().toISOString(),
        repair_method: 'repairDanyelleOrders',
        internal_notes: `Manually recovered: checkout session ${sessionId} was authorized (pre-order, captures May 1). Created by ${user.email} on ${new Date().toISOString()}`,
      };

      if (!dryRun) {
        const record = await base44.asServiceRole.entities.ShopifyOrder.create(orderData);
        created.push({ order_number: orderNumber, id: record.id, line_items: lineItems });
      } else {
        created.push({ dry_run: true, order_number: orderNumber, line_items: lineItems, order_data: orderData });
      }
    }

    return Response.json({
      dry_run: dryRun,
      created,
      skipped,
      errors,
      message: dryRun
        ? 'DRY RUN — pass dry_run: false to actually create the orders'
        : `Created ${created.length} order(s)`,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});