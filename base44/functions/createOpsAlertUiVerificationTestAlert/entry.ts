import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ALERT_TITLE = 'G12C2B UI verification alert';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    // Idempotency: return existing active alert if it already exists
    const existing = await base44.entities.HubAlert.filter({
      title: ALERT_TITLE,
      status: 'unread',
    });

    if (existing && existing.length > 0) {
      return Response.json({
        status: 'exists',
        alert: existing[0],
      });
    }

    // Create exactly one safe verification alert — use user-scoped client so RLS
    // evaluates against the authenticated admin user (role=admin satisfies the create rule)
    const alert = await base44.entities.HubAlert.create({
      title: ALERT_TITLE,
      message: 'Safe admin-only UI command verification. No customer, provider, order, delivery, production, inventory, or review queue context.',
      category: 'System',
      severity: 'info',
      status: 'unread',
      source: 'admin_verification',
    });

    return Response.json({
      status: 'created',
      alert,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});