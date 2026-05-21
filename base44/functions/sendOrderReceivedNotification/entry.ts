Deno.serve(async () => {
  return Response.json({
    deprecated: true,
    mutated: false,
    replacement: 'Customer App Stripe webhook order confirmation path',
    message: 'Hub direct customer-facing notification bridge is disabled. Customer App owns customer-facing notifications.',
  }, { status: 410 });
});
