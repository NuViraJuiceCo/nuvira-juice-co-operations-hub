import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const {
      batch_id,
      actual_quantity_produced,
      staff_on_duty,
      actual_end_time,
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

    // Validate batch is in_production
    if (batch.status !== 'in_production') {
      return Response.json({ error: `Cannot complete batch with status: ${batch.status}` }, { status: 400 });
    }

    // Validate required fields
    const required = ['actual_quantity_produced', 'pH_result', 'pH_passed_failed', 'passed_failed'];
    for (const field of required) {
      if (!(field in body) || body[field] === null || body[field] === undefined) {
        return Response.json({ error: `Required field missing: ${field}` }, { status: 400 });
      }
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
      actual_quantity_produced: actual_quantity_produced,
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
      action: 'BatchCompletedPendingVerification',
      performed_by: user.email,
      before: { status: batch.status },
      after: { status: 'completed_pending_verification' },
    });
    updateData.audit_trail = batch.audit_trail;

    await base44.asServiceRole.entities.ProductionBatch.update(batch.id, updateData);

    return Response.json({
      success: true,
      batch_id,
      status: 'completed_pending_verification',
      completed_at: now,
      completed_by: user.email,
      awaiting_verification: true,
    });
  } catch (error) {
    console.error('[COMPLETE-BATCH]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});