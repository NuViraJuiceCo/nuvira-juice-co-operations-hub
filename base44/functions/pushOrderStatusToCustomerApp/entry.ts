Deno.serve(() => {
  console.log('[PUSH-STATUS] Disabled direct Hub to Customer App status push requested');
  return Response.json({
    deprecated: true,
    mutated: false,
    replacement: 'syncHubDeliveryStatuses',
    message: 'pushOrderStatusToCustomerApp is disabled. Customer App status readback is pull-based through syncHubDeliveryStatuses.',
  }, { status: 410 });
});
