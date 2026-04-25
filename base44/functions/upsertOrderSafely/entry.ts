import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * OrderValidator class inlined to avoid import issues
 */
class OrderValidator {
  constructor(base44) {
    this.base44 = base44;
  }

  checkCompleteness(payload) {
    return {
      has_customer_name: !!(payload.customer_name && payload.customer_name.trim()),
      has_email: !!(payload.customer_email && payload.customer_email.trim()),
      has_line_items: !!(payload.line_items && payload.line_items.length > 0),
      has_total: !!(payload.total_price && payload.total_price > 0),
      has_address: !!(payload.address_line1 && payload.address_line1.trim()),
      has_stripe_subscription_id: !!(payload.stripe_subscription_id),
      total_price: payload.total_price || 0,
      line_items_count: payload.line_items?.length || 0,
    };
  }

  getCompletenessScore(completeness) {
    let score = 0;
    if (completeness.has_customer_name) score++;
    if (completeness.has_email) score++;
    if (completeness.has_line_items) score++;
    if (completeness.has_total) score++;
    if (completeness.has_address) score++;
    if (completeness.has_stripe_subscription_id) score++;
    score += Math.min(completeness.line_items_count, 2);
    return Math.min(score, 10);
  }

  isUnknownQuality(payload) {
    return (
      payload.shopify_order_number === '#unknown' ||
      payload.shopify_order_number === '#UNKNOWN' ||
      (payload.shopify_order_id && payload.shopify_order_id.includes('unknown')) ||
      (!payload.customer_email && !payload.stripe_subscription_id) ||
      (payload.total_price === 0 && (!payload.line_items || payload.line_items.length === 0))
    );
  }

  wouldDowngradeSubscription(existingOrder, incomingPayload) {
    return (
      existingOrder.source_channel === 'subscription' &&
      incomingPayload.source_channel !== 'subscription' &&
      incomingPayload.source_channel !== undefined
    );
  }

  isStaleUpdate(existingOrder, incomingPayload, incomingSource) {
    if (!['stripe_webhook', 'manual_recovery'].includes(incomingSource)) {
      return false;
    }
    const existingTime = new Date(existingOrder.updated_date || existingOrder.created_date).getTime();
    const incomingTime = new Date(incomingPayload.customer_order_date || incomingPayload.created_date || Date.now()).getTime();
    return incomingTime < (existingTime - 60000);
  }

  mergeOnlySafeFields(existingOrder, incomingPayload) {
    const merged = { ...existingOrder };
    const safeFields = [
      'customer_phone', 'internal_notes', 'customer_notes',
      'requested_delivery_date', 'assigned_delivery_date',
      'fulfillment_method', 'tags',
    ];
    const fieldsUpdated = [];
    for (const field of safeFields) {
      if (incomingPayload[field] && !merged[field]) {
        merged[field] = incomingPayload[field];
        fieldsUpdated.push(field);
      }
    }
    if (incomingPayload.address_line1 && !merged.address_line1) {
      merged.address_line1 = incomingPayload.address_line1;
      merged.address_line2 = incomingPayload.address_line2;
      merged.address_city = incomingPayload.address_city;
      merged.address_state = incomingPayload.address_state;
      merged.address_postal_code = incomingPayload.address_postal_code;
      merged.address_country = incomingPayload.address_country;
      fieldsUpdated.push('address');
    }
    return { merged, fieldsUpdated };
  }

  async logSync(base44, params) {
    try {
      await base44.asServiceRole.entities.OrderSyncLog.create({
        sync_timestamp: new Date().toISOString(),
        sync_source: params.source,
        event_type: params.event_type,
        stripe_event_id: params.stripe_event_id || null,
        order_id: params.order_id || null,
        order_number: params.order_number || null,
        customer_email: params.customer_email || null,
        action: params.action,
        reason: params.reason || null,
        fields_updated: params.fields_updated || [],
        incoming_data_completeness: params.completeness || null,
        success: params.success !== false,
        error: params.error || null,
      });
    } catch (err) {
      console.error('[VALIDATOR] Failed to log sync:', err.message);
    }
  }

