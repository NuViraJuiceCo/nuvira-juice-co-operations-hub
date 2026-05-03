import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const hub = base44.asServiceRole;

    const out = {
      audit_date: '2026-05-01',
      executed_at: new Date().toISOString(),
      batches_found: [],
      verification_summary: {
        total_batches: 0,
        fully_verified: 0,
        partially_logged: 0,
        missing_logs: 0,
        issues: []
      }
    };

    // Read all batches from May 1st
    const allBatches = await hub.entities.ProductionBatch.list('-created_date', 500);
    
    for (const batch of allBatches) {
      if (!batch.production_date || batch.production_date !== '2026-05-01') {
        continue;
      }

      out.verification_summary.total_batches++;

      const batchRecord = {
        batch_id: batch.batch_id,
        product_name: batch.product_name,
        status: batch.status,
        planned_units: batch.planned_units,
        actual_units: batch.actual_units,
        verification: {
          has_compliance_log: !!batch.compliance_log_id,
          has_ccp_log: !!batch.ccp_log_id,
          has_sanitation_log: !!batch.sanitation_log_id,
          has_corrective_action_log: !!batch.corrective_action_log_id,
          is_locked: batch.is_locked,
          passed_failed: batch.passed_failed,
          verified_by: batch.verified_by,
          verified_at: batch.verified_at
        },
        required_fields: {
          actual_start_time: !!batch.actual_start_time,
          actual_end_time: !!batch.actual_end_time,
          actual_units: batch.actual_units !== null && batch.actual_units !== undefined,
          staff_on_duty: (batch.staff_on_duty?.length || 0) > 0,
          pH_result: batch.pH_result !== null && batch.pH_result !== undefined,
          passed_failed: !!batch.passed_failed,
          bottles_produced: batch.bottles_produced !== null && batch.bottles_produced !== undefined
        },
        issues: []
      };

      // Check for missing required fields
      for (const [field, present] of Object.entries(batchRecord.required_fields)) {
        if (!present) {
          batchRecord.issues.push(`Missing required field: ${field}`);
        }
      }

      // Check for missing compliance logs
      const logsNeeded = [];
      if (!batch.compliance_log_id) logsNeeded.push('BatchComplianceLog');
      if (!batch.ccp_log_id && batch.ccp_check_complete) logsNeeded.push('CCPMonitoringLog');
      if (!batch.sanitation_log_id && batch.sanitation_verification_complete) logsNeeded.push('SanitationVerificationLog');
      if (!batch.corrective_action_log_id && batch.corrective_action_required) logsNeeded.push('CorrectiveActionLog');

      if (logsNeeded.length > 0) {
        batchRecord.issues.push(`Missing logs: ${logsNeeded.join(', ')}`);
      }

      // Determine verification status
      const isFullyVerified = batch.status === 'verified_logged' && batch.is_locked && !batchRecord.issues.length;
      const isPartiallyLogged = batch.status === 'completed_pending_verification' || (batch.compliance_log_id && batchRecord.issues.length);

      if (isFullyVerified) {
        out.verification_summary.fully_verified++;
      } else if (isPartiallyLogged) {
        out.verification_summary.partially_logged++;
      } else {
        out.verification_summary.missing_logs++;
      }

      if (batchRecord.issues.length > 0) {
        out.verification_summary.issues.push({
          batch_id: batch.batch_id,
          product: batch.product_name,
          issues: batchRecord.issues
        });
      }

      out.batches_found.push(batchRecord);
    }

    out.verification_summary.overall_status = 
      out.verification_summary.missing_logs === 0 
        ? 'ALL_BATCHES_PROCESSED' 
        : 'SOME_BATCHES_INCOMPLETE';

    return Response.json(out, { status: 200 });

  } catch (error) {
    return Response.json({
      status: 'error',
      error: error?.message || String(error)
    }, { status: 500 });
  }
});