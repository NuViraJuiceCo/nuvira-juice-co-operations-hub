import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Admin-only test function
    if (user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await req.json();
    const testOrder = body || {
      id: `test_${Date.now()}`,
      order_number: `#TEST${Math.floor(Math.random() * 10000)}`,
      customer_email: 'test@example.com',
      contact_phone: '555-1234',
      items: [{ title: 'Test Product', quantity: 1, price: 29.99 }],
      fulfillment_type: 'delivery',
      delivery_address: '123 Test St',
      estimated_delivery_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      payment_captured: true,
      status: 'ready_for_production',
      subtotal: 29.99,
      total: 29.99,
      notes: 'Test order',
      is_preorder: false,
    };

    const hubPayload = {
      shopify_order_id: `test_${testOrder.id}`,
      shopify_order_number: testOrder.order_number || `#TEST${Math.floor(Math.random() * 10000)}`,
      base44_order_id: testOrder.id,
      source_channel: 'online',
      customer_email: testOrder.customer_email || '',
      customer_phone: testOrder.contact_phone || '',
      line_items: (testOrder.items || []).map(item => ({
        title: item.title || '',
        quantity: item.quantity || 1,
        price: item.price || 0,
      })),
      fulfillment_method: testOrder.fulfillment_type || 'delivery',
      delivery_address: testOrder.delivery_address || '',
      requested_delivery_date: testOrder.estimated_delivery_date || '',
      payment_status: testOrder.payment_captured ? 'paid' : 'pending',
      fulfillment_status: testOrder.status || 'order_received',
      subtotal: testOrder.subtotal || 0,
      total_price: testOrder.total || 0,
      customer_notes: testOrder.notes || '',
      production_status: 'new',
      assigned_delivery_date: testOrder.estimated_delivery_date || '',
      tags: testOrder.is_preorder ? ['preorder', 'test'] : ['test'],
      internal_notes: testOrder.is_preorder ? `Pre-order — fulfillment: ${testOrder.preorder_fulfillment_date || 'TBD'} (TEST)` : 'TEST ORDER',
      sync_status: 'synced',
      last_sync_at: new Date().toISOString(),
    };

    const result = await base44.asServiceRole.entities.ShopifyOrder.create(hubPayload);
    console.log(`[TEST-ORDER] Created test order ${result.id}`);

    return Response.json({
      success: true,
      message: 'Test order created successfully',
      order_id: result.id,
      order_number: hubPayload.shopify_order_number,
    });
  } catch (error) {
    console.error('testOrderReception error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});