import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * FETCH SUBSCRIPTION TEST DATA
 * Returns actual database records for a subscription
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await req.json();
    const { stripe_subscription_id } = body;

    if (!stripe_subscription_id) {
      return Response.json({ error: 'stripe_subscription_id required' }, { status: 400 });
    }

    const results = {
      subscription_id: stripe_subscription_id,
      fetched_at: new Date().toISOString(),
    };

    // 1. Get ShopifyOrder records
    const orders = await base44.asServiceRole.entities.ShopifyOrder.filter({
      stripe_subscription_id: stripe_subscription_id,
    });
    
    results.shopify_orders = {
      count: orders?.length || 0,
      records: (orders || []).map(o => ({
        id: o.id,
        shopify_order_number: o.shopify_order_number,
        customer_name: o.customer_name,
        customer_email: o.customer_email,
        total_price: o.total_price,
        subtotal: o.subtotal,
        fulfillment_sequence_number: o.fulfillment_sequence_number,
        source_type: o.source_type,
        fulfillment_method: o.fulfillment_method,
        production_status: o.production_status,
        order_lock_status: o.order_lock_status,
        data_quality_status: o.data_quality_status,
        line_items: o.line_items || [],
        fulfillments: (o.fulfillments || []).map(f => ({
          fulfillment_number: f.fulfillment_number,
          production_date: f.production_date,
          delivery_date: f.delivery_date,
          status: f.status,
          items: f.items || [],
          address: {
            line1: f.address_line1,
            city: f.address_city,
            state: f.address_state,
            postal_code: f.address_postal_code,
          },
        })),
        created_date: o.created_date,
        updated_date: o.updated_date,
      })),
    };

    // 2. Get FulfillmentTask records
    const tasks = await base44.asServiceRole.entities.FulfillmentTask.filter({});
    const tasksByOrder = (tasks || []).filter(t => 
      results.shopify_orders.records.some(o => o.id === t.order_id)
    );
    
    results.fulfillment_tasks = {
      count: tasksByOrder.length,
      records: tasksByOrder.map(t => ({
        id: t.id,
        customer_name: t.customer_name,
        fulfillment_type: t.fulfillment_type,
        status: t.status,
        scheduled_date: t.scheduled_date,
        address: t.address,
        items_summary: t.items_summary,
        order_id: t.order_id,
        created_date: t.created_date,
      })),
    };

    // 3. Get StripeEventLog entry
    const events = await base44.asServiceRole.entities.StripeEventLog.filter({
      event_type: 'customer.subscription.created',
    });
    const ourEvent = events?.find(e => 
      e.stripe_subscription_id === stripe_subscription_id || 
      (e.notes && e.notes.includes(stripe_subscription_id))
    );
    
    results.stripe_event_log = ourEvent ? {
      id: ourEvent.id,
      stripe_event_id: ourEvent.stripe_event_id,
      event_type: ourEvent.event_type,
      stripe_subscription_id: ourEvent.stripe_subscription_id,
      stripe_customer_id: ourEvent.stripe_customer_id,
      customer_email: ourEvent.customer_email,
      status: ourEvent.status,
      notes: ourEvent.notes,
      created_date: ourEvent.created_date,
    } : null;

    // 4. Get ProductionBatch records
    const batches = await base44.asServiceRole.entities.ProductionBatch.filter({});
    const batchesByOrder = (batches || []).filter(b => 
      b.order_sources?.some(os => 
        results.shopify_orders.records.some(o => o.id === os.order_id)
      )
    );
    
    results.production_batches = {
      count: batchesByOrder.length,
      records: batchesByOrder.map(b => ({
        id: b.id,
        batch_id: b.batch_id,
        product_name: b.product_name,
        product_category: b.product_category,
        status: b.status,
        planned_units: b.planned_units,
        actual_units: b.actual_units || 0,
        production_date: b.production_date,
        assigned_to: b.assigned_to,
        order_sources: (b.order_sources || []).map(os => ({
          order_id: os.order_id,
          order_number: os.order_number,
          customer_email: os.customer_email,
          quantity: os.quantity,
        })),
        created_date: b.created_date,
      })),
    };

    // Summary
    results.summary = {
      orders_created: results.shopify_orders.count,
      fulfillment_tasks_created: results.fulfillment_tasks.count,
      production_batches_created: results.production_batches.count,
      event_logged: !!results.stripe_event_log,
      all_line_items_populated: results.shopify_orders.records.every(o => 
        o.line_items && o.line_items.length > 0
      ),
      all_fulfillments_present: results.shopify_orders.records.every(o => 
        o.fulfillments && o.fulfillments.length > 0
      ),
    };

    return Response.json({ success: true, results });
  } catch (error) {
    console.error('[FETCH-TEST-DATA]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});