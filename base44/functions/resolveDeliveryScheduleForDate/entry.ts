import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { selectedDate } = await req.json();

    if (!selectedDate) {
      return Response.json({ error: 'selectedDate required' }, { status: 400 });
    }

    // BLOCKED orders to exclude
    const BLOCKED = [
      'NV-MONHJHUY', 'NV-MONGOVGM', 'NV-MONL4I2M', 'NV-MONI2Z3R', 'SUB-1TPMGCIR'
    ];

    // Valid payment states
    const VALID_PAYMENT = ['paid', 'captured'];

    // Get all data
    const [tasks, orders, subscriptions] = await Promise.all([
      base44.entities.FulfillmentTask.list('-created_date', 1000),
      base44.entities.ShopifyOrder.list('-created_date', 1000),
      base44.entities.ShopifyOrder.filter({ order_type: 'subscription' }, '-created_date', 500),
    ]);

    // Filter valid orders
    const validOrders = orders.filter(o => 
      !BLOCKED.includes(o.shopify_order_number) &&
      VALID_PAYMENT.includes(o.payment_status) &&
      !o.canceled_at &&
      !o.refunded_at &&
      o.line_items?.length > 0 &&
      (o.address_line1 || o.fulfillment_method === 'pickup')
    );

    // Helper: resolve delivery date from task/order
    const resolveDeliveryDate = (task) => {
      return task.assigned_delivery_date || task.delivery_date || 
             task.scheduled_delivery_date || task.scheduled_date;
    };

    // Helper: resolve status readiness
    const isRouteEligible = (status) => {
      const routeStatuses = ['packed', 'in_cold_storage', 'assigned_for_pickup', 
                             'assigned_for_delivery', 'ready_for_route', 'out_for_delivery'];
      return routeStatuses.includes((status || '').toLowerCase());
    };

    const isCompleted = (status) => {
      const completedStatuses = ['completed', 'delivered', 'fulfilled'];
      return completedStatuses.includes((status || '').toLowerCase());
    };

    // 1. Collect from FulfillmentTasks for this date
    const taskCandidates = tasks.filter(t => resolveDeliveryDate(t) === selectedDate);

    // 2. Collect from paid orders with assigned_delivery_date matching this date
    const orderCandidates = validOrders
      .filter(o => o.assigned_delivery_date === selectedDate)
      .map(o => ({
        id: o.id,
        order_number: o.shopify_order_number,
        customer_name: o.customer_name,
        customer_email: o.customer_email,
        address_line1: o.address_line1,
        address_line2: o.address_line2,
        address_city: o.address_city,
        address_state: o.address_state,
        address_postal_code: o.address_postal_code,
        delivery_address: `${o.address_line1}${o.address_line2 ? ', ' + o.address_line2 : ''}, ${o.address_city}, ${o.address_state} ${o.address_postal_code}`,
        items: o.line_items || [],
        status: o.production_status || 'unassigned',
        fulfillment_type: 'Delivery',
        scheduled_date: selectedDate,
        assigned_delivery_date: selectedDate,
        source: 'order_assigned_delivery_date',
      }));

    // 3. Collect from subscription fulfillments (future instances)
    const subscriptionCandidates = [];
    for (const sub of subscriptions) {
      if (BLOCKED.includes(sub.shopify_order_number)) continue;
      if (!VALID_PAYMENT.includes(sub.payment_status)) continue;
      if (!sub.fulfillments?.length) continue;

      // Each fulfillment instance is its own delivery obligation
      for (const fulfillment of sub.fulfillments) {
        const fulfilledDate = fulfillment.delivery_date || fulfillment.production_date;
        if (fulfilledDate === selectedDate) {
          subscriptionCandidates.push({
            id: `${sub.id}-fulfillment-${fulfillment.fulfillment_number}`,
            order_number: sub.shopify_order_number,
            customer_name: sub.customer_name,
            customer_email: sub.customer_email,
            address_line1: fulfillment.address_line1 || sub.address_line1,
            address_line2: fulfillment.address_line2 || sub.address_line2,
            address_city: fulfillment.address_city || sub.address_city,
            address_state: fulfillment.address_state || sub.address_state,
            address_postal_code: fulfillment.address_postal_code || sub.address_postal_code,
            delivery_address: `${fulfillment.address_line1 || sub.address_line1}${(fulfillment.address_line2 || sub.address_line2) ? ', ' + (fulfillment.address_line2 || sub.address_line2) : ''}, ${fulfillment.address_city || sub.address_city}, ${fulfillment.address_state || sub.address_state} ${fulfillment.address_postal_code || sub.address_postal_code}`,
            items: fulfillment.items || sub.line_items || [],
            status: fulfillment.status || 'scheduled',
            fulfillment_type: 'Delivery',
            scheduled_date: selectedDate,
            assigned_delivery_date: selectedDate,
            fulfillment_number: fulfillment.fulfillment_number,
            source: 'subscription_fulfillment',
          });
        }
      }
    }

    // 4. Deduplicate: if task exists, use it; otherwise use order/subscription candidate
    const seenIds = new Set();
    const taskMap = {};
    
    // Add all tasks first (they're source of truth if they exist)
    for (const task of taskCandidates) {
      seenIds.add(task.order_id || `${task.id}`);
      taskMap[task.id] = task;
    }

    // Add order candidates only if no task exists for that order
    const orderOnlyOrders = orderCandidates.filter(o => !seenIds.has(o.id));
    
    // Add subscription candidates only if no duplicate
    const subOnlyOrders = subscriptionCandidates.filter(s => !seenIds.has(s.id));

    // Merge all delivery obligations
    const allDeliveries = [
      ...taskCandidates,
      ...orderOnlyOrders,
      ...subOnlyOrders,
    ];

    // Categorize by readiness
    const ready = allDeliveries.filter(d => isRouteEligible(d.status));
    const scheduled = allDeliveries.filter(d => !isRouteEligible(d.status) && !isCompleted(d.status));
    const completed = allDeliveries.filter(d => isCompleted(d.status));

    return Response.json({
      selected_date: selectedDate,
      raw_count: allDeliveries.length,
      ready_count: ready.length,
      scheduled_count: scheduled.length,
      completed_count: completed.length,
      deliveries: allDeliveries,
      ready_deliveries: ready,
      scheduled_deliveries: scheduled,
      completed_deliveries: completed,
    });
  } catch (error) {
    console.error('Resolver error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});