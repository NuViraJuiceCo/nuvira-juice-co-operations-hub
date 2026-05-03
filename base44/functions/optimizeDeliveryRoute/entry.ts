import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CUSTOMER_APP_API = Deno.env.get('CUSTOMER_APP_API_URL');
const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const DEPOT = "619 N Main St Unit 3, O'Fallon, MO 63366";

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { date, optimize } = await req.json();

    // Load ALL orders from local ShopifyOrder database (not from customer app)
    const allOrders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 500);
    
    // Filter to orders for the selected date if provided
    let orders = allOrders;
    if (date) {
      orders = allOrders.filter(o => {
        const fulfillmentMode = o.fulfillment_mode || (o.fulfillments?.length > 0 ? 'multi_delivery' : 'single_delivery');
        
        // For multi-delivery orders: check if any fulfillment matches the date
        if (fulfillmentMode === 'multi_delivery' && o.fulfillments && o.fulfillments.length > 0) {
          return o.fulfillments.some(f => f.delivery_date && f.delivery_date === date);
        }

        // For single-delivery orders: only show if explicitly assigned to this date
        if (o.assigned_delivery_date && o.assigned_delivery_date === date) {
          return true;
        }
        if (o.requested_delivery_date && o.requested_delivery_date === date) {
          return true;
        }

        return false;
      });
    }

    // Optionally sync bag returns from customer app if configured
    if (CUSTOMER_APP_API && SYNC_SECRET) {
      try {
        const returnsRes = await fetch(`${CUSTOMER_APP_API}/functions/getBagReturnsForSync`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${SYNC_SECRET}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ includeCompleted: true }),
        });
        
        if (returnsRes.ok) {
          const returnsData = await returnsRes.json();
          const bagReturns = returnsData.returns || [];
          console.log(`[OPTIMIZE-ROUTE] Syncing ${bagReturns.length} bag returns from customer app`);
          
          for (const ret of bagReturns) {
            try {
              const existing = await base44.asServiceRole.entities.BagReturn.filter({
                customer_email: ret.customer_email,
                order_id: ret.order_id,
              });
              if (!existing || existing.length === 0) {
                await base44.asServiceRole.entities.BagReturn.create(ret);
              } else {
                await base44.asServiceRole.entities.BagReturn.update(existing[0].id, ret);
              }
            } catch (err) {
              console.error(`[OPTIMIZE-ROUTE] Failed to sync bag return for ${ret.customer_email}:`, err);
            }
          }
        }
      } catch (err) {
        console.error(`[OPTIMIZE-ROUTE] Bag returns sync failed (non-critical):`, err);
      }
    }

    if (!Array.isArray(orders) || orders.length === 0) {
      return Response.json({ status: 'success', orders: [], optimized_orders: [] });
    }

    const hasCompleteAddressAtParent = (order) => {
      return order.address_line1 && order.address_city && order.address_state && order.address_postal_code;
    };

    const hasCompleteAddressAtFulfillment = (fulfillment) => {
      return fulfillment && fulfillment.address_line1 && fulfillment.address_city && fulfillment.address_state && fulfillment.address_postal_code;
    };

    // Map ShopifyOrder to driver portal format — INCLUDE ALL orders, flag missing addresses
    // HARD GATE: Strict delivery eligibility — all conditions must be met.
    // payment_status = paid + delivery-ready production_status only.
    // "bottled", "labeled", "qc_checked" are NOT delivery-ready — product exists but not dispatch-approved.
    // Only packed/in_cold_storage/assigned_for_delivery are considered dispatch-ready.
    const DELIVERY_READY_STATUSES = ['packed', 'in_cold_storage', 'assigned_for_pickup', 'assigned_for_delivery'];
    const queuedOrders = orders
      .filter(o => o.payment_status === 'paid')
      .filter(o => DELIVERY_READY_STATUSES.includes(o.production_status) || o.production_status === 'fulfilled')
      .filter(o => o.production_status !== 'fulfilled')
      .map(o => {
        const fulfillmentMode = o.fulfillment_mode || (o.fulfillments?.length > 0 ? 'multi_delivery' : 'single_delivery');
        let fulfillmentsForDate = o.fulfillments || [];
        
        // For multi-delivery orders on a specific date, only show the fulfillment for that date
        if (date && fulfillmentMode === 'multi_delivery' && o.fulfillments && o.fulfillments.length > 0) {
          fulfillmentsForDate = o.fulfillments.filter(f => f.delivery_date && f.delivery_date.startsWith(date));
        }

        // Determine best available address (parent → fulfillment → legacy)
        const fulfillmentAddr = fulfillmentsForDate[0] || o.fulfillments?.[0];
        const hasParentAddr = hasCompleteAddressAtParent(o);
        const hasFulfillmentAddr = hasCompleteAddressAtFulfillment(fulfillmentAddr);
        const missing_address = o.fulfillment_method === 'delivery' && !hasParentAddr && !hasFulfillmentAddr;

        if (missing_address) {
          console.warn(`[OPTIMIZE-ROUTE] Order ${o.shopify_order_number} (${o.customer_name}) is missing a delivery address — included with flag`);
        }

        return {
          id: o.id,
          order_number: o.shopify_order_number,
          customer_email: o.customer_email,
          customer_name: o.customer_name,
          contact_phone: o.customer_phone,
          delivery_address: o.delivery_address,
          address_line1: o.address_line1,
          address_line2: o.address_line2,
          address_city: o.address_city,
          address_state: o.address_state,
          address_postal_code: o.address_postal_code,
          address_country: o.address_country,
          items: o.line_items || [],
          fulfillments: fulfillmentsForDate,
          status: o.production_status === 'fulfilled' ? 'delivered' : o.production_status,
          delivery_photo_url: o.delivery_photo_url,
          delivery_drop_location: o.delivery_drop_location,
          delivered_by: o.delivered_by,
          delivered_at: o.delivered_at,
          leg_duration_seconds: null,
          missing_address,
          payment_status: o.payment_status,
        };
      });

    if (!optimize) {
      return Response.json({ 
        status: 'success', 
        orders: queuedOrders,
        optimized_orders: null,
        total_distance_miles: null,
        total_duration_minutes: null,
      });
    }



    // Filter to undelivered stops with addresses for optimization (missing-address orders can't be routed)
    const undeliveredStops = queuedOrders.filter(o => o.status !== 'delivered' && !o.missing_address);
    
    if (undeliveredStops.length === 0) {
      return Response.json({ 
        status: 'success', 
        orders: queuedOrders,
        optimized_orders: queuedOrders,
        route_stats: {
          original_duration_minutes: 0,
          optimized_duration_minutes: 0,
          total_distance_miles: 0,
          stops_count: 0,
          time_saved_minutes: 0,
        },
      });
    }

    // Get depot coordinates (fixed origin)
    const depotCoords = { latitude: 38.6849, longitude: -90.6639 }; // O'Fallon, MO coordinates
    
    // Build waypoints for Google Routes API
    const waypoints = undeliveredStops.map(stop => {
      // Use structured address fields if available
      let address = stop.delivery_address;
      if (stop.address_line1) {
        address = `${stop.address_line1}${stop.address_line2 ? ' ' + stop.address_line2 : ''}, ${stop.address_city}, ${stop.address_state} ${stop.address_postal_code}`;
      }
      return {
        location: {
          address,
        },
      };
    });

    // Call Google Routes Optimization API
    let optimizedRoute = null;
    const googleApiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
    
    if (googleApiKey && waypoints.length > 0) {
      try {
        const routeResp = await fetch('https://routeoptimization.googleapis.com/v1/projects/-/locations/us:optimizeTours', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': googleApiKey,
          },
          body: JSON.stringify({
            parent: 'projects/-/locations/us',
            routeObjectives: ['ROUTE_MINIMIZE_DRIVING_TIME'],
            vehicles: [
              {
                displayName: 'Driver Vehicle',
                startLocation: {
                  latitude: depotCoords.latitude,
                  longitude: depotCoords.longitude,
                },
                endLocation: {
                  latitude: depotCoords.latitude,
                  longitude: depotCoords.longitude,
                },
              },
            ],
            locations: waypoints.map((wp, idx) => ({
              displayName: undeliveredStops[idx].customer_name || undeliveredStops[idx].customer_email,
              address: wp.location.address,
            })),
            model: 'COST_MINIMIZATION',
          }),
        });

        if (routeResp.ok) {
          const routeData = await routeResp.json();
          if (routeData.routes && routeData.routes.length > 0) {
            const visits = routeData.routes[0].visits || [];
            const optimizedIndices = visits.map(v => v.shipmentIndex);
            optimizedRoute = optimizedIndices.map(idx => undeliveredStops[idx]);
            
            // Extract stats
            const route = routeData.routes[0];
            const optimizedMetrics = {
              distance_meters: route.metrics?.totalDistance || 0,
              duration_seconds: route.metrics?.totalDuration || 0,
              stops: visits.length,
            };
            
            // Calculate original route duration (simple heuristic: 10 min per stop + 2 min per mile)
            const avgDistPerStop = (optimizedMetrics.distance_meters / 1609.34) / (optimizedMetrics.stops || 1);
            const originalEstimate = (optimizedMetrics.stops * 10) + (avgDistPerStop * optimizedMetrics.stops * 2);
            const timeSaved = Math.max(0, Math.round(originalEstimate - (optimizedMetrics.duration_seconds / 60)));

            return Response.json({
              status: 'success',
              orders: queuedOrders,
              optimized_orders: [...queuedOrders.filter(o => o.status === 'delivered'), ...optimizedRoute],
              route_stats: {
                optimized_duration_minutes: Math.round(optimizedMetrics.duration_seconds / 60),
                total_distance_miles: Math.round((optimizedMetrics.distance_meters / 1609.34) * 10) / 10,
                stops_count: optimizedMetrics.stops,
                time_saved_minutes: timeSaved,
                optimization_method: 'google_routes_api',
              },
              return_to_origin: {
                location: DEPOT,
                display_name: 'Return to NuVira Base',
                is_return_stop: true,
              },
            });
          }
        } else {
          console.warn('[OPTIMIZE-ROUTE] Google Routes API failed, falling back to basic sort');
        }
      } catch (err) {
        console.error('[OPTIMIZE-ROUTE] Google Routes integration error:', err.message);
      }
    }

    // Fallback: cluster-based sort (group by zip code proximity)
    const clusteredOrders = [...undeliveredStops].sort((a, b) => {
      const aZip = (a.address_postal_code || a.delivery_address || '').match(/\d{5}/)?.[0] || '';
      const bZip = (b.address_postal_code || b.delivery_address || '').match(/\d{5}/)?.[0] || '';
      const aAddr = (a.address_line1 || a.delivery_address || '');
      const bAddr = (b.address_line1 || b.delivery_address || '');
      return aZip.localeCompare(bZip) || aAddr.localeCompare(bAddr);
    });

    const routeWithReturn = [...queuedOrders.filter(o => o.status === 'delivered'), ...clusteredOrders];

    return Response.json({
      status: 'success',
      orders: queuedOrders,
      optimized_orders: routeWithReturn,
      route_stats: {
        optimized_duration_minutes: Math.round(undeliveredStops.length * 12),
        total_distance_miles: Math.round(undeliveredStops.length * 2.5),
        stops_count: undeliveredStops.length,
        time_saved_minutes: 0,
        optimization_method: 'cluster_sort',
      },
      return_to_origin: {
        location: DEPOT,
        display_name: 'Return to NuVira Base',
        is_return_stop: true,
      },
    });

  } catch (error) {
    console.error('[OPTIMIZE-ROUTE] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});