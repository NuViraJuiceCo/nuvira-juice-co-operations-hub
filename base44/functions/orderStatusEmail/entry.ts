Deno.serve(async () => {
  return Response.json({
    deprecated: true,
    mutated: false,
    replacement: 'syncHubDeliveryStatuses + Customer App sendOrderStatusNotification',
    message: 'Hub direct customer-facing notification bridge is disabled. Customer App owns customer-facing notifications.',
  }, { status: 410 });
});
