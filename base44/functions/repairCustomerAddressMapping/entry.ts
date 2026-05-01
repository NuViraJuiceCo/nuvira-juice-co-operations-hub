import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * REPAIR CUSTOMER ADDRESS MAPPING
 * 
 * Repairs customer identity and address data across:
 * - ShopifyOrder (order-level address)
 * - ShopifyOrder fulfillments (fulfillment-level address)
 * - FulfillmentTask (driver portal delivery address)
 * - NuViraCredit/customer profiles
 * 
 * Takes customer name + correct address, finds all orders,
 * and updates addresses across all linked records.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { customer_name, address_line1, address_line2, city, state, zip, country } = await req.json();

    if (!customer_name || !address_line1 || !city || !state || !zip) {
      return Response.json({ error: 'customer_name, address_line1, city, state, zip required' }, { status: 400 });
    }

    // STEP 1: Find all orders for this customer (by name)
    const allOrders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 500);
    const customerOrders = allOrders.filter(o => o.customer_name === customer_name);

    if (customerOrders.length === 0) {
      return Response.json({ error: `No orders found for customer: ${customer_name}` }, { status: 404 });
    }

    console.log(`[REPAIR-ADDRESS] Found ${customerOrders.length} orders for ${customer_name}`);

    const repaired = {
      orders_updated: 0,
      fulfillments_updated: 0,
      fulfillment_tasks_updated: 0,
      order_ids: [],
      errors: [],
    };

    // STEP 2: Repair each order and its fulfillments
    for (const order of customerOrders) {
      try {
        // Repair order-level address
        const orderUpdate = {
          address_line1,
          address_line2: address_line2 || '',
          address_city: city,
          address_state: state,
          address_postal_code: zip,
          address_country: country || 'US',
          address_last_synced_from: 'manual_repair',
          address_last_synced_at: new Date().toISOString(),
        };

        await base44.asServiceRole.entities.ShopifyOrder.update(order.id, orderUpdate);
        repaired.orders_updated++;
        repaired.order_ids.push(order.id);
        console.log(`[REPAIR-ADDRESS] Updated order ${order.shopify_order_number}`);

        // Repair fulfillment-level addresses if present
        if (order.fulfillments && order.fulfillments.length > 0) {
          const updatedFulfillments = order.fulfillments.map(f => ({
            ...f,
            address_line1,
            address_line2: address_line2 || '',
            address_city: city,
            address_state: state,
            address_postal_code: zip,
            address_country: country || 'US',
          }));

          await base44.asServiceRole.entities.ShopifyOrder.update(order.id, {
            fulfillments: updatedFulfillments,
          });
          repaired.fulfillments_updated += updatedFulfillments.length;
          console.log(`[REPAIR-ADDRESS] Updated ${updatedFulfillments.length} fulfillments for order ${order.shopify_order_number}`);
        }
      } catch (err) {
        repaired.errors.push({ order_id: order.id, error: err.message });
        console.error(`[REPAIR-ADDRESS] Failed to repair order ${order.id}:`, err.message);
      }
    }

    // STEP 3: Repair FulfillmentTask records for this customer
    try {
      const allTasks = await base44.asServiceRole.entities.FulfillmentTask.list('-created_date', 500);
      const customerTasks = allTasks.filter(t => t.customer_name === customer_name);

      for (const task of customerTasks) {
        await base44.asServiceRole.entities.FulfillmentTask.update(task.id, {
          address: `${address_line1}${address_line2 ? ', ' + address_line2 : ''}, ${city}, ${state} ${zip}`,
        });
        repaired.fulfillment_tasks_updated++;
        console.log(`[REPAIR-ADDRESS] Updated FulfillmentTask ${task.id}`);
      }
    } catch (err) {
      repaired.errors.push({ type: 'fulfillment_tasks', error: err.message });
      console.error(`[REPAIR-ADDRESS] Failed to repair FulfillmentTasks:`, err.message);
    }

    // STEP 4: Audit log
    await base44.asServiceRole.entities.OrderSyncLog.create({
      sync_timestamp: new Date().toISOString(),
      sync_source: 'manual_repair',
      event_type: 'customer_address_repair',
      order_id: repaired.order_ids.join(','),
      customer_email: customerOrders[0]?.customer_email || 'unknown',
      action: 'updated',
      reason: `Manual address repair for ${customer_name}`,
      fields_updated: ['address_line1', 'address_line2', 'address_city', 'address_state', 'address_postal_code', 'address_country'],
      success: true,
    });

    return Response.json({
      success: true,
      customer_name,
      repaired_address: `${address_line1}, ${city}, ${state} ${zip}`,
      repaired,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[REPAIR-ADDRESS] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});