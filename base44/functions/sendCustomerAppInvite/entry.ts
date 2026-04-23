import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { customer_email, order_number } = await req.json();

    if (!customer_email) {
      return Response.json({ error: 'Customer email required' }, { status: 400 });
    }

    await base44.integrations.Core.SendEmail({
      to: customer_email,
      subject: `Access Your NuVira Pre-Order — Welcome!`,
      body: `Hi there!\n\nThank you for your NuVira pre-order!\n\n${order_number ? `Order: #${order_number}\n\n` : ''}You can now view and manage your order in the NuVira customer app:\n\n🔗 ${process.env.CUSTOMER_APP_URL || 'https://nuvirajuice.com/'}\n\nYour payment has been authorized and will be captured on May 1st, 2026. Your order will then move into production immediately.\n\nDelivery is scheduled for early June.\n\nWe appreciate your support and can't wait to get your fresh NuVira juices to you!\n\nQuestions? Reach out through the Support section in the app.\n\nThe NuVira Team 🥤`
    });

    return Response.json({ status: 'success', message: 'Customer app invite sent' });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});