  async quarantineOrder(base44, params) {
    try {
      await base44.asServiceRole.entities.OrderReviewQueue.create({
        incident_type: params.incident_type,
        customer_email: params.customer_email || null,
        customer_name: params.customer_name || null,
        existing_order_id: params.existing_order_id || null,
        existing_order_number: params.existing_order_number || null,
        existing_order_type: params.existing_order_type || null,
        incoming_payload: params.incoming_payload || {},
        incoming_source: params.incoming_source,
        issue_description: params.issue_description,
        recommended_action: params.recommended_action || 'manual_review',
        status: 'pending',
      });
    } catch (err) {
      console.error('[VALIDATOR] Failed to quarantine:', err.message);
    }
  }
}

/**
 * CENTRALIZED ORDER WRITE GATEWAY
 * 
 * ALL order creates/updates must go through this function.
 * No direct .create()/.update() to ShopifyOrder entity outside this.
 * 
 * Enforces:
 * - Idempotency
 * - Source authority (which fields can this source write?)
 * - Data completeness scoring
 * - Subscription protection (hard lock)
 * - Stale update rejection
 * - Unknown quality quarantine
 * - Field ownership validation
 * - Comprehensive logging
 */

const FIELD_OWNERSHIP = {
  stripe: [
    'payment_status', 'stripe_customer_id', 'stripe_subscription_id',
    'stripe_invoice_id', 'stripe_checkout_session_id', 'stripe_payment_intent_id',
    'stripe_charge_id', 'stripe_created_event_type'
  ],
  customer_app: [
    'customer_name', 'customer_email', 'customer_phone',
    'address_line1', 'address_line2', 'address_city', 'address_state',
    'address_postal_code', 'address_country', 'customer_notes',
    'requested_delivery_date', 'delivery_notes'
  ],
  operations: [
    'production_status', 'fulfillment_status', 'delivery_status',
    'assigned_delivery_date', 'assigned_delivery_window', 'fulfillments',
    'internal_notes', 'production_batch_id'
  ],
  any_source: [
    'tags', 'customer_order_date', 'sync_status', 'repair_status'
  ]
};

