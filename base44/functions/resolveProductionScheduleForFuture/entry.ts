import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });

    // BLOCKED orders
    const BLOCKED = [
      'NV-MONHJHUY', 'NV-MONGOVGM', 'NV-MONL4I2M', 'NV-MONI2Z3R', 'SUB-1TPMGCIR'
    ];

    const VALID_PAYMENT = ['paid', 'captured'];

    // Get all data
    const [orders, batches] = await Promise.all([
      base44.entities.ShopifyOrder.list('-created_date', 1000),
      base44.entities.ProductionBatch.list('-production_date', 500),
    ]);

    // Filter valid orders
    const validOrders = orders.filter(o => 
      !BLOCKED.includes(o.shopify_order_number) &&
      VALID_PAYMENT.includes(o.payment_status) &&
      !o.canceled_at &&
      !o.refunded_at &&
      o.line_items?.length > 0
    );

    // Map of production_date -> { product_name -> { total_units, order_sources } }
    const productionSchedule = {};

    // 1. From one-time orders with assigned_production_date
    for (const order of validOrders) {
      if (!order.assigned_production_date) continue;
      if (order.order_type === 'subscription') continue;

      const prodDate = order.assigned_production_date;
      if (!productionSchedule[prodDate]) {
        productionSchedule[prodDate] = {};
      }

      for (const item of order.line_items || []) {
        const productName = item.title;
        if (!productionSchedule[prodDate][productName]) {
          productionSchedule[prodDate][productName] = { 
            total_units: 0, 
            order_sources: [] 
          };
        }
        productionSchedule[prodDate][productName].total_units += (item.quantity || 1);
        productionSchedule[prodDate][productName].order_sources.push({
          order_id: order.id,
          order_number: order.shopify_order_number,
          customer_name: order.customer_name,
          customer_email: order.customer_email,
          quantity: item.quantity || 1,
          source_type: 'direct',
        });
      }
    }

    // 2. From subscription fulfillments
    const subscriptions = validOrders.filter(o => o.order_type === 'subscription');
    for (const sub of subscriptions) {
      if (!sub.fulfillments?.length) continue;

      for (const fulfillment of sub.fulfillments) {
        const prodDate = fulfillment.production_date;
        if (!prodDate) continue;

        if (!productionSchedule[prodDate]) {
          productionSchedule[prodDate] = {};
        }

        for (const item of fulfillment.items || []) {
          const productName = item.title;
          if (!productionSchedule[prodDate][productName]) {
            productionSchedule[prodDate][productName] = { 
              total_units: 0, 
              order_sources: [] 
            };
          }
          productionSchedule[prodDate][productName].total_units += (item.quantity || 1);
          productionSchedule[prodDate][productName].order_sources.push({
            order_id: sub.id,
            order_number: sub.shopify_order_number,
            customer_name: sub.customer_name,
            customer_email: sub.customer_email,
            quantity: item.quantity || 1,
            source_type: 'subscription',
            fulfillment_number: fulfillment.fulfillment_number,
          });
        }
      }
    }

    // 3. Build production cards: merge scheduled demand with existing batches
    const productionCards = [];

    // First add all scheduled demand
    for (const [prodDate, products] of Object.entries(productionSchedule)) {
      for (const [productName, demand] of Object.entries(products)) {
        // Check if batch already exists for this date/product
        const existingBatch = batches.find(b => 
          b.production_date === prodDate && b.product_name === productName
        );

        if (existingBatch) {
          // Merge scheduled demand into physical batch
          productionCards.push({
            id: existingBatch.id,
            type: 'physical_batch',
            batch_id: existingBatch.batch_id,
            production_date: prodDate,
            product_name: productName,
            product_category: existingBatch.product_category,
            status: existingBatch.status,
            planned_units: demand.total_units,
            actual_units: existingBatch.actual_units,
            order_sources: demand.order_sources,
            existing: true,
          });
        } else {
          // Create future production card
          productionCards.push({
            id: `future-${prodDate}-${productName}`,
            type: 'future_demand',
            production_date: prodDate,
            product_name: productName,
            product_category: 'juice', // Default
            status: 'planned',
            planned_units: demand.total_units,
            actual_units: 0,
            order_sources: demand.order_sources,
            existing: false,
          });
        }
      }
    }

    // 4. Filter: only show production days where demand exists
    const validProdDates = Object.keys(productionSchedule);

    return Response.json({
      production_dates: validProdDates,
      production_cards: productionCards.filter(c => validProdDates.includes(c.production_date)),
      future_cards_count: productionCards.filter(c => c.type === 'future_demand').length,
      existing_batches_count: productionCards.filter(c => c.type === 'physical_batch').length,
    });
  } catch (error) {
    console.error('Production resolver error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});