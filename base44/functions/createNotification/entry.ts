import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();

    const { title, message, type, user_email } = body;

    // Validate required fields
    if (!title || !message || !type) {
      return Response.json(
        { error: 'Missing required fields: title, message, type' },
        { status: 400 }
      );
    }

    // Create the notification
    const notification = await base44.entities.Notification.create({
      title,
      message,
      type,
      user_email: user_email || null,
      read: false,
    });

    return Response.json({ success: true, notification }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});