const SOURCE_AUTHORITY = {
  stripe_webhook: ['stripe', 'any_source'],
  customer_app_sync: ['customer_app', 'any_source'],
  manual_recovery: ['stripe', 'customer_app', 'any_source'],
  admin_edit: ['stripe', 'customer_app', 'operations', 'any_source'],
  operations_status: ['operations', 'any_source'],
  decomposition: ['operations', 'any_source'],
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();

    const {
      orderId,                    // If updating
      incomingData,              // New/updated fields
      source,                    // stripe_webhook | customer_app_sync | manual_recovery | admin_edit | operations_status | decomposition
      stripeEventId,             // For idempotency
      userEmail,                 // For admin_edit
      requireCompleteData = false, // Force completeness check
    } = body;

    if (!incomingData || !source) {
      return Response.json({ error: 'incomingData and source required' }, { status: 400 });
    }

    if (!SOURCE_AUTHORITY[source]) {
      return Response.json({ error: `Invalid source: ${source}` }, { status: 400 });
    }

    const validator = new OrderValidator(base44);
    const result = {
      action: orderId ? 'updated' : 'created',
      orderId: orderId || null,
      source,
      success: false,
      rejections: [],
      validations: [],
      logs: [],
    };

    // ──────────────────────────────────────────────────────────────
    // STEP 1: IDEMPOTENCY CHECK (if update + stripeEventId)
    // ──────────────────────────────────────────────────────────────
    if (orderId && stripeEventId) {
      const existingLogs = await base44.asServiceRole.entities.OrderSyncLog.filter({
        stripe_event_id: stripeEventId,
        order_id: orderId,
      });

      if (existingLogs && existingLogs.length > 0 && existingLogs[0].success) {
        result.logs.push('Duplicate event detected, skipping');
        return Response.json({
          status: 'skipped',
          reason: 'duplicate_stripe_event',
          result,
        });
      }
    }

    // ──────────────────────────────────────────────────────────────
    // STEP 2: FETCH EXISTING ORDER (if updating)
    // ──────────────────────────────────────────────────────────────
    let existingOrder = null;
    if (orderId) {
      try {
        const orders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 1000);
        existingOrder = orders.find(o => o.id === orderId);
        
        if (!existingOrder) {
          result.rejections.push('order_not_found');
          return Response.json({
            status: 'rejected',
            reason: 'order_not_found',
            result,
          }, { status: 404 });
        }
      } catch (err) {
        result.rejections.push(`fetch_failed: ${err.message}`);
        return Response.json({
          status: 'error',
          error: err.message,
          result,
        }, { status: 500 });
      }
    }

    // ──────────────────────────────────────────────────────────────
    // STEP 3: FIELD OWNERSHIP VALIDATION
    // ──────────────────────────────────────────────────────────────
    const allowedFieldCategories = SOURCE_AUTHORITY[source];
    const allowedFields = allowedFieldCategories
      .flatMap(cat => FIELD_OWNERSHIP[cat])
      .concat(['line_items', 'total_price', 'subtotal']); // Hybrid fields

    for (const field of Object.keys(incomingData)) {
      if (!allowedFields.includes(field)) {
        result.rejections.push(`field_not_authorized: ${field} by ${source}`);
      }
    }

    if (result.rejections.length > 0) {
      result.logs.push(`Source ${source} tried to write unauthorized fields`);
      return Response.json({
        status: 'rejected',
        reason: 'unauthorized_fields',
        result,
      }, { status: 403 });
    }

    // ──────────────────────────────────────────────────────────────
    // STEP 4: SUBSCRIPTION HARD LOCK
    // ──────────────────────────────────────────────────────────────
    if (existingOrder && (existingOrder.source_channel === 'subscription' || existingOrder.stripe_subscription_id)) {
      // Rule 1: Never downgrade to one_time
      if (incomingData.source_channel === 'one_time') {
        result.rejections.push('subscription_downgrade_attempt');
        result.logs.push('BLOCKED: Attempt to downgrade subscription to one-time');
        
        await validator.quarantineOrder(base44, {
          incident_type: 'subscription_downgrade_attempt',
          customer_email: existingOrder.customer_email,
          customer_name: existingOrder.customer_name,
          existing_order_id: orderId,
          existing_order_number: existingOrder.shopify_order_number,
          existing_order_type: 'subscription',
          incoming_payload: incomingData,
          incoming_source: source,
          issue_description: `Attempted to downgrade subscription order to one-time via ${source}`,
          recommended_action: 'reject',
        });

        return Response.json({
          status: 'rejected',
          reason: 'subscription_protected',
          result,
        }, { status: 403 });
      }

      // Rule 2: Never remove stripe_subscription_id
      if (!incomingData.stripe_subscription_id && existingOrder.stripe_subscription_id) {
        result.rejections.push('subscription_id_removal_attempt');
        result.logs.push('FORCED: Preserving subscription_id');
        incomingData.stripe_subscription_id = existingOrder.stripe_subscription_id;
      }

      // Rule 3: Never erase line_items or fulfillments
      if (incomingData.line_items?.length === 0 && existingOrder.line_items?.length > 0) {
        result.rejections.push('line_items_erasure_attempt');
        result.logs.push('FORCED: Preserving line_items');
        incomingData.line_items = existingOrder.line_items;
      }

      if (incomingData.fulfillments?.length === 0 && existingOrder.fulfillments?.length > 0) {
        result.rejections.push('fulfillments_erasure_attempt');
        result.logs.push('FORCED: Preserving fulfillments');
        incomingData.fulfillments = existingOrder.fulfillments;
      }

      // Force subscription preservation
      incomingData.source_channel = 'subscription';
    }

    // ──────────────────────────────────────────────────────────────
    // STEP 5: EMAIL VALIDATION
    // ──────────────────────────────────────────────────────────────
    const finalEmail = incomingData.customer_email || (existingOrder?.customer_email) || null;
    if (!finalEmail) {
      result.rejections.push('no_valid_email');
      result.logs.push('BLOCKED: No email in payload or existing order');
      
      await validator.quarantineOrder(base44, {
        incident_type: 'missing_customer_info',
        customer_email: null,
        customer_name: incomingData.customer_name || null,
        existing_order_id: orderId || null,
        incoming_payload: incomingData,
        incoming_source: source,
        issue_description: `Order missing email. Cannot proceed. Source: ${source}`,
        recommended_action: 'manual_review',
      });

      return Response.json({
        status: 'rejected',
        reason: 'missing_email',
        result,
      }, { status: 400 });
    }

    // ──────────────────────────────────────────────────────────────
    // STEP 6: COMPLETENESS CHECK
    // ──────────────────────────────────────────────────────────────
    const completeness = validator.checkCompleteness(incomingData);
    const score = validator.getCompletenessScore(completeness);
    result.validations.push(`completeness_score: ${score}/10`);

    if (requireCompleteData && score < 6) {
      result.rejections.push('incomplete_data_required');
      result.logs.push(`Data completeness score ${score} below required threshold`);
      
      await validator.quarantineOrder(base44, {
        incident_type: 'incomplete_payload',
        customer_email: finalEmail,
        incoming_payload: incomingData,
        incoming_source: source,
        issue_description: `Incomplete data (score ${score}/10) required to be complete. Source: ${source}`,
        recommended_action: 'manual_review',
      });

      return Response.json({
        status: 'rejected',
        reason: 'incomplete_data',
        result,
      }, { status: 400 });
    }

    // ──────────────────────────────────────────────────────────────
    // STEP 7: UNKNOWN QUALITY DETECTION
    // ──────────────────────────────────────────────────────────────
    if (validator.isUnknownQuality(incomingData)) {
      if (existingOrder) {
        const existingScore = validator.getCompletenessScore(validator.checkCompleteness(existingOrder));
        if (existingScore >= 5) {
          result.rejections.push('unknown_quality_vs_complete');
          result.logs.push(`Unknown quality incoming (${score}) vs complete existing (${existingScore})`);
          
          await validator.quarantineOrder(base44, {
            incident_type: 'unknown_order_attempt',
            customer_email: finalEmail,
            existing_order_id: orderId,
            existing_order_number: existingOrder.shopify_order_number,
            existing_order_type: existingOrder.source_channel,
            incoming_payload: incomingData,
            incoming_source: source,
            issue_description: `Unknown quality payload would overwrite complete order. Source: ${source}`,
            recommended_action: 'reject',
          });

          return Response.json({
            status: 'rejected',
            reason: 'unknown_would_overwrite_complete',
            result,
          }, { status: 403 });
        }
      } else {
        // Creating new with unknown quality - quarantine
        result.rejections.push('unknown_quality_creation');
        result.logs.push('New order with unknown quality - quarantining');
        
        await validator.quarantineOrder(base44, {
          incident_type: 'unknown_order_attempt',
          customer_email: finalEmail,
          incoming_payload: incomingData,
          incoming_source: source,
          issue_description: `New order with unknown quality. Source: ${source}`,
          recommended_action: 'manual_review',
        });

        return Response.json({
          status: 'rejected',
          reason: 'unknown_quality_new_order',
          result,
        }, { status: 400 });
      }
    }

    // ──────────────────────────────────────────────────────────────
    // STEP 8: STALE UPDATE DETECTION
    // ──────────────────────────────────────────────────────────────
    if (existingOrder && validator.isStaleUpdate(existingOrder, incomingData, source)) {
      result.rejections.push('stale_update');
      result.logs.push('BLOCKED: Update is older than existing record');
      
      return Response.json({
        status: 'rejected',
        reason: 'stale_update',
        result,
      }, { status: 400 });
    }

    // ──────────────────────────────────────────────────────────────
    // STEP 9: SAFE MERGE (if incomplete but existing is complete)
    // ──────────────────────────────────────────────────────────────
    let finalData = { ...incomingData };
    if (existingOrder && score < 6) {
      const existingScore = validator.getCompletenessScore(validator.checkCompleteness(existingOrder));
      if (existingScore >= 6) {
        const { merged, fieldsUpdated } = validator.mergeOnlySafeFields(existingOrder, incomingData);
        finalData = merged;
        result.logs.push(`Safe merge applied: ${fieldsUpdated.join(', ')}`);
      }
    }

    // Preserve critical existing fields if incoming is empty
    if (existingOrder) {
      if (!finalData.customer_name && existingOrder.customer_name) {
        finalData.customer_name = existingOrder.customer_name;
      }
      if (!finalData.line_items?.length && existingOrder.line_items?.length) {
        finalData.line_items = existingOrder.line_items;
      }
      if (!finalData.total_price && existingOrder.total_price) {
        finalData.total_price = existingOrder.total_price;
      }
    }

    // ──────────────────────────────────────────────────────────────
    // STEP 10: CALCULATE DATA QUALITY STATUS
    // ──────────────────────────────────────────────────────────────
    const finalScore = validator.getCompletenessScore(validator.checkCompleteness(finalData));
    let dataQualityStatus = 'incomplete';
    if (finalScore >= 6) dataQualityStatus = 'complete';
    if (source === 'manual_recovery' || source === 'stripe_webhook') dataQualityStatus = 'verified';
    if (existingOrder?.repair_status === 'recovered_from_stripe') dataQualityStatus = 'verified';

    finalData.data_quality_status = dataQualityStatus;
    finalData.last_verified_at = source === 'manual_recovery' ? new Date().toISOString() : (existingOrder?.last_verified_at || null);

    // ──────────────────────────────────────────────────────────────
    // STEP 11: PERFORM WRITE
    // ──────────────────────────────────────────────────────────────
    let writtenOrder;
    try {
      if (orderId) {
        await base44.asServiceRole.entities.ShopifyOrder.update(orderId, finalData);
        // Fetch updated record
        const orders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 1000);
        writtenOrder = orders.find(o => o.id === orderId);
        result.action = 'updated';
      } else {
        writtenOrder = await base44.asServiceRole.entities.ShopifyOrder.create(finalData);
        result.action = 'created';
      }
      result.orderId = writtenOrder.id;
      result.success = true;
    } catch (err) {
      result.logs.push(`Write failed: ${err.message}`);
      return Response.json({
        status: 'error',
        error: err.message,
        result,
      }, { status: 500 });
    }

    // ──────────────────────────────────────────────────────────────
    // STEP 12: LOG TO AUDIT TRAIL
    // ──────────────────────────────────────────────────────────────
    try {
      await validator.logSync(base44, {
        source,
        event_type: source === 'stripe_webhook' ? 'stripe_event' : source,
        stripe_event_id: stripeEventId || null,
        order_id: writtenOrder.id,
        order_number: writtenOrder.shopify_order_number,
        customer_email: writtenOrder.customer_email,
        action: result.action,
        reason: result.rejections.length > 0 ? result.rejections.join('; ') : 'normal_update',
        fields_updated: Object.keys(incomingData),
        completeness: completeness,
        success: true,
      });
    } catch (err) {
      console.warn('[UPSERT-SAFE] Failed to log sync:', err.message);
    }

    result.logs.push('Successfully written to database');
    result.logs.push(`Final data_quality_status: ${dataQualityStatus}`);

    return Response.json({
      status: 'success',
      action: result.action,
      orderId: writtenOrder.id,
      orderNumber: writtenOrder.shopify_order_number,
      result,
    });
  } catch (error) {
    console.error('[UPSERT-SAFE] Unexpected error:', error.message);
    return Response.json({
      status: 'error',
      error: error.message,
    }, { status: 500 });
  }
});