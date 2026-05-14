# NuVira Operations Hub — Row Level Security & Privilege Boundary Audit

**Date:** 2026-05-14  
**Status:** Function hardening complete | RLS assessment in progress  
**Risk Level:** Critical security infrastructure task

---

## Executive Summary

This document provides a comprehensive audit of:
1. **Function-level privilege boundaries** (completed ✅)
2. **Entity-level Row Level Security (RLS) policies** (assessment phase)
3. **Role-based access control matrix** (defined below)
4. **Operational continuity safeguards** (documented)

---

## Role Model Definition

NuVira Operations Hub uses the following role hierarchy:

| Role | Description | Access Scope |
|------|-------------|--------------|
| **customer** | Customer app users | Own orders, profile, loyalty points, bag returns |
| **driver** | Delivery drivers | Assigned deliveries only, route information |
| **staff** | General staff members | Limited operational read access, no mutations |
| **operations_staff** | Operations team | Production, fulfillment, inventory management |
| **production_manager** | Production supervisors | Full production batch control, compliance logs |
| **admin** | Administrators | Full system access, financial reports, user management |
| **service_role** | Automated systems | Unrestricted (automation, webhooks, scheduled tasks) |

---

## Function Hardening — Completed Fixes

### ✅ Fixed in This Session

| Function | Issue | Fix Applied | Status |
|----------|-------|-------------|--------|
| `auditProductionPlanningInclusion` | Broken role check `!user?.role === 'admin'` | Replaced with `user.role !== 'admin'` | ✅ Fixed |
| `recordDriverDelivery` | Any authenticated user could modify delivery | Restricted to assigned driver, admin, or operations_staff | ✅ Fixed |
| `completeBatchProduction` | No role validation for production/compliance mutation | Restricted to admin/production_manager/operations_staff | ✅ Fixed |
| `findAmarOrders` | Debug utility exposed customer PII | Admin-only + documented for removal | ✅ Fixed |
| `generateWeeklyReport` | Sensitive financial/operational reporting | Admin-only | ✅ Fixed |
| `getUsers` | PII exposure risk | Admin-only | ✅ Fixed |
| `syncBagReturnToCustomerApp` | Sensitive sync mutation path | Admin or internal secret (service-role) | ✅ Fixed |

### ✅ Previously Hardened (Session 1)

All 11 functions from the auth-hardening sprint:
- `processStripeRefund`
- `inviteUser`
- `createNotification`
- `orderStatusEmail`
- `checkDailyCompliance`
- `operationsOversight`
- `resolveProductionScheduleForFuture`
- `sendCustomerAppInvite`
- `validateComplianceEntry`
- `validateNuViraSchedule`
- `awardOrderPoints`

---

## Entity RLS Assessment — Priority Matrix

### 🔴 CRITICAL PRIORITY (Customer Data Isolation)

| Entity | Current State | Required RLS | Risk if Missing |
|--------|---------------|--------------|-----------------|
| **ShopifyOrder** | Unknown | Customers: own orders only. Staff: read. Admin/Ops: full. | Cross-customer data exposure |
| **LoyaltyMember** | Unknown | Customers: own profile only. Admin: full. | Points theft, fraud |
| **UserPoints** | Unknown | Customers: own transactions. Admin: full. | Financial fraud |
| **NuViraCredit** | Unknown | Customers: own credits. Admin: full. | Credit theft |
| **FulfillmentTask** | Unknown | Drivers: assigned only. Ops/Admin: full. | Route data exposure |

### 🟠 HIGH PRIORITY (Operational Security)

| Entity | Current State | Required RLS | Risk if Missing |
|--------|---------------|--------------|-----------------|
| **ProductionBatch** | Unknown | Ops/Production: full. Others: read-only or none. | Sabotage, data tampering |
| **ManualProductionBatch** | Unknown | Ops/Production: full. | Internal process exposure |
| **ComplianceLog** | Unknown | Admin/Compliance: full. Others: none. | Compliance violations |
| **TemperatureLog** | Unknown | Ops/Admin: read. Compliance: full. | Safety data manipulation |
| **InventoryItem** | Unknown | Ops: read. Admin: full. | Inventory manipulation |
| **Supplier** | Unknown | Admin/Purchasing: full. | Supplier data exposure |
| **PurchaseOrder** | Unknown | Admin/Purchasing: full. | Financial exposure |

### 🟡 MEDIUM PRIORITY (Internal Operations)

| Entity | Current State | Required RLS | Risk if Missing |
|--------|---------------|--------------|-----------------|
| **OrderReviewQueue** | Unknown | Admin only. | Operational intel exposure |
| **StripeEventLog** | Unknown | Admin only. | Payment intel exposure |
| **DeliveryApprovalRequest** | Unknown | Admin/Ops: full. Customers: own requests. | Pricing strategy exposure |
| **Zone3Waitlist** | Unknown | Admin only. | Customer PII exposure |
| **HubAlert** | Unknown | Admin/Ops: own alerts. | System intel exposure |

### 🟢 LOW PRIORITY (Reference Data)

| Entity | Current State | Required RLS | Risk if Missing |
|--------|---------------|--------------|-----------------|
| **Bundle** | Unknown | Read-only for all authenticated. | Minimal |
| **Recipe** | Unknown | Ops/Production: full. Others: read. | Recipe IP exposure |
| **Event** | Unknown | Read for all authenticated. | Minimal |
| **Resource** | Unknown | Read for all authenticated. | Minimal |

