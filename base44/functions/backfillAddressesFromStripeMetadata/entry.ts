import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_API_KEY'));

/**
 * backfillAddressesFromStripeMetadata
 * 
 * For all delivery orders missing a complete address that have a stripe_checkout_session_id:
 * - Fetches the Stripe session
 * - Reads address from session.metadata (delivery_address_line1, delivery_city, etc.)
 * - Also reads from session.shipping_details and session.customer_details as fallbacks
 * - Writes found addresses directly into the Hub order record
 * 
 * Root cause discovered: NuVira Customer App stores delivery address in Stripe session
 * metadata keys, NOT in Stripe's shipping_address_collection. The webhook handler was
 * only reading shipping_details (null) and missed the metadata entirely.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });

    const { dry_run = false } = await req.json().catch(() => ({}));

    // Get all delivery orders with missing addresses that have a Stripe session ID
    const allOrders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 500);

    const candidates = allOrders.filter(o =>
      o.fulfillment_method === 'delivery' &&
      !['fulfilled', 'canceled', 'refunded'].includes(o.production_status) &&
      (!o.address_line1 || !o.address_city || !o.address_state || !o.address_postal_code) &&
      o.stripe_checkout_session_id &&
      o.stripe_checkout_session_id.startsWith('cs_')
    );

    console.log(`[BACKFILL-ADDR] Found ${candidates.length} delivery orders missing address with a valid Stripe session ID`);

    const results = { repaired: [], not_found: [], errors: [], dry_run };

    for (const order of candidates) {
      try {
        const session = await stripe.checkout.sessions.retrieve(order.stripe_checkout_session_id);
        const meta = session.metadata || {};

        // Try metadata first (customer app stores address here)
        let addr = null;
        if (meta.delivery_address_line1 || meta.address_line1) {
          addr = {
            address_line1: meta.delivery_address_line1 || meta.address_line1 || '',
            address_line2: meta.delivery_address_line2 || meta.address_line2 || '',
            address_city: meta.delivery_city || meta.address_city || '',
            address_state: meta.delivery_state || meta.address_state || '',
            address_postal_code: meta.delivery_postal_code || meta.address_postal_code || '',
            address_country: meta.delivery_country || meta.address_country || 'US',
          };
        }

        // Fallback: shipping_details
        if (!addr?.address_line1 && session.shipping_details?.address?.line1) {
          const s = session.shipping_details.address;
          addr = {
            address_line1: s.line1 || '',
            address_line2: s.line2 || '',
            address_city: s.city || '',
            address_state: s.state || '',
            address_postal_code: s.postal_code || '',
            address_country: s.country || 'US',
          };
        }

        // Fallback: customer_details.address
        if (!addr?.address_line1 && session.customer_details?.address?.line1) {
          const s = session.customer_details.address;
          addr = {
            address_line1: s.line1 || '',
            address_line2: s.line2 || '',
            address_city: s.city || '',
            address_state: s.state || '',
            address_postal_code: s.postal_code || '',
            address_country: s.country || 'US',
          };
        }

        if (addr?.address_line1 && addr?.address_city && addr?.address_state && addr?.address_postal_code) {
          if (!dry_run) {
            await base44.asServiceRole.entities.ShopifyOrder.update(order.id, {
              ...addr,
              address_last_synced_from: 'stripe_metadata_backfill',
              address_last_synced_at: new Date().toISOString(),
              // Also grab requested_delivery_date and phone from metadata if missing
              ...((!order.requested_delivery_date && meta.requested_delivery_date) ? { requested_delivery_date: meta.requested_delivery_date } : {}),
              ...((!order.customer_phone && meta.customer_phone) ? { customer_phone: meta.customer_phone } : {}),
            });
          }

          results.repaired.push({
            order_id: order.id,
            order_number: order.shopify_order_number,
            customer_email: order.customer_email,
            address: `${addr.address_line1}, ${addr.address_city}, ${addr.address_state} ${addr.address_postal_code}`,
            source: addr === session.customer_details?.address ? 'customer_details' : (addr === session.shipping_details?.address ? 'shipping_details' : 'metadata'),
          });
          console.log(`[BACKFILL-ADDR] ${dry_run ? '[DRY RUN] ' : ''}Repaired ${order.shopify_order_number} → ${addr.address_line1}, ${addr.address_city}`);
        } else {
          results.not_found.push({
            order_id: order.id,
            order_number: order.shopify_order_number,
            customer_email: order.customer_email,
            session_id: order.stripe_checkout_session_id,
            meta_keys: Object.keys(meta),
          });
          console.log(`[BACKFILL-ADDR] No address in session for ${order.shopify_order_number}`);
        }
      } catch (err) {
        console.error(`[BACKFILL-ADDR] Error on ${order.shopify_order_number}:`, err.message);
        results.errors.push({ order_number: order.shopify_order_number, error: err.message });
      }
    }

    // Audit log
    if (!dry_run && results.repaired.length > 0) {
      await base44.asServiceRole.entities.RepairAuditLog.create({
        timestamp: new Date().toISOString(),
        executed_by: user.email,
        repair_function: 'repairMissingAddresses',
        action: 'repair',
        records_affected: results.repaired.length,
        reason: 'Backfill delivery addresses from Stripe session metadata (root cause: webhook missed metadata address fields)',
        changes: { repaired: results.repaired.length, not_found: results.not_found.length, errors: results.errors.length },
        details: results,
      });
    }

    return Response.json({
      success: true,
      dry_run,
      summary: {
        candidates: candidates.length,
        repaired: results.repaired.length,
        not_found_in_stripe: results.not_found.length,
        errors: results.errors.length,
      },
      repaired: results.repaired,
      not_found: results.not_found,
      errors: results.errors,
    });

  } catch (error) {
    console.error('[BACKFILL-ADDR] Fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});