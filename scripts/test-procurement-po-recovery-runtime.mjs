import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync("lib/procurement/contractorRecoveryCore.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(compiled, { module, exports: module.exports, console });
const core = module.exports;

const po = {
  id: "po-1", organization_id: "org-1", company_id: "company-1", site_id: "site-1",
  po_number: "MRC/OCT/2026/0015/R-0", vendor_id: "vendor-1", purpose: "Recover from contractor",
  total_basic_amount: 100, total_gst_amount: 18, total_amount: 118,
};
const workOrder = { id: "wo-1", organization_id: "org-1", company_id: "company-1", site_id: "site-1" };
const documents = [{ id: "doc-1", storage_key: "po/doc-1.pdf" }];
const note = "Recover from contractor";
const actor = { name: "Tester", email: "tester@example.com" };

const defaultRecovery = core.validateRecovery("Standard", "");
assert.equal(defaultRecovery.purpose, "General Purchase");
assert.equal(defaultRecovery.workOrderId, null);
assert.throws(() => core.validateRecovery("Recover from contractor", ""), /Work Order is required/);

let linked = null;
let insertAttempts = 0;
const notifications = new Set();
const calls = [];
const deps = {
  db: {
    findBySourcePurchaseOrder: async (organizationId, sourcePurchaseOrderId) => {
      calls.push(["find", organizationId, sourcePurchaseOrderId]);
      return { data: linked, error: null };
    },
    insertDebitNote: async (payload) => {
      insertAttempts += 1;
      assert.equal(payload.source_purchase_order_id, po.id);
      assert.equal(payload.work_order_id, workOrder.id);
      assert.equal(payload.gross_amount, 100);
      assert.equal(payload.gst_amount, 18);
      assert.equal(payload.total_amount, 118);
      assert.deepEqual(payload.source_purchase_order_documents, documents);
      linked = { id: "dn-1", status: "Draft", approval_status: "Pending", source_purchase_order_id: po.id };
      return { data: linked, error: null };
    },
  },
  resolveRecipients: async (scope) => {
    assert.equal(scope.organizationId, "org-1");
    assert.equal(scope.companyId, "company-1");
    assert.equal(scope.siteId, "site-1");
    return ["user-1", "user-2"];
  },
  insertNotification: async ({ recipientUserId, debitNoteId }) => {
    notifications.add(`${recipientUserId}:${debitNoteId}`);
  },
};

const created = await core.ensureRecoveryDraft(deps, po, workOrder, documents, note, actor);
assert.equal(created.id, "dn-1");
assert.equal(insertAttempts, 1);
await core.ensureRecoveryDraft(deps, po, workOrder, documents, note, actor);
assert.equal(insertAttempts, 1, "existing exact-source draft must be reused");
assert.equal(notifications.size, 2, "notification retries must be idempotent in the fake store");

linked = null;
insertAttempts = 0;
let reread = false;
const conflictDeps = {
  ...deps,
  db: {
    findBySourcePurchaseOrder: async () => ({ data: reread ? { id: "dn-conflict", status: "Draft" } : null, error: null }),
    insertDebitNote: async () => { reread = true; return { data: null, error: { code: "23505" } }; },
  },
};
const conflict = await core.ensureRecoveryDraft(conflictDeps, po, workOrder, documents, note, actor);
assert.equal(conflict.id, "dn-conflict", "duplicate-key retry must reread the exact source PO");

linked = null;
insertAttempts = 0;
const notificationFailureDeps = {
  ...deps,
  db: {
    findBySourcePurchaseOrder: async () => ({ data: linked, error: null }),
    insertDebitNote: async (payload) => {
      insertAttempts += 1;
      linked = { id: "dn-notification-failure", source_purchase_order_id: payload.source_purchase_order_id, status: "Draft" };
      return { data: linked, error: null };
    },
  },
  resolveRecipients: async () => { throw new Error("simulated notification lookup failure"); },
};
const completedDespiteNotificationFailure = await core.ensureRecoveryDraft(notificationFailureDeps, po, workOrder, documents, note, actor);
assert.equal(completedDespiteNotificationFailure.id, "dn-notification-failure");
assert.equal(insertAttempts, 1, "notification failure must not roll back Debit Note creation");
await core.ensureRecoveryDraft(notificationFailureDeps, po, workOrder, documents, note, actor);
assert.equal(insertAttempts, 1, "retry after notification failure must reuse the existing Debit Note");

assert.throws(() => core.assertRecoveryApprovalAllowed({ source_purchase_order_id: po.id }, { id: po.id, status: "pending" }), /cannot be approved/);
assert.equal(core.assertRecoveryApprovalAllowed({ source_purchase_order_id: po.id }, { id: po.id, status: "approved" }), true);
assert.equal(core.assertRecoveryApprovalAllowed({ source_purchase_order_id: null }, null), true, "manual notes retain existing approval behavior");

const editable = core.assertEditableRecoveryDraft(
  { id: "dn-1", status: "Draft", approval_status: "Pending", source_purchase_order_id: po.id, work_order_id: workOrder.id, organization_id: po.organization_id },
  { ...po, recovery_work_order_id: workOrder.id },
  workOrder,
  { reason: "updated", total_amount: 999, source_purchase_order_id: "other" },
);
assert.equal(editable.reason, "updated", "editable recovery fields should be retained");
assert.equal(Object.keys(editable).length, 1, "PO-derived linkage and amounts must remain immutable");
assert.throws(() => core.assertEditableRecoveryDraft({ status: "Submitted", source_purchase_order_id: po.id }, po, workOrder, {}), /drafts are editable/);

const manifestNote = { source_purchase_order_id: po.id, work_order_id: workOrder.id, organization_id: po.organization_id };
assert.equal(core.manifestAllows(documents, { id: "doc-1" }, manifestNote, po, workOrder), true);
assert.equal(core.manifestAllows([], { id: "doc-1" }, manifestNote, po, workOrder), false);
assert.equal(core.manifestAllows(documents, { id: "doc-1" }, manifestNote, { ...po, id: "other" }, workOrder), false);
assert.equal(core.manifestAllows(documents, { id: "doc-1" }, manifestNote, po, { ...workOrder, site_id: "other" }), false);

console.log("procurement PO recovery runtime tests passed");
