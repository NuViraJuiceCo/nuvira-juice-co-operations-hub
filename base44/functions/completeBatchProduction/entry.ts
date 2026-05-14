import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Authorization: only admin, production_manager, or operations_staff can complete batches
    const allowedRoles = ['admin', 'production_manager', 'operations_staff'];
    if (!allowedRoles.includes(user.role)) {
      return Response.json({ error: 'Forbidden: Production completion requires admin/production_manager/operations_staff role' }, { status: 403 });
    }

    const body = await req.json();
    const {
      batch_id,
      actual_quantity_produced,
      staff_on_duty,
      actual_end_time,
      final_ingredients,
      default_formula_ingredients,
      ingredient_lot_notes,
      manual_ingredient_override,
      bottles_produced,
      bottles_rejected_or_wasted,
      final_usable_quantity,
      storage_location,
      use_by_date,
      pH_result,
      pH_passed_failed,
      pH_meter_id,
      calibration_checked,
      ccp_check_complete,
      sanitation_verification_complete,
      labels_applied,
      passed_failed,
      corrective_action_required,
      issue_identified,
      detection_method,
      product_involved,
      action_taken,
      disposed,
      quantity_disposed,
      preventive_steps,
      notes,
    } = body;

    if (!batch_id) {
      return Response.json({ error: 'batch_id required' }, { status: 400 });
    }

    // Find the batch
    const batches = await base44.asServiceRole.entities.ProductionBatch.filter({ batch_id });
    if (!batches || batches.length === 0) {
      return Response.json({ error: 'Batch not found' }, { status: 404 });
    }

    const batch = batches[0];

    // Hard-block truly terminal statuses — verified/archived cannot be re-completed
    const hardTerminalStatuses = ['verified_logged', 'archived'];
    if (hardTerminalStatuses.includes(batch.status)) {
      return Response.json({ error: `Cannot complete batch with status: ${batch.status}. Batch is already verified/archived.` }, { status: 400 });
    }
    // completed_pending_verification is allowed — treat as idempotent re-log (update fields, preserve status)

    // Validate required fields
    // Resolve canonical quantity — accept any of the three aliases
    const resolvedQty = Number(actual_quantity_produced ?? body.actual_units ?? body.quantity_produced);
    if (!resolvedQty || isNaN(resolvedQty) || resolvedQty <= 0) {
      return Response.json({ error: `Quantity must be a number > 0 (received actual_quantity_produced=${actual_quantity_produced})` }, { status: 400 });
    }
    if (pH_result === null || pH_result === undefined || pH_result === '') {
      return Response.json({ error: 'Required field missing: pH_result' }, { status: 400 });
    }
    if (!pH_passed_failed) {
      return Response.json({ error: 'Required field missing: pH_passed_failed' }, { status: 400 });
    }
    if (!passed_failed) {
      return Response.json({ error: 'Required field missing: passed_failed' }, { status: 400 });
    }

    // pH failed requires corrective action
    if (pH_passed_failed === 'failed' && !corrective_action_required) {
      return Response.json({ error: 'pH failed — corrective action required' }, { status: 400 });
    }

    // Corrective action requires additional fields
    if (corrective_action_required) {
      if (!issue_identified || !action_taken) {
        return Response.json({ error: 'Corrective action requires issue_identified and action_taken' }, { status: 400 });
      }
    }

    const now = new Date().toISOString();
    const endTime = actual_end_time || now;

    // Update batch to completed_pending_verification
    const updateData = {
      status: 'completed_pending_verification',
      actual_end_time: endTime,
      completed_by: user.email,
      ...(staff_on_duty && staff_on_duty.length > 0 ? { staff_on_duty } : {}),
      ...(final_ingredients?.length ? { ingredients_used: final_ingredients } : {}),
      ...(ingredient_lot_notes ? { ingredient_lot_notes: manual_ingredient_override ? `[MANUAL OVERRIDE] ${ingredient_lot_notes}` : ingredient_lot_notes } : {}),
      actual_units: resolvedQty,   // canonical schema field — only actual_units exists in entity schema
      bottles_produced: bottles_produced || null,
      bottles_rejected_or_wasted: bottles_rejected_or_wasted || null,
      final_usable_quantity: final_usable_quantity || null,
      storage_location: storage_location || '',
      use_by_date: use_by_date || null,
      pH_result: pH_result,
      pH_passed_failed: pH_passed_failed,
      pH_meter_id: pH_meter_id || null,
      calibration_checked: calibration_checked || false,
      ccp_check_complete: ccp_check_complete || false,
      sanitation_verification_complete: sanitation_verification_complete || false,
      labels_applied: labels_applied || false,
      passed_failed: passed_failed,
      corrective_action_required: corrective_action_required || false,
      issue_identified: issue_identified || null,
      detection_method: detection_method || null,
      product_involved: product_involved || null,
      action_taken: action_taken || null,
      disposed: disposed || false,
      quantity_disposed: quantity_disposed || null,
      preventive_steps: preventive_steps || null,
      notes: notes || '',
    };

    // Add to audit trail
    if (!batch.audit_trail) {
      batch.audit_trail = [];
    }
    batch.audit_trail.push({
      timestamp: now,
      action: batch.status === 'completed_pending_verification' ? 'BatchCompletionUpdated' : 'BatchCompletedPendingVerification',
      performed_by: user.email,
      before: { status: batch.status },
      after: { status: 'completed_pending_verification' },
      reason: batch.status === 'completed_pending_verification' ? 'Idempotent re-log: updated completion fields on already-completed batch' : undefined,
    });
    updateData.audit_trail = batch.audit_trail;

    await base44.asServiceRole.entities.ProductionBatch.update(batch.id, updateData);

    // ── Sync linked ManualProductionBatch records to produced ───────────────
    // Find any manual batch sources in this batch's order_sources
    const manualSources = (batch.order_sources || []).filter(s => s.source_type === 'manual_internal_batch' && s.order_id);
    const manualBatchIds = [...new Set(manualSources.map(s => s.order_id))];
    for (const mbId of manualBatchIds) {
      try {
        const mb = await base44.asServiceRole.entities.ManualProductionBatch.get(mbId).catch(() => null);
        if (mb && !['completed', 'cancelled'].includes(mb.status)) {
          const linkedIds = [...new Set([...(mb.linked_production_batch_ids || []), batch.batch_id])];

          // Build produced_quantities: merge new produced qty into existing tracking
          const existingPQ = mb.produced_quantities || [];
          const newPQ = [...existingPQ];
          for (const src of manualSources.filter(s => s.order_id === mbId)) {
            const existing = newPQ.find(p => p.product_name === src.source_item && p.production_batch_id === batch.batch_id);
            if (!existing) {
              const plannedItem = (mb.items || []).find(i => i.product_name === src.source_item || i.product_name?.toLowerCase() === src.source_item?.toLowerCase());
              newPQ.push({
                product_name: src.source_item,
                planned_quantity: plannedItem?.quantity || src.quantity,
                produced_quantity: src.quantity,
                production_batch_id: batch.batch_id,
                produced_at: now,
              });
            }
          }

          // Determine if all items in the manual batch are now produced
          const allProduced = (mb.items || []).every(item => {
            const producedForItem = newPQ.filter(p =>
              p.product_name === item.product_name || p.product_name?.toLowerCase() === item.product_name?.toLowerCase()
            ).reduce((sum, p) => sum + (p.produced_quantity || 0), 0);
            return producedForItem >= (item.quantity || 0);
          });

          await base44.asServiceRole.entities.ManualProductionBatch.update(mbId, {
            status: allProduced ? 'produced' : 'in_production',
            produced_at: allProduced ? now : (mb.produced_at || null),
            completed_by: allProduced ? user.email : (mb.completed_by || null),
            linked_production_batch_ids: linkedIds,
            produced_quantities: newPQ,
          });
          console.log(`[COMPLETE-BATCH] ManualProductionBatch ${mbId} → ${allProduced ? 'produced' : 'in_production (partial)'}`);
        }
      } catch (err) {
        console.warn(`[COMPLETE-BATCH] Could not update ManualProductionBatch ${mbId}: ${err.message}`);
      }
    }

    return Response.json({
      success: true,
      batch_id,
      status: 'completed_pending_verification',
      completed_at: now,
      completed_by: user.email,
      awaiting_verification: true,
      manual_batches_updated: manualBatchIds.length,
    });
  } catch (error) {
    console.error('[COMPLETE-BATCH]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});