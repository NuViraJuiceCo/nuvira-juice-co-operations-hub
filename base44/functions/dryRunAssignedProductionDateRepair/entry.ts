import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const affectedOrderNumbers = [
      'NV-MOOPFCUS',
      'NV-MOOV82PT',
      'NV-MOPV2CIK',
      'NV-MON367R7'
    ];

    // Fetch all orders and search for affected ones
    const allOrders = await base44.entities.ShopifyOrder.list('-created_date', 500);
    const affectedOrders = allOrders.filter(o => 
      affectedOrderNumbers.includes(o.shopify_order_number)
    );

    // Fetch batches and tasks
    const allBatches = await base44.entities.ProductionBatch.list('-production_date', 500);
    const allTasks = await base44.entities.FulfillmentTask.list('-scheduled_date', 500);

    // Dry run analysis
    const dryRunResults = affectedOrders.map(order => {
      const isPaymentValid = ['paid', 'captured'].includes(order.payment_status);
      const isNotCanceled = !order.canceled_at && !order.refunded_at && !order.deleted_at;
      const isNotFlagged = order.do_not_recover !== true && !['test', 'quarantined'].includes(order.data_quality_status);
      const hasData = order.customer_email && order.address_line1 && order.line_items?.length > 0;
      
      const currentDeliveryDate = order.assigned_delivery_date;
      const currentProductionDate = order.assigned_production_date;
      
      const batch = allBatches.find(b => 
        b.production_date === '2026-05-05' && 
        b.order_sources?.some(s => s.order_id === order.id)
      );
      
      const tasks = allTasks.filter(t => t.order_id === order.id);
      const taskFor0506 = tasks.find(t => t.scheduled_date === '2026-05-06');
      
      const isRepairCandidate = 
        isPaymentValid && isNotCanceled && isNotFlagged && hasData &&
        currentDeliveryDate === '2026-05-06' &&
        !currentProductionDate && // missing assigned_production_date
        batch && taskFor0506;

      return {
        order_number: order.shopify_order_number,
        customer_name: order.customer_name,
        current_assigned_production_date: currentProductionDate || null,
        current_assigned_delivery_date: currentDeliveryDate,
        payment_status: order.payment_status,
        data_quality_status: order.data_quality_status,
        validation: {
          payment_valid: isPaymentValid,
          not_canceled: isNotCanceled,
          not_flagged: isNotFlagged,
          has_data: hasData,
          delivery_date_correct: currentDeliveryDate === '2026-05-06',
          production_date_missing: !currentProductionDate,
          batch_exists: !!batch,
          task_exists: !!taskFor0506,
        },
        is_repair_candidate: isRepairCandidate,
        proposed_update: isRepairCandidate ? {
          field: 'assigned_production_date',
          new_value: '2026-05-05',
          reason: 'Backfill missing production date for verified May 5 production cycle'
        } : null,
        issues: [
          !isPaymentValid && `Payment status ${order.payment_status} not valid (need paid/captured)`,
          !isNotCanceled && 'Order is canceled/refunded/deleted',
          !isNotFlagged && `Data quality flagged: ${order.data_quality_status}`,
          !hasData && 'Missing customer email, address, or line items',
          currentDeliveryDate !== '2026-05-06' && `Delivery date is ${currentDeliveryDate}, expected 2026-05-06`,
          currentProductionDate && `Already has assigned_production_date: ${currentProductionDate}`,
          !batch && 'No ProductionBatch found for 2026-05-05',
          !taskFor0506 && 'No FulfillmentTask found for 2026-05-06',
        ].filter(Boolean)
      };
    });

    const repairCandidates = dryRunResults.filter(r => r.is_repair_candidate);
    const blockedOrders = dryRunResults.filter(r => !r.is_repair_candidate && r.issues.length > 0);

    return Response.json({
      status: 'dry_run_complete',
      timestamp: new Date().toISOString(),
      total_orders_analyzed: affectedOrders.length,
      repair_candidates: repairCandidates.length,
      blocked_orders: blockedOrders.length,
      repair_candidates_detail: repairCandidates,
      blocked_orders_detail: blockedOrders,
      safe_to_proceed: repairCandidates.length > 0 && blockedOrders.length === 0,
      proposed_updates: repairCandidates.map(r => ({
        order_number: r.order_number,
        update: r.proposed_update
      }))
    });
  } catch (error) {
    console.error('Dry run error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});