---

## RLS Implementation Strategy

### ⚠️ CRITICAL WARNING

**DO NOT apply generic auto-generated RLS policies** without validating:
1. **Service-role automations** continue functioning (scheduled tasks, entity automations, webhooks)
2. **Cross-entity calculations** (production planning, batch demand resolution) can read necessary data
3. **Driver portal workflows** can access assigned deliveries without friction
4. **Customer app sync operations** can read/write necessary order data

### Recommended Implementation Order

**Phase 1: Customer Data Isolation** (Week 1)
- ShopifyOrder (customer read isolation)
- LoyaltyMember (customer read isolation)
- UserPoints (customer read isolation)
- FulfillmentTask (driver assignment filtering)

**Phase 2: Operational Security** (Week 2)
- ProductionBatch (role-based write restrictions)
- ComplianceLog (admin/compliance only)
- InventoryItem (role-based write restrictions)

**Phase 3: Financial/Admin Isolation** (Week 3)
- PurchaseOrder (admin/purchasing only)
- Supplier (admin/purchasing only)
- StripeEventLog (admin only)
- OrderReviewQueue (admin only)

---

## Function Authorization Patterns

### Pattern 1: Admin-Only Functions
```javascript
const user = await base44.auth.me();
if (!user || user.role !== 'admin') {
  return Response.json({ error: 'Admin access required' }, { status: 403 });
}
```

### Pattern 2: Role-Based Access (Multiple Roles)
```javascript
const allowedRoles = ['admin', 'production_manager', 'operations_staff'];
if (!allowedRoles.includes(user.role)) {
  return Response.json({ error: 'Forbidden' }, { status: 403 });
}
```

### Pattern 3: Assignment-Based Access (Drivers)
```javascript
const isAssignedDriver = task.assigned_driver && task.assigned_driver.toLowerCase() === user.email.toLowerCase();
const isOperations = user.role === 'admin' || user.role === 'operations_staff';

if (!isAssignedDriver && !isOperations) {
  return Response.json({ error: 'Forbidden' }, { status: 403 });
}
```

### Pattern 4: Internal Secret (Service-Role Automation)
```javascript
const internalSecret = Deno.env.get('INTERNAL_FUNCTION_SECRET');
const isInternalCall = body._internalSecret && internalSecret && body._internalSecret === internalSecret;

if (!isInternalCall && (!user || user.role !== 'admin')) {
  return Response.json({ error: 'Admin or internal secret required' }, { status: 403 });
}
```

---

## Operational Continuity Safeguards

### Service-Role Automation Protection

All automations must use `base44.asServiceRole` to bypass RLS:
- ✅ Scheduled automations (recalculateProductionBatches, checkDailyCompliance)
- ✅ Entity automations (awardOrderPoints on paid order)
- ✅ Webhook handlers (stripeChargeRefundedWebhook)

### Cross-Entity Read Requirements

Functions that resolve production demand across entities need read access:
- `recalculateProductionBatches` reads: ShopifyOrder, FulfillmentTask, ManualProductionBatch, ProductionBatch
- `triggerBatchDemandForDate` reads: ShopifyOrder, ProductionBatch
- `getProductionPlanningData` reads: Multiple operational entities

**Recommendation:** These functions should be admin-only or use internal secret pattern.

---

## Testing Checklist

Before deploying RLS policies:

- [ ] **Customer isolation test:** Customer A cannot read Customer B's orders
- [ ] **Driver isolation test:** Driver can only read assigned deliveries
- [ ] **Staff limitation test:** Staff cannot mutate production/compliance records
- [ ] **Admin full access test:** Admin can read/write all entities
- [ ] **Automation continuity test:** All scheduled automations run successfully
- [ ] **Webhook continuity test:** Stripe webhooks process correctly
- [ ] **Entity automation test:** awardOrderPoints triggers on paid orders
- [ ] **Driver portal test:** Drivers can see and update assigned routes
- [ ] **Customer app sync test:** Order sync operations function correctly

---

## Next Steps

1. **Audit current RLS state** — Check each entity's current RLS policies
2. **Define explicit RLS rules** — Per entity, per role, per operation (read/create/update/delete)
3. **Implement Phase 1** — Customer data isolation (ShopifyOrder, LoyaltyMember, UserPoints)
4. **Test customer isolation** — Verify no cross-customer data exposure
5. **Implement Phase 2** — Operational security (ProductionBatch, ComplianceLog)
6. **Test automation continuity** — All automations still function
7. **Implement Phase 3** — Financial/admin isolation
8. **Final security validation** — Comprehensive penetration testing

---

## Security Findings Summary

### ✅ Resolved
- 7 additional functions hardened with proper role checks
- Broken role check syntax fixed (`!user?.role === 'admin'` → `user.role !== 'admin'`)
- Debug utilities restricted to admin-only
- Driver delivery recording restricted to assigned drivers
- Production completion restricted to authorized roles
- Sensitive sync operations restricted to admin/internal secret

### ⚠️ In Progress
- Entity-level RLS policies need definition and implementation
- Cross-entity read requirements need documentation
- Service-role automation paths need validation post-RLS

### 📋 Recommended Actions
1. Remove `findAmarOrders` from production (debug utility)
2. Add audit logging for sensitive operations (user list access, report generation)
3. Implement RLS Phase 1 (customer isolation)
4. Create RLS testing suite (automated validation)

---

**Document Status:** Living document — update as RLS implementation progresses