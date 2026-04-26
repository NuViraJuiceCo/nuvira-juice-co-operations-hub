import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * CREATE TEST VIP WELLNESS SUBSCRIPTION
 * For verification testing only
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Create a test VIP Wellness subscription order with 4 fulfillments
    // VIP: 2 Oasis, 2 Aura, 2 Re-Nu per weekly fulfillment = 6 bottles/week

    const fulfillments = [];
    const firstProdDate = '2026-05-06'; // Tuesday

    for (let i = 0; i < 4; i++) {
      const prodDate = new Date(firstProdDate + 'T00:00:00');
      prodDate.setDate(prodDate.getDate() + 7 * i);
      const prodDateStr = prodDate.toISOString().split('T')[0];

      const delivDate = new Date(prodDate);
      delivDate.setDate(delivDate.getDate() + 3);
      const delivDateStr = delivDate.toISOString().split('T')[0];

      fulfillments.push({
        fulfillment_number: i + 1,
        production_date: prodDateStr,
        delivery_date: delivDateStr,
        items: [
          { title: 'Oasis', quantity: 2, price: 0 },
          { title: 'Aura', quantity: 2, price: 0 },
          { title: 'Re-Nu', quantity: 2, price: 0 },
        ],
        status: 'pending',
        address_line1: '789 VIP Lane',
        address_city: 'Austin',
        address_state: 'TX',
        address_postal_code: '78701',
        address_country: 'US',
      });
    }

    // Create the parent order
    const vipOrder = await base44.asServiceRole.entities.ShopifyOrder.create({
      shopify_order_id: 'vip-test-sub-001',
      shopify_order_number: '#VIP-WELLNESS-TEST',
      customer_name: 'VIP Test Customer',
      customer_email: 'vip-test@nuvirajuices.com',
      customer_phone: '512-555-0100',
      line_items: [
        { title: 'Oasis', quantity: 8, price: 0 },
        { title: 'Aura', quantity: 8, price: 0 },
        { title: 'Re-Nu', quantity: 8, price: 0 },
      ],
      fulfillments: fulfillments,
      total_price: 288,
      subtotal: 288,
      payment_status: 'paid',
      source_channel: 'subscription',
      fulfillment_method: 'delivery',
      production_status: 'new',
      sync_status: 'synced',
      last_sync_at: new Date().toISOString(),
      customer_order_date: new Date().toISOString(),
      stripe_subscription_id: 'sub_test_vip_wellness_001',
      stripe_customer_id: 'cus_vip_test_001',
      stripe_created_event_type: 'customer.subscription.created',
      source_type: 'stripe_subscription',
      address_line1: '789 VIP Lane',
      address_city: 'Austin',
      address_state: 'TX',
      address_postal_code: '78701',
      address_country: 'US',
      address_last_synced_from: 'test',
      address_last_synced_at: new Date().toISOString(),
      data_quality_status: 'complete',
      order_lock_status: 'unlocked',
      repair_status: 'none',
    });

    // Create Stripe event log
    const event = await base44.asServiceRole.entities.StripeEventLog.create({
      stripe_event_id: `test_event_vip_${Date.now()}`,
      event_type: 'customer.subscription.created',
      stripe_object_id: 'sub_test_vip_wellness_001',
      stripe_subscription_id: 'sub_test_vip_wellness_001',
      stripe_customer_id: 'cus_vip_test_001',
      customer_email: 'vip-test@nuvirajuices.com',
      status: 'processed',
      notes: 'Test VIP Wellness subscription for Model A verification',
    });

    // Create FulfillmentTasks
    const tasks = [];
    for (const fulfillment of fulfillments) {
      const task = await base44.asServiceRole.entities.FulfillmentTask.create({
        customer_name: 'VIP Test Customer',
        fulfillment_type: 'Delivery',
        status: 'Unassigned',
        scheduled_date: fulfillment.delivery_date,
        address: '789 VIP Lane, Austin, TX 78701',
        items_summary: '2x Oasis, 2x Aura, 2x Re-Nu',
        order_id: vipOrder.id,
      });
      tasks.push(task.id);
    }

    // Create ProductionBatches
    const batches = [];
    const batchMap = {};

    for (const fulfillment of fulfillments) {
      for (const item of fulfillment.items) {
        const key = `${fulfillment.production_date}__${item.title}`;
        if (!batchMap[key]) {
          const batchId = `BATCH-${fulfillment.production_date.replace(/-/g, '')}-${item.title.replace(/\s+/g, '')}`;
          batchMap[key] = {
            batch_id: batchId,
            product_name: item.title,
            production_date: fulfillment.production_date,
            planned_units: 0,
            order_sources: [],
          };
        }
        batchMap[key].planned_units += item.quantity;
        batchMap[key].order_sources.push({
          order_id: vipOrder.id,
          order_number: vipOrder.shopify_order_number,
          customer_email: vipOrder.customer_email,
          customer_name: vipOrder.customer_name,
          quantity: item.quantity,
          source_type: 'subscription',
          source_item: item.title,
        });
      }
    }

    for (const batchData of Object.values(batchMap)) {
      const batch = await base44.asServiceRole.entities.ProductionBatch.create({
        batch_id: batchData.batch_id,
        product_name: batchData.product_name,
        product_category: 'juice',
        status: 'Planned',
        planned_units: batchData.planned_units,
        actual_units: 0,
        production_date: batchData.production_date,
        notes: 'VIP Wellness test batch',
        is_locked: false,
        order_sources: batchData.order_sources,
      });
      batches.push(batch.id);
    }

    return Response.json({
      success: true,
      subscription_id: 'sub_test_vip_wellness_001',
      order_id: vipOrder.id,
      tasks_created: tasks.length,
      batches_created: batches.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[CREATE-VIP-TEST]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});