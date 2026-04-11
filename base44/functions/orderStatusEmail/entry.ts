import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json();

    const order = payload.data;
    if (!order || !order.customer_email) {
      return Response.json({ message: 'No customer email, skipping', sent: false });
    }

    const statusMessages = {
      Confirmed: { emoji: '✅', headline: 'Your order has been confirmed!', color: '#059669', detail: 'We\'ve received your order and are getting it ready.' },
      'Scheduled for Production': { emoji: '🏭', headline: 'Your order is scheduled for production!', color: '#2563eb', detail: 'Your fresh juices are being scheduled for production.' },
      'In Production': { emoji: '⚡', headline: 'Your order is being produced!', color: '#7c3aed', detail: 'We\'re juicing your order fresh right now.' },
      Completed: { emoji: '🎉', headline: 'Your order is ready!', color: '#059669', detail: 'Your order has been completed and is ready for pickup/delivery.' },
      Cancelled: { emoji: '❌', headline: 'Your order has been cancelled', color: '#dc2626', detail: 'Your order has been cancelled. Please contact us if you have any questions.' },
    };

    const info = statusMessages[order.status];
    if (!info) return Response.json({ message: `No email template for status: ${order.status}`, sent: false });

    const itemRows = (order.items || []).map(item =>
      `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee">${item.product_name}</td><td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center">${item.quantity}</td><td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right">$${(item.price || 0).toFixed(2)}</td></tr>`
    ).join('');

    const body = `<div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#1a4731;padding:24px;border-radius:12px 12px 0 0">
        <h1 style="color:#fff;font-size:22px;margin:0;font-weight:700">nuVira Juice Co.</h1>
        <p style="color:rgba(255,255,255,0.6);margin:4px 0 0;font-size:13px">Fresh. Cold-Pressed. Delivered.</p>
      </div>
      <div style="background:#fff;padding:32px;border-radius:0 0 12px 12px;border:1px solid #eee;border-top:none">
        <div style="text-align:center;margin-bottom:24px">
          <span style="font-size:40px">${info.emoji}</span>
          <h2 style="color:${info.color};margin:12px 0 8px;font-size:20px">${info.headline}</h2>
          <p style="color:#6b7280;margin:0;font-size:14px">${info.detail}</p>
        </div>
        <div style="background:#f9fafb;border-radius:8px;padding:16px;margin-bottom:20px">
          <p style="margin:0 0 4px;font-size:13px;color:#6b7280;text-transform:uppercase;font-weight:600;letter-spacing:0.05em">Order Details</p>
          <p style="margin:4px 0;font-size:14px"><strong>Order ID:</strong> ${order.order_id}</p>
          <p style="margin:4px 0;font-size:14px"><strong>Status:</strong> <span style="color:${info.color};font-weight:600">${order.status}</span></p>
          ${order.fulfillment_type ? `<p style="margin:4px 0;font-size:14px"><strong>Fulfillment:</strong> ${order.fulfillment_type}</p>` : ''}
          ${order.fulfillment_window ? `<p style="margin:4px 0;font-size:14px"><strong>Time Window:</strong> ${order.fulfillment_window}</p>` : ''}
        </div>
        ${itemRows ? `<table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:16px">
          <thead><tr style="background:#f9fafb"><th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase">Product</th><th style="padding:8px 12px;text-align:center;font-size:12px;color:#6b7280;text-transform:uppercase">Qty</th><th style="padding:8px 12px;text-align:right;font-size:12px;color:#6b7280;text-transform:uppercase">Price</th></tr></thead>
          <tbody>${itemRows}</tbody>
          <tfoot><tr><td colspan="2" style="padding:12px;text-align:right;font-weight:600">Total</td><td style="padding:12px;text-align:right;font-weight:700;font-size:16px;color:#1a4731">$${(order.total || 0).toFixed(2)}</td></tr></tfoot>
        </table>` : ''}
        <p style="font-size:12px;color:#9ca3af;margin:20px 0 0;text-align:center">Questions? Reply to this email or contact us through Instagram.</p>
      </div>
    </div>`;

    await base44.asServiceRole.integrations.Core.SendEmail({
      to: order.customer_email,
      from_name: 'nuVira Juice Co.',
      subject: `${info.emoji} Order ${order.order_id} — ${order.status}`,
      body,
    });

    return Response.json({ message: 'Order status email sent', order_id: order.order_id, status: order.status });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});