import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import moment from 'npm:moment-timezone@0.5.45';

const TZ = 'America/Chicago';

// NuVira schedule rules - corrected for immediate upcoming dates
function calculateExpectedSchedule(orderCreatedAt) {
  const orderTime = moment.tz(orderCreatedAt, TZ);
  const dayOfWeek = orderTime.day(); // 0=Sun, 1=Mon, ..., 6=Sat
  const hour = orderTime.hour();
  
  let productionDate, deliveryDate;
  
  // Window 1: Saturday after 2 PM through Tuesday 2 PM -> immediate upcoming Tuesday production, Wednesday delivery
  if ((dayOfWeek === 6 && hour >= 14) || (dayOfWeek === 0) || (dayOfWeek === 1) || (dayOfWeek === 2 && hour < 14)) {
    // Get the immediate upcoming Tuesday (not next week's Tuesday)
    let targetTuesday = moment.tz(orderTime, TZ).clone().day(2); // Get Tuesday of current week
    if (targetTuesday.isBefore(orderTime) || targetTuesday.isSame(orderTime, 'day')) {
      targetTuesday = targetTuesday.add(1, 'week'); // Move to next week's Tuesday only if current Tuesday has passed
    }
    productionDate = targetTuesday.format('YYYY-MM-DD');
    deliveryDate = targetTuesday.clone().add(1, 'day').format('YYYY-MM-DD'); // Wednesday
  }
  // Window 2: Tuesday after 2 PM through Friday 2 PM -> immediate upcoming Friday production, Saturday delivery
  else if ((dayOfWeek === 2 && hour >= 14) || (dayOfWeek === 3) || (dayOfWeek === 4 && hour < 14)) {
    // Get the immediate upcoming Friday
    let targetFriday = moment.tz(orderTime, TZ).clone().day(5); // Get Friday of current week
    if (targetFriday.isBefore(orderTime) || targetFriday.isSame(orderTime, 'day')) {
      targetFriday = targetFriday.add(1, 'week'); // Move to next week's Friday only if current Friday has passed
    }
    productionDate = targetFriday.format('YYYY-MM-DD');
    deliveryDate = targetFriday.clone().add(1, 'day').format('YYYY-MM-DD'); // Saturday
  }
  // Window 3: Friday after 2 PM through Saturday 2 PM -> Saturday production (if threshold) or Tuesday production
  else if ((dayOfWeek === 5 && hour >= 14) || (dayOfWeek === 6 && hour < 14)) {
    // For now, default to immediate upcoming Tuesday/Wednesday (threshold check would require order count)
    let targetTuesday = moment.tz(orderTime, TZ).clone().day(2);
    if (targetTuesday.isBefore(orderTime) || targetTuesday.isSame(orderTime, 'day')) {
      targetTuesday = targetTuesday.add(1, 'week');
    }
    productionDate = targetTuesday.format('YYYY-MM-DD');
    deliveryDate = targetTuesday.clone().add(1, 'day').format('YYYY-MM-DD'); // Wednesday
  }
  
  return { productionDate, deliveryDate };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Get all orders
    const allOrders = await base44.entities.ShopifyOrder.list('-created_date', 500);
    
    // Filter to valid paid orders
    const validOrders = allOrders.filter(o => {
      if (o.deleted_at || o.canceled_at || o.refunded_at) return false;
      if (o.do_not_recover === true) return false;
      if (['test', 'quarantined'].includes(o.data_quality_status)) return false;
      if (!['paid', 'captured'].includes(o.payment_status)) return false;
      if (!o.customer_email || !o.address_line1) return false;
      if (!o.line_items || o.line_items.length === 0) return false;
      return true;
    });

    // Get all production batches and fulfillment tasks
    const allBatches = await base44.entities.ProductionBatch.list('-production_date', 500);
    const allTasks = await base44.entities.FulfillmentTask.list('-scheduled_date', 500);
    
    // Audit each order
    const auditResults = validOrders.map(order => {
      const { productionDate: expectedProd, deliveryDate: expectedDel } = calculateExpectedSchedule(order.created_date);
      
      const actualProd = order.assigned_production_date || order.scheduled_production_date;
      const actualDel = order.assigned_delivery_date || order.scheduled_delivery_date;
      
      const batchExists = allBatches.some(b => 
        b.production_date === expectedProd && 
        b.order_sources?.some(s => s.order_id === order.id)
      );
      
      const taskExists = allTasks.find(t => t.order_id === order.id && t.scheduled_date === expectedDel);
      
      return {
        order_number: order.shopify_order_number,
        customer_name: order.customer_name,
        created_at: order.created_date,
        expected_production_date: expectedProd,
        actual_production_date: actualProd,
        expected_delivery_date: expectedDel,
        actual_delivery_date: actualDel,
        dates_assigned: !!actualProd && !!actualDel,
        batch_found: batchExists,
        task_found: !!taskExists,
        production_date_match: actualProd === expectedProd,
        delivery_date_match: actualDel === expectedDel,
        issues: [
          !actualProd && `Missing assigned_production_date (expected ${expectedProd})`,
          !actualDel && `Missing assigned_delivery_date (expected ${expectedDel})`,
          actualProd && actualProd !== expectedProd && `Production date mismatch: actual=${actualProd}, expected=${expectedProd}`,
          !batchExists && `No ProductionBatch found for ${expectedProd}`,
          !taskExists && `No FulfillmentTask found for delivery ${expectedDel}`,
        ].filter(Boolean)
      };
    });

    // Group by delivery date to identify Wednesday gaps
    const tasksByDeliveryDate = {};
    allTasks.forEach(task => {
      const date = task.scheduled_date || task.delivery_date || task.assigned_delivery_date;
      if (!tasksByDeliveryDate[date]) tasksByDeliveryDate[date] = [];
      tasksByDeliveryDate[date].push(task);
    });

    // Find Wednesday dates and check completeness
    const wednesdayDates = Object.keys(tasksByDeliveryDate).filter(date => {
      const d = moment.tz(date, 'YYYY-MM-DD', TZ);
      return d.day() === 3; // 3 = Wednesday
    }).sort();

    const wednesdayAudit = wednesdayDates.map(wednesdayDate => {
      const tuesdayDate = moment.tz(wednesdayDate, 'YYYY-MM-DD', TZ).subtract(1, 'day').format('YYYY-MM-DD');
      
      // Find orders that should have Tuesday production -> Wednesday delivery
      const expectedOrders = validOrders.filter(o => {
        const { productionDate, deliveryDate } = calculateExpectedSchedule(o.created_date);
        return productionDate === tuesdayDate && deliveryDate === wednesdayDate;
      });
      
      const tasksForWednesday = tasksByDeliveryDate[wednesdayDate] || [];
      
      return {
        delivery_date: wednesdayDate,
        production_date: tuesdayDate,
        orders_expected: expectedOrders.length,
        fulfillment_tasks_found: tasksForWednesday.length,
        missing_order_numbers: expectedOrders
          .filter(o => !tasksForWednesday.some(t => t.order_id === o.id))
          .map(o => o.shopify_order_number),
        gap_exists: expectedOrders.length > 0 && tasksForWednesday.length < expectedOrders.length
      };
    });

    // Count issues
    const summary = {
      total_valid_paid_orders: validOrders.length,
      orders_missing_production_date: auditResults.filter(r => !r.actual_production_date).length,
      orders_missing_delivery_date: auditResults.filter(r => !r.actual_delivery_date).length,
      orders_missing_fulfillment_task: auditResults.filter(r => !r.task_found).length,
      future_production_days_missing: auditResults.filter(r => !r.batch_found && r.expected_production_date > moment.tz(TZ).format('YYYY-MM-DD')).length,
      wednesday_deliveries_with_gaps: wednesdayAudit.filter(w => w.gap_exists).length,
    };

    return Response.json({
      summary,
      audit_results: auditResults.filter(r => r.issues.length > 0), // Only show problematic orders
      wednesday_audit: wednesdayAudit,
      timezone: TZ,
      audit_date: moment.tz(TZ).format('YYYY-MM-DD HH:mm:ss'),
    });
  } catch (error) {
    console.error('Audit error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});