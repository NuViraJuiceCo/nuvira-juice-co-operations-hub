import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * LOG REPAIR EXECUTION
 * 
 * Central audit log for all repair, cleanup, recovery, rebuild, and recovery functions.
 * Call this from any repair function to create an immutable record of what was changed,
 * who changed it, when, and why.
 * 
 * Usage:
 *   await base44.functions.invoke('logRepairExecution', {
 *     repair_function: 'repairMissingAddresses',
 *     action: 'repair',
 *     records_affected: 5,
 *     changes: {
 *       repaired: [...],
 *       flagged: [...]
 *     },
 *     reason: 'Weekly maintenance'
 *   });
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await req.json();
    const {
      repair_function,
      action,
      records_affected,
      changes,
      reason,
      details
    } = body;

    if (!repair_function || !action) {
      return Response.json({ error: 'repair_function and action required' }, { status: 400 });
    }

    // Create immutable audit record
    const auditRecord = {
      timestamp: new Date().toISOString(),
      executed_by: user.email,
      user_role: user.role,
      repair_function,
      action, // 'repair', 'cleanup', 'recovery', 'rebuild', 'reconcile'
      records_affected: records_affected || 0,
      reason: reason || 'No reason provided',
      changes: changes || {},
      details: details || null,
      app_version: '2026-05-01', // Update this on major releases
    };

    // Log to console (will appear in platform logs)
    console.log(`[REPAIR-AUDIT] ${user.email} executed ${repair_function} | action: ${action} | records: ${records_affected}`);

    // Optionally store in database if audit entity exists
    try {
      await base44.asServiceRole.entities.RepairAuditLog.create(auditRecord);
      console.log(`[REPAIR-AUDIT] Logged to RepairAuditLog`);
    } catch (err) {
      // RepairAuditLog entity might not exist yet, but we still logged to console
      console.warn(`[REPAIR-AUDIT] Could not write to RepairAuditLog (non-critical): ${err.message}`);
    }

    return Response.json({
      success: true,
      audit_record: auditRecord,
      message: `Repair execution logged by ${user.email}`
    });
  } catch (error) {
    console.error('[REPAIR-AUDIT] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});