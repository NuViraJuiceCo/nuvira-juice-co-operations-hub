import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Allow scheduled automation (internal secret) or admin users
    const internalSecret = Deno.env.get('INTERNAL_FUNCTION_SECRET');
    let isInternalCall = false;
    try {
      const body = await req.clone().json();
      isInternalCall = body._internalSecret && internalSecret && body._internalSecret === internalSecret;
    } catch (_) {}
    if (!isInternalCall) {
      const user = await base44.auth.me();
      if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
      if (user.role !== 'admin') return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const today = new Date().toISOString().split('T')[0];

    // Get today's logs
    const [tempLogs, phLogs, ccpLogs, sanitationLogs, checklists] = await Promise.all([
      base44.asServiceRole.entities.TemperatureLog.list('-log_date', 500),
      base44.asServiceRole.entities.pHLog.list('-log_date', 500),
      base44.asServiceRole.entities.CCPLog.list('-log_date', 500),
      base44.asServiceRole.entities.SanitationLog.list('-log_date', 500),
      base44.asServiceRole.entities.DailyChecklist.list('-checklist_date', 500),
    ]);

    // Filter for today
    const todayTemp = tempLogs.filter(l => l.log_date === today);
    const todayPH = phLogs.filter(l => l.log_date === today);
    const todayCCP = ccpLogs.filter(l => l.log_date === today);
    const todaySan = sanitationLogs.filter(l => l.log_date === today);
    const todayChecklists = checklists.filter(l => l.checklist_date === today);

    const issues = [];

    // Check temperature logs (should have at minimum 2 per location)
    const locations = ['Cold Room 1', 'Cold Room 2', 'Freezer', 'Walk-in Cooler'];
    locations.forEach(loc => {
      const count = todayTemp.filter(l => l.location === loc).length;
      if (count < 2) {
        issues.push({
          type: 'Missing Log',
          severity: 'High',
          message: `Only ${count} temperature log(s) for ${loc}. Need at least 2.`,
        });
      }
    });

    // Check out of range values
    todayTemp.forEach(log => {
      if (log.within_range === false) {
        issues.push({
          type: 'Out of Range',
          severity: 'High',
          message: `Temperature ${log.temperature}°C out of range at ${log.location}. Corrective action required.`,
          log_id: log.id,
        });
      }
    });

    todayPH.forEach(log => {
      if (log.within_range === false) {
        issues.push({
          type: 'Failure',
          severity: 'Critical',
          message: `pH ${log.ph_value} out of range for batch ${log.batch_id}. Immediate action required.`,
          log_id: log.id,
        });
      }
    });

    todayCCP.forEach(log => {
      if (log.result === 'Fail') {
        issues.push({
          type: 'Failure',
          severity: 'Critical',
          message: `CCP FAILED: ${log.ccp_point} for batch ${log.batch_id}. Critical action required.`,
          log_id: log.id,
        });
      }
    });

    // Check checklist completion
    todayChecklists.forEach(checklist => {
      if (checklist.overall_status === 'Incomplete') {
        issues.push({
          type: 'Incomplete Checklist',
          severity: 'Medium',
          message: `Daily checklist incomplete for ${checklist.staff_member} (${checklist.shift} shift).`,
          log_id: checklist.id,
        });
      }
    });

    // Create alerts for each issue
    for (const issue of issues) {
      await base44.asServiceRole.entities.ComplianceAlert.create({
        alert_type: issue.type,
        severity: issue.severity,
        message: issue.message,
        triggered_date: today,
        triggered_time: new Date().toISOString().split('T')[1].slice(0, 5),
        status: 'Active',
        related_log_id: issue.log_id || null,
      });
    }

    console.log(`[COMPLIANCE] Daily check: ${issues.length} issues found`);

    return Response.json({
      date: today,
      issues_found: issues.length,
      issues,
      summary: {
        temperature_logs: todayTemp.length,
        pH_logs: todayPH.length,
        CCP_logs: todayCCP.length,
        sanitation_logs: todaySan.length,
        checklists_completed: todayChecklists.filter(c => c.overall_status === 'Complete').length,
        checklists_incomplete: todayChecklists.filter(c => c.overall_status === 'Incomplete').length,
      },
    });
  } catch (error) {
    console.error('checkDailyCompliance error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});