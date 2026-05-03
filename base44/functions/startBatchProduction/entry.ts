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
      staff_on_duty,
      equipment_used,
      pre_op_sanitation_confirmed,
      sanitizer_log_reference,
      refrigerator_temp_checked,
      notes,
      actual_start_time_override,
      retrospective_reason,
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

    // Validate batch is in ready state
    if (!['planned', 'ready_for_production'].includes(batch.status)) {
      return Response.json({ error: `Cannot start batch with status: ${batch.status}` }, { status: 400 });
    }

    const now = new Date().toISOString();
    const startTime = actual_start_time_override || now;

    // Update batch to in_production
    const updateData = {
      status: 'in_production',
      actual_start_time: startTime,
      started_by: user.email,
      staff_on_duty: staff_on_duty || [user.email],
      equipment_used: equipment_used || [],
      pre_op_sanitation_confirmed: pre_op_sanitation_confirmed || false,
      sanitizer_log_reference: sanitizer_log_reference || null,
      refrigerator_temp_checked: refrigerator_temp_checked || false,
      notes: notes || '',
      ...(retrospective_reason ? { notes: `[RETROSPECTIVE] ${retrospective_reason}${notes ? ' | ' + notes : ''}` } : {}),
    };

    // Add to audit trail
    if (!batch.audit_trail) {
      batch.audit_trail = [];
    }
    batch.audit_trail.push({
      timestamp: now,
      action: retrospective_reason ? 'RetrospectiveBatchStarted' : 'BatchStarted',
      performed_by: user.email,
      before: { status: batch.status },
      after: { status: 'in_production' },
      reason: retrospective_reason || undefined,
    });
    updateData.audit_trail = batch.audit_trail;

    await base44.asServiceRole.entities.ProductionBatch.update(batch.id, updateData);

    return Response.json({
      success: true,
      batch_id,
      status: 'in_production',
      started_at: now,
      started_by: user.email,
    });
  } catch (error) {
    console.error('[START-BATCH]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});