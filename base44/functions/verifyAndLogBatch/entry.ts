import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized: Admin access required' }, { status: 403 });
    }

    const body = await req.json();
    const { batch_id } = body;

    if (!batch_id) {
      return Response.json({ error: 'batch_id required' }, { status: 400 });
    }

    // Find the batch
    const batches = await base44.asServiceRole.entities.ProductionBatch.filter({ batch_id });
    if (!batches || batches.length === 0) {
      return Response.json({ error: 'Batch not found' }, { status: 404 });
    }

    const batch = batches[0];

    // Resolve quantity from whichever field is populated (handles legacy batches)
    const resolveBatchQuantity = (b) => {
      const candidates = [b.actual_quantity_produced, b.actual_units, b.actual_quantity, b.completed_quantity, b.quantity];
      for (const val of candidates) {
        if (val !== null && val !== undefined && val !== '') return val;
      }
      return null;
    };
    const resolvedQuantity = resolveBatchQuantity(batch);

    // Validate batch is completed_pending_verification
    if (batch.status !== 'completed_pending_verification') {
      return Response.json({ error: `Cannot verify batch with status: ${batch.status}. Re-open the batch from History first.` }, { status: 400 });
    }

    // Validate required fields for verification (quantity checked via resolver)
    const required = ['production_date', 'batch_id', 'product_name',
                     'actual_start_time', 'actual_end_time', 'staff_on_duty', 'pH_result', 'passed_failed'];
    const missing = required.filter(f => !batch[f]);
    if (resolvedQuantity === null) missing.push('quantity (actual_quantity_produced / actual_units)');
    if (missing.length > 0) {
      return Response.json({ error: `Cannot verify: missing fields: ${missing.join(', ')}` }, { status: 400 });
    }

    const now = new Date().toISOString();

    // 1. Create or update BatchComplianceLog (avoid duplicates on re-verify)
    let complianceLog;
    if (batch.compliance_log_id) {
      // Re-verify: update the existing compliance log rather than creating a duplicate
      await base44.asServiceRole.entities.BatchComplianceLog.update(batch.compliance_log_id, {
        quantity_produced: resolvedQuantity,
        pH_result: batch.pH_result,
        passed_failed: batch.passed_failed,
        verified_by: user.email,
        verified_at: now,
        notes: [batch.notes, batch.ingredient_lot_notes].filter(Boolean).join(' | ') || '',
      }).catch(() => null); // non-fatal if update fails
      complianceLog = { id: batch.compliance_log_id };
    } else {
      complianceLog = await base44.asServiceRole.entities.BatchComplianceLog.create({
        date: batch.production_date,
        batch_id: batch.batch_id,
        juice_flavor: batch.product_name,
        ingredients: batch.ingredients_used?.length ? batch.ingredients_used : [],
        notes: [batch.notes, batch.ingredient_lot_notes].filter(Boolean).join(' | ') || '',
        start_time: batch.actual_start_time,
        end_time: batch.actual_end_time,
        quantity_produced: resolvedQuantity,
        staff_on_duty: batch.staff_on_duty || [],
        pH_result: batch.pH_result,
        passed_failed: batch.passed_failed,
        verified_by: user.email,
        verified_at: now,
        source_production_batch_id: batch.id,
        locked: true,
      });
    }

    // 2. If CCP check complete, create CCPLog
    let ccpLogId = batch.ccp_log_id || null;
    if (batch.ccp_check_complete && !ccpLogId) {
      const startTime = batch.actual_start_time ? new Date(batch.actual_start_time).toTimeString().slice(0, 5) : '00:00';
      const ccpLog = await base44.asServiceRole.entities.CCPLog.create({
        log_date: batch.production_date,
        log_time: startTime,
        staff_member: (batch.staff_on_duty || [])[0] || user.email,
        ccp_point: 'pH Control',
        batch_id: batch.batch_id,
        measurement: String(batch.pH_result),
        critical_limit: '< 4.6',
        result: batch.pH_passed_failed === 'passed' ? 'Pass' : 'Fail',
        notes: batch.notes || '',
      });
      ccpLogId = ccpLog.id;
    }

    // 3. If corrective action required, create CorrectiveActionLog
    let correctiveLogId = batch.corrective_action_log_id || null;
    if (batch.corrective_action_required && !correctiveLogId) {
      const startTime = batch.actual_start_time ? new Date(batch.actual_start_time).toTimeString().slice(0, 5) : '00:00';
      const correctiveLog = await base44.asServiceRole.entities.CorrectiveActionLog.create({
        log_date: batch.production_date,
        log_time: startTime,
        staff_member: (batch.staff_on_duty || [])[0] || user.email,
        issue_type: batch.pH_passed_failed === 'failed' ? 'pH Failure' : 'CCP Failure',
        issue_description: batch.issue_identified || '',
        corrective_action_taken: batch.action_taken || '',
        verified_by: user.email,
        status: 'Completed',
        notes: [batch.detection_method, batch.preventive_steps].filter(Boolean).join(' | ') || '',
      });
      correctiveLogId = correctiveLog.id;
    }

    // 4. If sanitation verification complete, link or create SanitationLog (no duplicates)
    let sanitationLogId = batch.sanitation_log_id || null;
    if (batch.sanitation_verification_complete && !sanitationLogId) {
      if (batch.sanitizer_log_reference) {
        sanitationLogId = batch.sanitizer_log_reference;
      } else {
        const existingSanitation = await base44.asServiceRole.entities.SanitationLog.filter({
          log_date: batch.production_date,
        });
        if (existingSanitation && existingSanitation.length > 0) {
          sanitationLogId = existingSanitation[0].id;
        } else {
          const startTime = batch.actual_start_time ? new Date(batch.actual_start_time).toTimeString().slice(0, 5) : '00:00';
          const sanitationLog = await base44.asServiceRole.entities.SanitationLog.create({
            log_date: batch.production_date,
            log_time: startTime,
            staff_member: (batch.staff_on_duty || [])[0] || user.email,
            area: 'Production Floor',
            sanitizer_type: 'Standard',
            sanitizer_level: 'Adequate',
            cleaned: true,
            sanitized: true,
            verified_by: user.email,
            notes: 'Pre-production sanitation — auto-logged from batch verification',
          });
          sanitationLogId = sanitationLog.id;
        }
      }
    }

    // 5. Cascade: update linked FulfillmentTasks to "Packed"
    const packableStatuses = ['Unassigned', 'Scheduled'];
    const batchOrderIds = new Set(
      (batch.order_sources || []).map(s => s.order_id).filter(Boolean)
    );
    const deliveryDate = new Date(batch.production_date);
    deliveryDate.setDate(deliveryDate.getDate() + 1);
    const deliveryDateStr = deliveryDate.toISOString().split('T')[0];

    const [tasksByProdDate, tasksBySchedDate] = await Promise.all([
      base44.asServiceRole.entities.FulfillmentTask.filter({ production_date: batch.production_date }),
      base44.asServiceRole.entities.FulfillmentTask.filter({ scheduled_date: deliveryDateStr }),
    ]);

    const allTasksMap = {};
    for (const t of [...tasksByProdDate, ...tasksBySchedDate]) {
      allTasksMap[t.id] = t;
    }

    let packedCount = 0;
    for (const task of Object.values(allTasksMap)) {
      if (!packableStatuses.includes(task.status)) continue;
      const isLinked = batchOrderIds.size === 0 || batchOrderIds.has(task.order_id);
      if (isLinked) {
        await base44.asServiceRole.entities.FulfillmentTask.update(task.id, {
          status: 'Packed',
          production_date: batch.production_date,
        });
        packedCount++;
      }
    }
    console.log(`[VERIFY-BATCH] Packed ${packedCount} FulfillmentTask(s) for production_date ${batch.production_date}`);

    // 6a. Cascade production_status: 'bottled' ONLY to non-subscription ShopifyOrders
    const orderIdsToUpdate = [...new Set((batch.order_sources || []).map(s => s.order_id).filter(Boolean))];
    for (const orderId of orderIdsToUpdate) {
      try {
        const order = await base44.asServiceRole.entities.ShopifyOrder.get(orderId).catch(() => null);
        if (!order) continue;
        if (order.fulfillment_mode === 'multi_delivery' || order.order_type === 'subscription') {
          console.log(`[VERIFY-BATCH] Skipping subscription order ${orderId} — instance-level status only`);
          continue;
        }
        if (!['fulfilled', 'canceled', 'refunded'].includes(order.production_status)) {
          await base44.asServiceRole.entities.ShopifyOrder.update(orderId, { production_status: 'bottled' });
        }
      } catch (err) {
        console.warn(`[VERIFY-BATCH] Could not update ShopifyOrder ${orderId}: ${err.message}`);
      }
    }

    // 6b. Update ProductionBatch with verification data and lock
    const auditTrail = [...(batch.audit_trail || []), {
      timestamp: now,
      action: 'BatchVerifiedAndComplianceLogged',
      performed_by: user.email,
      before: { status: batch.status },
      after: { status: 'verified_logged' },
    }];

    await base44.asServiceRole.entities.ProductionBatch.update(batch.id, {
      status: 'verified_logged',
      production_status: 'bottled',
      verified_by: user.email,
      verified_at: now,
      compliance_log_id: complianceLog.id,
      ccp_log_id: ccpLogId,
      corrective_action_log_id: correctiveLogId,
      sanitation_log_id: sanitationLogId,
      is_locked: true,
      audit_trail: auditTrail,
    });

    return Response.json({
      success: true,
      batch_id,
      status: 'verified_logged',
      production_status: 'bottled',
      verified_at: now,
      verified_by: user.email,
      compliance_log_id: complianceLog.id,
      ccp_log_id: ccpLogId,
      corrective_action_log_id: correctiveLogId,
      sanitation_log_id: sanitationLogId,
      fulfillment_tasks_packed: packedCount,
    });
  } catch (error) {
    console.error('[VERIFY-BATCH]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});