import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * awardOrderPoints — awards 10 pts per $ spent on a paid order.
 * Called by entity automation on ShopifyOrder update (payment_status = 'paid').
 * Also callable manually by admin for retroactive awards.
 * Deduplicates: will not award points for the same order_id twice.
 */

const PTS_PER_DOLLAR = 10;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json();

    // Allow entity automation payloads (platform-sent: has event.entity_id + event.entity_name),
    // internal secret calls, or authenticated admin users.
    const internalSecret = Deno.env.get('INTERNAL_FUNCTION_SECRET');
    const isInternalCall = payload._internalSecret && internalSecret && payload._internalSecret === internalSecret;
    const isPlatformAutomation = payload.event?.entity_id && payload.event?.entity_name;
    if (!isInternalCall && !isPlatformAutomation) {
      const user = await base44.auth.me();
      if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
      if (user.role !== 'admin') return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    // Support both automation payload and manual admin call
    const orderData = payload.data || payload.order;
    const orderId = payload.event?.entity_id || payload.order_id;

    // If called from automation, fetch the order
    let order = orderData;
    if (!order && orderId) {
      const orders = await base44.asServiceRole.entities.ShopifyOrder.filter({ shopify_order_id: orderId });
      order = orders?.[0];
    }

    // If still no order, try by Hub record id
    if (!order && orderId) {
      try {
        const allOrders = await base44.asServiceRole.entities.ShopifyOrder.list('', 1);
        // Use the entity_id as the Hub record ID
        order = { id: orderId, ...orderData };
      } catch(_) {}
    }

    if (!order) {
      return Response.json({ error: 'Order not found' }, { status: 400 });
    }

    const email = order.customer_email;
    const orderNumber = order.shopify_order_number;
    const totalPrice = order.total_price || order.subtotal || 0;
    const hubOrderId = order.id || orderId;

    if (!email) {
      return Response.json({ error: 'No customer email on order' }, { status: 400 });
    }

    if (!totalPrice || totalPrice <= 0) {
      return Response.json({ skipped: true, reason: 'Zero total — no points to award' });
    }

    const pointsToAward = Math.floor(totalPrice * PTS_PER_DOLLAR);

    // Find loyalty member
    const members = await base44.asServiceRole.entities.LoyaltyMember.filter({ email });
    if (!members || members.length === 0) {
      return Response.json({ skipped: true, reason: `No loyalty member found for ${email}` });
    }
    const member = members[0];

    // Deduplication: check if points already awarded for this order
    const history = member.points_history || [];
    const alreadyAwarded = history.some(h =>
      h.order_id === hubOrderId || (orderNumber && h.description && h.description.includes(orderNumber))
    );

    if (alreadyAwarded) {
      return Response.json({
        skipped: true,
        reason: `Points already awarded for order ${orderNumber}`,
        current_points: member.total_points,
      });
    }

    // Also check UserPoints for deduplication
    const existingPoints = await base44.asServiceRole.entities.UserPoints.filter({
      customer_email: email,
      order_id: hubOrderId,
    });
    if (existingPoints && existingPoints.length > 0) {
      return Response.json({
        skipped: true,
        reason: `UserPoints entry already exists for order ${orderNumber}`,
        current_points: member.total_points,
      });
    }

    const now = new Date().toISOString();
    const earnedEntry = {
      amount: pointsToAward,
      type: 'earned',
      description: `Purchase points — Order ${orderNumber || hubOrderId} ($${totalPrice.toFixed(2)} × ${PTS_PER_DOLLAR} pts/$)`,
      order_id: hubOrderId,
      timestamp: now,
    };

    const newTotal = (member.total_points || 0) + pointsToAward;
    const newLifetime = (member.lifetime_points || 0) + pointsToAward;

    // Update LoyaltyMember (source of truth)
    await base44.asServiceRole.entities.LoyaltyMember.update(member.id, {
      total_points: newTotal,
      lifetime_points: newLifetime,
      points_history: [...history, earnedEntry],
    });

    // Log to UserPoints for audit trail
    await base44.asServiceRole.entities.UserPoints.create({
      customer_email: email,
      amount: pointsToAward,
      type: 'earned',
      description: earnedEntry.description,
      order_id: hubOrderId,
      sync_status: 'pending',
    });

    console.log(`[AWARD-POINTS] ${email}: +${pointsToAward} pts for order ${orderNumber} ($${totalPrice} × ${PTS_PER_DOLLAR}) → new total: ${newTotal}`);

    return Response.json({
      status: 'success',
      customer_email: email,
      order_number: orderNumber,
      points_awarded: pointsToAward,
      new_total: newTotal,
      order_total: totalPrice,
    });

  } catch (error) {
    console.error('[AWARD-POINTS] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});