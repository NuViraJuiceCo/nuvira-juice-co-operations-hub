/**
 * Helper to compute delivery status from batch order sources and fulfillment tasks.
 * Reads order_sources[].order_id (primary) or related_orders (fallback).
 * For subscription orders, only counts the fulfillment task for the batch's production_date,
 * not future subscription instances.
 */
export function resolveBatchDeliveryStatus(batch, fulfillmentTasksByOrderId = {}) {
  if (!batch) return '—';

  // Get unique order IDs from order_sources (primary) or related_orders (fallback)
  const orderIds = [];
  if (batch.order_sources && batch.order_sources.length > 0) {
    orderIds.push(...batch.order_sources.map(s => s.order_id).filter(Boolean));
  } else if (batch.related_orders && batch.related_orders.length > 0) {
    orderIds.push(...batch.related_orders);
  }

  // No linked orders = empty state
  if (orderIds.length === 0) {
    return '—';
  }

  // Collect fulfillment tasks for these order IDs
  // Filter to only include tasks matching the batch's production_date
  const batchDate = batch.production_date; // e.g., "2026-05-01"
  const linkedTasks = [];

  for (const orderId of orderIds) {
    const tasks = fulfillmentTasksByOrderId[orderId] || [];
    for (const task of tasks) {
      // For subscription orders, only count tasks scheduled for the batch's production date
      // (or the day production was supposed to happen, e.g., May 2 for May 1 batch)
      if (task.scheduled_date && batchDate) {
        // May 1 batch should link to May 2 fulfillments (next day), not future May 9+
        // Check if the task's scheduled_date is within 1-2 days of the batch date (production day + 1 for delivery)
        const batchDateObj = new Date(batchDate);
        const taskDateObj = new Date(task.scheduled_date);
        const daysDiff = Math.floor((taskDateObj - batchDateObj) / (1000 * 60 * 60 * 24));

        // Include tasks scheduled for the batch date itself or the next 1-2 days (for next-day delivery)
        // Exclude tasks more than 2 days in the future
        if (daysDiff >= 0 && daysDiff <= 2) {
          linkedTasks.push(task);
        }
      } else {
        linkedTasks.push(task);
      }
    }
  }

  // No delivery tasks found for these orders
  if (linkedTasks.length === 0) {
    return 'No delivery link';
  }

  // Count delivered vs total
  const isDelivered = (status) => {
    if (!status) return false;
    const lower = String(status).toLowerCase();
    return ['completed', 'delivered', 'fulfilled'].includes(lower);
  };

  const deliveredCount = linkedTasks.filter(t => isDelivered(t.status)).length;
  const totalCount = linkedTasks.length;

  // All delivered
  if (deliveredCount === totalCount && totalCount > 0) {
    return `${deliveredCount}/${totalCount} Delivered`;
  }

  // Some delivered
  if (deliveredCount > 0) {
    return `${deliveredCount}/${totalCount} Delivered`;
  }

  // None delivered yet
  return 'Pending';
}