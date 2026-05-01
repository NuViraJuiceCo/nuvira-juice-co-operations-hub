import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_API_KEY'), { apiVersion: '2023-10-16' });

/**
 * Creates test subscriptions with complete Stripe metadata
 * Simulates what Customer App would write to Stripe during checkout
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    const results = { created: [], failed: [] };

    // Test data for Monthly Ritual subscription
    const monthlyRitualTest = {
      email: 'test.monthly.ritual@example.com',
      name: 'Test Monthly Ritual',
      phone: '+1-555-0101',
      address_line1: '123 Test Street',
      address_city: 'Chicago',
      address_state: 'IL',
      address_postal_code: '60601',
      plan: 'monthly_ritual',
      weekly_items: '1x Oasis, 1x Aura, 1x Re-Nu',
      weekly_count: 4,
      monthly_price: 144,
    };

    // Test data for VIP Wellness subscription
    const vipWellnessTest = {
      email: 'test.vip.wellness@example.com',
      name: 'Test VIP Wellness',
      phone: '+1-555-0102',
      address_line1: '456 VIP Avenue',
      address_city: 'Chicago',
      address_state: 'IL',
      address_postal_code: '60602',
      plan: 'vip_wellness',
      weekly_items: '2x Oasis, 2x Aura, 2x Re-Nu',
      weekly_count: 4,
      monthly_price: 288,
    };

    // Test data for one-time orders
    const oneTimeProfileAddressTest = {
      email: 'test.onetime.profile@example.com',
      name: 'Test One-Time Profile Address',
      phone: '+1-555-0103',
      address_line1: '789 Profile Lane',
      address_city: 'Chicago',
      address_state: 'IL',
      address_postal_code: '60603',
      items: '3x Aura',
      total_price: 39,
      order_type: 'one_time',
    };

    const oneTimeCheckoutAddressTest = {
      email: 'test.onetime.checkout@example.com',
      name: 'Test One-Time Checkout Address',
      phone: '+1-555-0104',
      address_line1: '999 Checkout Drive',
      address_city: 'Chicago',
      address_state: 'IL',
      address_postal_code: '60604',
      items: '2x Oasis, 1x Re-Nu',
      total_price: 52,
      order_type: 'one_time',
    };

    const testCases = [
      { type: 'subscription', data: monthlyRitualTest },
      { type: 'subscription', data: vipWellnessTest },
      { type: 'one_time', data: oneTimeProfileAddressTest },
      { type: 'one_time', data: oneTimeCheckoutAddressTest },
    ];

    for (const testCase of testCases) {
      try {
        // Create or update Stripe customer with metadata
        let customer;
        const customers = await stripe.customers.list({ email: testCase.data.email, limit: 1 });
        
        if (customers.data.length > 0) {
          customer = customers.data[0];
          // Update metadata
          await stripe.customers.update(customer.id, {
            metadata: {
              full_name: testCase.data.name,
              phone: testCase.data.phone,
              address_line1: testCase.data.address_line1,
              address_city: testCase.data.address_city,
              address_state: testCase.data.address_state,
              address_postal_code: testCase.data.address_postal_code,
            },
          });
        } else {
          // Create new customer with metadata
          customer = await stripe.customers.create({
            email: testCase.data.email,
            name: testCase.data.name,
            phone: testCase.data.phone,
            metadata: {
              full_name: testCase.data.name,
              phone: testCase.data.phone,
              address_line1: testCase.data.address_line1,
              address_city: testCase.data.address_city,
              address_state: testCase.data.address_state,
              address_postal_code: testCase.data.address_postal_code,
            },
          });
        }

        if (testCase.type === 'subscription') {
          // Create product if not exists
          const products = await stripe.products.list({ limit: 100 });
          let product = products.data.find(p => p.name === testCase.data.plan);
          
          if (!product) {
            product = await stripe.products.create({
              name: testCase.data.plan,
              type: 'service',
            });
          }

          // Create price
          const price = await stripe.prices.create({
            currency: 'usd',
            unit_amount: testCase.data.monthly_price * 100,
            recurring: { interval: 'month' },
            product: product.id,
          });

          // Create subscription with metadata
          const subscription = await stripe.subscriptions.create({
            customer: customer.id,
            items: [{ price: price.id }],
            payment_behavior: 'default_incomplete',
            metadata: {
              subscription_plan: testCase.data.plan,
              fulfillment_mode: 'multi_delivery',
              weekly_delivery_count: testCase.data.weekly_count.toString(),
              weekly_items_summary: testCase.data.weekly_items,
              customer_name: testCase.data.name,
              delivery_address: `${testCase.data.address_line1}, ${testCase.data.address_city}, ${testCase.data.address_state} ${testCase.data.address_postal_code}`,
            },
          });

          results.created.push({
            type: 'subscription',
            plan: testCase.data.plan,
            subscription_id: subscription.id,
            customer_id: customer.id,
            email: testCase.data.email,
            metadata_populated: true,
          });

          console.log(`[TEST-META] Created ${testCase.data.plan} subscription ${subscription.id} with metadata`);
        } else {
          // For one-time orders, create a checkout session with metadata
          const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            customer: customer.id,
            mode: 'payment',
            success_url: 'https://example.com/success',
            cancel_url: 'https://example.com/cancel',
            metadata: {
              customer_name: testCase.data.name,
              customer_phone: testCase.data.phone,
              address_line1: testCase.data.address_line1,
              address_city: testCase.data.address_city,
              address_state: testCase.data.address_state,
              address_postal_code: testCase.data.address_postal_code,
              order_type: testCase.data.order_type,
              fulfillment_mode: 'single_delivery',
              items_summary: testCase.data.items,
              order_intent_id: `test_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            },
            line_items: [
              {
                price_data: {
                  currency: 'usd',
                  unit_amount: testCase.data.total_price * 100,
                  product_data: {
                    name: testCase.data.items,
                  },
                },
                quantity: 1,
              },
            ],
          });

          results.created.push({
            type: 'one_time',
            checkout_session_id: session.id,
            customer_id: customer.id,
            email: testCase.data.email,
            metadata_populated: true,
            payment_intent_id: session.payment_intent,
          });

          console.log(`[TEST-META] Created one-time checkout session ${session.id} with metadata`);
        }
      } catch (err) {
        console.error(`[TEST-META] Failed to create ${testCase.type} for ${testCase.data.email}: ${err.message}`);
        results.failed.push({
          type: testCase.type,
          email: testCase.data.email,
          reason: err.message,
        });
      }
    }

    return Response.json({
      success: true,
      message: `Created ${results.created.length} test objects with metadata, ${results.failed.length} failed`,
      results,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});