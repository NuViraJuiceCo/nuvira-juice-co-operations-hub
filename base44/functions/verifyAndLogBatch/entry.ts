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

    // Validate batch is completed_pending_verification
    if (batch.status !== 'completed_pending_verification') {
      return Response.json({ error: `Cannot verify batch with status: ${batch.status}` }, { status: 400 });
    }

    // Validate required fields for verification
    const required = ['production_date', 'batch_id', 'product_name', 'actual_quantity_produced', 
                     'actual_start_time', 'actual_end_time', 'staff_on_duty', 'pH_result', 'passed_failed'];
    const missing = required.filter(f => !batch[f]);
    if (missing.length > 0) {
      return Response.json({ error: `Cannot verify: missing fields: ${missing.join(', ')}` }, { status: 400 });
    }

    const now = new Date().toISOString();

    // 1. Create BatchComplianceLog
    const complianceLog = await base44.asServiceRole.entities.BatchComplianceLog.create({
      date: batch.production_date,
      batch_id: batch.batch_id,
      juice_flavor: batch.product_name,
      ingredients: batch.ingredients_used || [],
      start_time: batch.actual_start_time,
      end_time: batch.actual_end_time,
      quantity_produced: batch.actual_quantity_produced,
      staff_on_duty: batch.staff_on_duty || [],
      pH_result: batch.pH_result,
      passed_failed: batch.passed_failed,
      notes: batch.notes || '',
      verified_by: user.email,
      verified_at: now,
      source_production_batch_id: batch.id,
      locked: true,
    });

    // 2. If CCP check complete, create CCPMonitoringLog
    let ccpLogId = null;
    if (batch.ccp_check_complete) {
      const ccpLog = await base44.asServiceRole.entities.CCPLog.create({
        date: batch.production_date,
        time: batch.actual_start_time,
        batch_id: batch.batch_id,
        juice_name: batch.product_name,
        critical_control_point: 'pH',
        measurement_type: 'pH',
        measurement_result: batch.pH_result,
        within_limit: batch.pH_passed_failed === 'passed',
        corrective_action_required: batch.corrective_action_required || false,
        initials: user.email.split('@')[0].toUpperCase().slice(0, 2),
        source_batch_id: batch.id,
      });
      ccpLogId = ccpLog.id;
    }

    // 3. If corrective action required, create CorrectiveActionLog
    let correctiveLogId = null;
    if (batch.corrective_action_required) {
      const correctiveLog = await base44.asServiceRole.entities.CorrectiveActionLog.create({
        date: batch.production_date,
        issue_identified: batch.issue_identified,
        detection_method: batch.detection_method,
        product_involved: batch.product_involved,
        action_taken: batch.action_taken,
        disposed: batch.disposed || false,
        quantity_disposed: batch.quantity_disposed || null,
        initials: user.email.split('@')[0].toUpperCase().slice(0, 2),
        preventive_steps: batch.preventive_steps || '',
        source_batch_id: batch.id,
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
        const sanitationLog = await base44.asServiceRole.entities.SanitationLog.create({
          date: batch.production_date,
          time: batch.actual_start_time,
          equipment_or_area: 'Production Equipment',
          sanitizer_used: 'Standard',
          concentration: 'Per SOP',
          contact_time_minutes: 15,
          verified_by: user.email,
          initials: user.email.split('@')[0].toUpperCase().slice(0, 2),
          notes: 'Pre-production sanitation',
          source_batch_id: batch.id,
        });
        sanitationLogId = sanitationLog.id;
      }
    }

    // 5. Update ProductionBatch with verification data and lock
    const updateData = {
      status: 'verified_logged',
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