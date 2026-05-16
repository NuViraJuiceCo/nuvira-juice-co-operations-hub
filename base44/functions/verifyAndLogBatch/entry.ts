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
      return Response.json({ error: `Cannot verify batch with status: ${batch.status}` }, { status: 400 });
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

    // 1. Create BatchComplianceLog
    const complianceLog = await base44.asServiceRole.entities.BatchComplianceLog.create({
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

    // 2. If CCP check complete, create CCPLog
    let ccpLogId = null;
    if (batch.ccp_check_complete) {
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
    let correctiveLogId = null;
    if (batch.corrective_action_required) {
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

    // 4. If sanitation verification complete, link or create SanitationVerificationLog
    let sanitationLogId = null;
    if (batch.sanitation_verification_complete) {
      // If sanitizer_log_reference exists, use it; otherwise create new
      if (batch.sanitizer_log_reference) {
        sanitationLogId = batch.sanitizer_log_reference;
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

    // 5. Cascade: update linked FulfillmentTasks for this production_date to "Packed"
    //    Only update tasks that are in a pre-packed state (Scheduled, Unassigned)
    const fulfillmentTasks = await base44.asServiceRole.entities.FulfillmentTask.filter({
      production_date: batch.production_date,
    });
    const packableStatuses = ['Unassigned', 'Scheduled'];
    for (const task of fulfillmentTasks) {
      if (packableStatuses.includes(task.status)) {
        await base44.asServiceRole.entities.FulfillmentTask.update(task.id, { status: 'Packed' });
      }
    }

    // 6. Update ProductionBatch with verification data, production_status = bottled, and lock
    const updateData = {
      status: 'verified_logged',
      production_status: 'bottled',
      verified_by: user.email,
      verified_at: now,
      compliance_log_id: complianceLog.id,
      ccp_log_id: ccpLogId,
      corrective_action_log_id: correctiveLogId,
      sanitation_log_id: sanitationLogId,
      is_locked: true,
    };

    // Add to audit trail
    if (!batch.audit_trail) {
      batch.audit_trail = [];
    }
    batch.audit_trail.push({
      timestamp: now,
      action: 'BatchVerifiedAndComplianceLogged',
      performed_by: user.email,
      before: { status: batch.status },
      after: { status: 'verified_logged' },
    });
    updateData.audit_trail = batch.audit_trail;

    await base44.asServiceRole.entities.ProductionBatch.update(batch.id, updateData);

    return Response.json({
      success: true,
      batch_id,
      status: 'verified_logged',
      verified_at: now,
      verified_by: user.email,
      compliance_log_id: complianceLog.id,
      ccp_log_id: ccpLogId,
      corrective_action_log_id: correctiveLogId,
      sanitation_log_id: sanitationLogId,
    });
  } catch (error) {
    console.error('[VERIFY-BATCH]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});