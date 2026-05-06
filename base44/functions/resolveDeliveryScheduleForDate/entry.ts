import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { selectedDate } = await req.json();

    if (!selectedDate) {
      return Response.json({ error: 'selectedDate required' }, { status: 400 });
    }

    // BLOCKED orders to exclude (static list — belt-and-suspenders on top of dynamic checks)
    const BLOCKED = [
      'NV-MONHJHUY', 'NV-MONGOVGM', 'NV-MONL4I2M', 'NV-MONI2Z3R', 'SUB-1TPMGCIR'
    ];

    // Valid payment states
    const VALID_PAYMENT = ['paid', 'captured'];

    // Task statuses that are fully inactive — never show in driver portal
    const INACTIVE_TASK_STATUSES = ['cancelled', 'canceled', 'Cancelled', 'Canceled'];

    // Get all data
    const [tasks, orders, subscriptions] = await Promise.all([
      base44.entities.FulfillmentTask.list('-created_date', 1000),
      base44.entities.ShopifyOrder.list('-created_date', 1000),
      base44.entities.ShopifyOrder.filter({ order_type: 'subscription' }, '-created_date', 500),
    ]);

    // Build lookup maps
    const orderMap = {};
    orders.forEach(o => {
      orderMap[o.id] = o;
      if (o.shopify_order_number) orderMap[o.shopify_order_number] = o;
      if (o.customer_email) orderMap[`email-${o.customer_email}-${selectedDate}`] = o;
    });

    const subscriptionMap = {};
    subscriptions.forEach(s => {
      subscriptionMap[s.id] = s;
      if (s.shopify_order_number) subscriptionMap[s.shopify_order_number] = s;
    });

    // Filter valid orders — must be paid, not excluded/refunded/canceled
    const validOrders = orders.filter(o => {
      if (BLOCKED.includes(o.shopify_order_number)) return false;
      if (!VALID_PAYMENT.includes(o.payment_status)) return false;
      if (o.payment_status === 'refunded') return false;
      if (o.production_status === 'canceled' || o.production_status === 'cancelled') return false;
      if (Array.isArray(o.tags) && o.tags.includes('excluded')) return false;
      if (!o.line_items?.length) return false;
      if (!o.address_line1 && o.fulfillment_method !== 'pickup') return false;
      return true;
    });

    // Build a set of valid order IDs for fast lookup when filtering tasks
    const validOrderIds = new Set(validOrders.map(o => o.id));

    // Helper: resolve delivery date — scheduled_date is canonical
    const resolveDeliveryDate = (task) => {
      return task.scheduled_date || task.scheduled_delivery_date || 
             task.delivery_date || task.assigned_delivery_date;
    };

    // Helper: hydrate item with linked order data
    const hydrateItem = (item, linkedOrder) => {
      if (!linkedOrder) return item;
      
      return {
        ...item,
        customer_name: item.customer_name || linkedOrder.customer_name,
        customer_email: item.customer_email || linkedOrder.customer_email,
        customer_phone: item.customer_phone || linkedOrder.contact_phone || linkedOrder.phone,
        address_line1: item.address_line1 || linkedOrder.address_line1,
        address_line2: item.address_line2 || linkedOrder.address_line2,
        address_city: item.address_city || linkedOrder.address_city,
        address_state: item.address_state || linkedOrder.address_state,
        address_postal_code: item.address_postal_code || linkedOrder.address_postal_code,
        delivery_address: item.delivery_address || 
          (linkedOrder.address_line1 ? `${linkedOrder.address_line1}${linkedOrder.address_line2 ? ', ' + linkedOrder.address_line2 : ''}, ${linkedOrder.address_city}, ${linkedOrder.address_state} ${linkedOrder.address_postal_code}` : ''),
        items: item.items && item.items.length > 0 ? item.items : (linkedOrder.line_items || []),
      };
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
    const taskCandidates = tasks
      .filter(t => {
        if (resolveDeliveryDate(t) !== selectedDate) return false;
        // Hard-exclude cancelled tasks
        if (INACTIVE_TASK_STATUSES.includes(t.status)) return false;
        // Hard-exclude tasks whose linked order is refunded/excluded/canceled
        if (t.order_id) {
          const linkedOrder = orderMap[t.order_id];
          if (linkedOrder) {
            if (linkedOrder.payment_status === 'refunded') return false;
            if (linkedOrder.production_status === 'canceled' || linkedOrder.production_status === 'cancelled') return false;
            if (Array.isArray(linkedOrder.tags) && linkedOrder.tags.includes('excluded')) return false;
          }
        }
        return true;
      })
      .map(t => {
        // Find linked order
        const linkedOrder = orderMap[t.order_id] || orderMap[t.order_number?.replace('#', '')];
        return hydrateItem({
          id: t.id,
          order_id: t.order_id,
          order_number: t.order_number,
          customer_name: t.customer_name,
          customer_email: t.customer_email,
          customer_phone: t.customer_phone,
          address_line1: t.address || (t.address_line1 || ''),
          address_line2: t.address_line2 || '',
          address_city: t.address_city || '',
          address_state: t.address_state || '',
          address_postal_code: t.address_postal_code || '',
          delivery_address: t.address || '',
          items: [],
          status: t.status,
          fulfillment_type: t.fulfillment_type,
          scheduled_date: resolveDeliveryDate(t),
          assigned_delivery_date: resolveDeliveryDate(t),
          source: 'fulfillment_task',
          fulfillment_task_id: t.id,
        }, linkedOrder);
      });

    // 2. Collect from paid orders with assigned_delivery_date matching this date
    const orderCandidates = validOrders
      .filter(o => o.assigned_delivery_date === selectedDate)
      .map(o => hydrateItem({
        id: o.id,
        order_id: o.id,
        order_number: o.shopify_order_number,
        customer_name: o.customer_name,
        customer_email: o.customer_email,
        customer_phone: o.contact_phone,
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
      }, o));

    // 3. Collect from subscription fulfillments
    const subscriptionCandidates = [];
    for (const sub of subscriptions) {
      if (BLOCKED.includes(sub.shopify_order_number)) continue;
      if (!VALID_PAYMENT.includes(sub.payment_status)) continue;
      if (!sub.fulfillments?.length) continue;

      for (const fulfillment of sub.fulfillments) {
        const fulfilledDate = fulfillment.delivery_date || fulfillment.production_date;
        if (fulfilledDate === selectedDate) {
          subscriptionCandidates.push(hydrateItem({
            id: `${sub.id}-fulfillment-${fulfillment.fulfillment_number}`,
            order_id: sub.id,
            order_number: sub.shopify_order_number,
            subscription_id: sub.id,
            subscription_fulfillment_number: fulfillment.fulfillment_number,
            customer_name: sub.customer_name,
            customer_email: sub.customer_email,
            customer_phone: sub.contact_phone,
            address_line1: fulfillment.address_line1 || sub.address_line1,
            address_line2: fulfillment.address_line2 || sub.address_line2,
            address_city: fulfillment.address_city || sub.address_city,
            address_state: fulfillment.address_state || sub.address_state,
            address_postal_code: fulfillment.address_postal_code || sub.address_postal_code,
            delivery_address: `${fulfillment.address_line1 || sub.address_line1}${(fulfillment.address_line2 || sub.address_line2) ? ', ' + (fulfillment.address_line2 || sub.address_line2) : ''}, ${fulfillment.address_city || sub.address_city}, ${fulfillment.address_state || sub.address_state} ${fulfillment.address_postal_code || sub.address_postal_code}`,
            items: fulfillment.items || [],
            status: fulfillment.status || 'scheduled',
            fulfillment_type: 'Delivery',
            scheduled_date: selectedDate,
            assigned_delivery_date: selectedDate,
            fulfillment_number: fulfillment.fulfillment_number,
            source: 'subscription_fulfillment',
          }, sub));
        }
      }
    }

    // Build a FulfillmentTask lookup map by order_id+date for fallback resolution
    // This lets subscription_fulfillment and order fallback candidates resolve real task IDs
    const taskByOrderDate = {};
    tasks.forEach(t => {
      const date = t.scheduled_date || t.scheduled_delivery_date || t.delivery_date || t.assigned_delivery_date;
      if (t.order_id && date) {
        taskByOrderDate[`${t.order_id}-${date}`] = t.id;
      }
    });

    // 4. Deduplicate: FulfillmentTask wins over subscription fulfillment for same subscription/fulfillment/date
    const dedupeMap = {};
    
    // Process tasks first (highest priority)
    for (const task of taskCandidates) {
      const key = `${task.order_id || task.order_number}-${task.scheduled_date}`;
      dedupeMap[key] = task;
    }

    // Add order candidates if no existing entry; resolve real task ID if available
    for (const order of orderCandidates) {
      const key = `${order.order_id}-${order.scheduled_date}`;
      if (!dedupeMap[key]) {
        const realTaskId = taskByOrderDate[`${order.order_id}-${order.scheduled_date}`] || null;
        dedupeMap[key] = {
          ...order,
          fulfillment_task_id: realTaskId,
          action_allowed: !!realTaskId,
          missing_fulfillment_task_id: !realTaskId,
        };
      }
    }

    // Add subscription candidates only if no task for that subscription/fulfillment/date; resolve real task ID if available
    for (const sub of subscriptionCandidates) {
      const subKey = `${sub.subscription_id}-fulfillment-${sub.subscription_fulfillment_number}-${sub.scheduled_date}`;
      const taskKey = `${sub.subscription_id}-${sub.scheduled_date}`;
      
      // Only add if no existing task/order for this subscription fulfillment
      if (!dedupeMap[subKey] && !dedupeMap[taskKey]) {
        const realTaskId = taskByOrderDate[`${sub.order_id}-${sub.scheduled_date}`] || null;
        dedupeMap[subKey] = {
          ...sub,
          fulfillment_task_id: realTaskId,
          action_allowed: !!realTaskId,
          missing_fulfillment_task_id: !realTaskId,
        };
      }
    }

    // Final deduplicated list
    const allDeliveries = Object.values(dedupeMap);

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