/**
 * resolveDeliveryAddress — Canonical address resolver for NuVira Hub
 *
 * Priority order:
 * 1. order.address_line1/city/state/postal_code (structured fields, most canonical)
 * 2. order.fulfillments[0] structured address fields (set by recalculate or subscription)
 * 3. Matching FulfillmentTask structured address fields
 * 4. order.delivery_address string fallback
 * 5. FulfillmentTask.delivery_address / address string fallback
 *
 * Returns: { line1, line2, city, state, zip, country, formatted, isComplete, source }
 */
export function resolveDeliveryAddress(order, fulfillmentTask = null) {
  const result = {
    line1: '',
    line2: '',
    city: '',
    state: '',
    zip: '',
    country: 'US',
    formatted: '',
    isComplete: false,
    source: null,
  };

  function checkComplete(line1, city, state) {
    return !!(line1 && line1.trim() && city && city.trim() && state && state.trim());
  }

  function formatAddr(line1, line2, city, state, zip) {
    return [line1, line2, city, state, zip].filter(Boolean).join(', ');
  }

  // 1. Order structured address fields
  if (checkComplete(order?.address_line1, order?.address_city, order?.address_state)) {
    result.line1 = order.address_line1;
    result.line2 = order.address_line2 || '';
    result.city = order.address_city;
    result.state = order.address_state;
    result.zip = order.address_postal_code || '';
    result.country = order.address_country || 'US';
    result.formatted = formatAddr(result.line1, result.line2, result.city, result.state, result.zip);
    result.isComplete = true;
    result.source = 'order_structured';
    return result;
  }

  // 2. Order fulfillments[0] structured address
  const f0 = order?.fulfillments?.[0];
  if (f0 && checkComplete(f0.address_line1, f0.address_city, f0.address_state)) {
    result.line1 = f0.address_line1;
    result.line2 = f0.address_line2 || '';
    result.city = f0.address_city;
    result.state = f0.address_state;
    result.zip = f0.address_postal_code || '';
    result.country = f0.address_country || 'US';
    result.formatted = formatAddr(result.line1, result.line2, result.city, result.state, result.zip);
    result.isComplete = true;
    result.source = 'order_fulfillment';
    return result;
  }

  // 3. FulfillmentTask structured address fields
  if (fulfillmentTask && checkComplete(fulfillmentTask.address_line1, fulfillmentTask.address_city, fulfillmentTask.address_state)) {
    result.line1 = fulfillmentTask.address_line1;
    result.line2 = fulfillmentTask.address_line2 || '';
    result.city = fulfillmentTask.address_city;
    result.state = fulfillmentTask.address_state;
    result.zip = fulfillmentTask.address_postal_code || '';
    result.country = 'US';
    result.formatted = formatAddr(result.line1, result.line2, result.city, result.state, result.zip);
    result.isComplete = true;
    result.source = 'fulfillment_task_structured';
    return result;
  }

  // 4. Order delivery_address string fallback
  if (order?.delivery_address && order.delivery_address.trim().length > 5) {
    result.formatted = order.delivery_address;
    result.isComplete = true; // treat non-empty string as complete
    result.source = 'order_delivery_address_string';
    return result;
  }

  // 5. FulfillmentTask delivery_address / address string fallback
  const ftAddr = fulfillmentTask?.delivery_address || fulfillmentTask?.address;
  if (ftAddr && ftAddr.trim().length > 5) {
    result.formatted = ftAddr;
    result.isComplete = true;
    result.source = 'fulfillment_task_string';
    return result;
  }

  return result; // isComplete = false — truly no address found
}