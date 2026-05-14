import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    // Admin-only: PII exposure risk
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required — user list is admin-only' }, { status: 403 });
    }

    // Use service role to bypass RLS
    const users = await base44.asServiceRole.entities.User.list('-created_date', 200);
    return Response.json({ users });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});