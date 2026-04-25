import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * ORDER PROTECTION VALIDATOR
 * 
 * Centralized validation logic to prevent invalid syncs, overwrites, and data degradation.
 * Used by: stripeCheckoutWebhook, pullOrdersFromCustomerApp, recovery functions, batch syncs
 * 
 * Provides:
 * 1. Completeness validation
 * 2. Subscription protection
 * 3. Overwrite prevention
 * 4. Quarantine logic
 * 5. Sync logging
 */

export class OrderValidator {
  constructor(base44) {
    this.base44 = base44;
  }

  /**
   * Check how complete an order payload is
   */
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

  /**
   * Get completeness score (0-10)
   */
  getCompletenessScore(completeness) {
    let score = 0;
    if (completeness.has_customer_name) score++;
    if (completeness.has_email) score++;
    if (completeness.has_line_items) score++;
    if (completeness.has_total) score++;
    if (completeness.has_address) score++;
    if (completeness.has_stripe_subscription_id) score++;
    score += Math.min(completeness.line_items_count, 2); // bonus for multiple items
    return Math.min(score, 10);
  }

  /**
   * Check if incoming payload is "unknown" quality
   */
  isUnknownQuality(payload) {
    return (
      payload.shopify_order_number === '#unknown' ||
      payload.shopify_order_number === '#UNKNOWN' ||
      (payload.shopify_order_id && payload.shopify_order_id.includes('unknown')) ||
      (!payload.customer_email && !payload.stripe_subscription_id) ||
      (payload.total_price === 0 && (!payload.line_items || payload.line_items.length === 0))
    );
  }

  /**
   * Detect if an update would downgrade subscription to one-time
   */
  wouldDowngradeSubscription(existingOrder, incomingPayload) {
    return (
      existingOrder.source_channel === 'subscription' &&
      incomingPayload.source_channel !== 'subscription' &&
      incomingPayload.source_channel !== undefined
    );
  }

  /**
   * Detect if an update would downgrade/lose subscription metadata
   */
  wouldLoseSubscriptionMetadata(existingOrder, incomingPayload) {
    return (
      existingOrder.stripe_subscription_id &&
      !incomingPayload.stripe_subscription_id &&
      !existingOrder.fulfillments?.some(f => f.status === 'delivered') // Only protect active subscriptions
    );
  }

  /**
   * Detect if incoming is "stale" compared to existing
   */
  isStaleUpdate(existingOrder, incomingPayload, incomingSource) {
    // Only check timestamp for webhook/recovery sources where ordering matters
    if (!['stripe_webhook', 'manual_recovery'].includes(incomingSource)) {
      return false;
    }

    const existingTime = new Date(existingOrder.updated_date || existingOrder.created_date).getTime();
    const incomingTime = new Date(incomingPayload.customer_order_date || incomingPayload.created_date || Date.now()).getTime();

    // If incoming is older than existing by more than 1 minute, it's stale
    return incomingTime < (existingTime - 60000);
  }

  /**
   * Determine if an incoming order can overwrite an existing one
   * Returns: { canUpdate: boolean, reason: string, recommended_action: string }
   */
  canSafelyUpdate(existingOrder, incomingPayload, incomingSource) {
    const result = {
      canUpdate: true,
      reasons: [],
      rejections: [],
      recommended_action: 'update',
    };

    // Check 1: Subscription downgrade
    if (this.wouldDowngradeSubscription(existingOrder, incomingPayload)) {
      result.reasons.push('incoming_would_downgrade_subscription');
      result.rejections.push('subscription_downgrade_prevention');
      result.canUpdate = false;
      result.recommended_action = 'reject';
      return result;
    }

    // Check 2: Subscription metadata loss
    if (this.wouldLoseSubscriptionMetadata(existingOrder, incomingPayload)) {
      result.reasons.push('incoming_would_lose_subscription_metadata');
      result.rejections.push('subscription_metadata_protection');
      result.canUpdate = false;
      result.recommended_action = 'reject';
      return result;
    }

    // Check 3: Stale update
    if (this.isStaleUpdate(existingOrder, incomingPayload, incomingSource)) {
      result.reasons.push('incoming_is_stale');
      result.rejections.push('stale_update_protection');
      result.canUpdate = false;
      result.recommended_action = 'reject';
      return result;
    }

    // Check 4: Unknown quality trying to overwrite valid order
    if (this.isUnknownQuality(incomingPayload)) {
      const existingCompleteness = this.getCompletenessScore(this.checkCompleteness(existingOrder));
      if (existingCompleteness >= 5) {
        result.reasons.push('incoming_is_unknown_quality');
        result.rejections.push('unknown_quality_protection');
        result.canUpdate = false;
        result.recommended_action = 'quarantine';
        return result;
      }
    }

    // Check 5: Incomplete payload overwriting complete order
    const existingCompleteness = this.getCompletenessScore(this.checkCompleteness(existingOrder));
    const incomingCompleteness = this.getCompletenessScore(this.checkCompleteness(incomingPayload));
    
    if (existingCompleteness >= 6 && incomingCompleteness < 5) {
      result.reasons.push('incoming_less_complete_than_existing');
      result.rejections.push('completeness_protection');
      result.canUpdate = false;
      result.recommended_action = 'merge_safe_fields_only';
      return result;
    }

    return result;
  }

  /**
   * Log a sync operation
   */
  async logSync(params) {
    try {
      await this.base44.asServiceRole.entities.OrderSyncLog.create({
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
        fields_rejected: params.fields_rejected || [],
        incoming_data_completeness: params.completeness || null,
        success: params.success !== false,
        error: params.error || null,
      });
    } catch (err) {
      console.error('[VALIDATOR] Failed to log sync:', err.message);
    }
  }

  /**
   * Add item to order review queue
   */
  async quarantineOrder(params) {
    try {
      await this.base44.asServiceRole.entities.OrderReviewQueue.create({
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
      console.log(`[VALIDATOR] Quarantined order for review: ${params.issue_description}`);
    } catch (err) {
      console.error('[VALIDATOR] Failed to quarantine order:', err.message);
    }
  }

  /**
   * Merge safe fields only from incoming to existing
   * Used when incoming is less complete but has some new information
   */
  mergeOnlySafeFields(existingOrder, incomingPayload) {
    const merged = { ...existingOrder };
    const safeFields = [
      'customer_phone',
      'internal_notes',
      'customer_notes',
      'requested_delivery_date',
      'assigned_delivery_date',
      'fulfillment_method',
      'tags',
    ];

    const fieldsUpdated = [];

    for (const field of safeFields) {
      if (incomingPayload[field] && !merged[field]) {
        merged[field] = incomingPayload[field];
        fieldsUpdated.push(field);
      }
    }

    // Address: only fill in if existing has none
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
}

export default OrderValidator;