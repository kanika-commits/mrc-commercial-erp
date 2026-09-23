import assert from "node:assert/strict";
import { actionableLineApprovers, groupedLineCycle, extractApprovalLevel, eventIdentity } from "../lib/notificationDecision.mjs";

const states = [
  { requisition_id: "r", requisition_item_line_key: "a", workflow_version: 1, submission_cycle: 2, current_approval_layer: 1, approval_status: "pending" },
  { requisition_id: "r", requisition_item_line_key: "b", workflow_version: 1, submission_cycle: 2, current_approval_layer: 2, approval_status: "pending" },
  { requisition_id: "r", requisition_item_line_key: "c", workflow_version: 1, submission_cycle: 2, current_approval_layer: 2, approval_status: "approved" },
  { requisition_id: "other", requisition_item_line_key: "x", workflow_version: 1, submission_cycle: 2, current_approval_layer: 1, approval_status: "pending" },
];
const steps = [
  { requisition_id: "r", requisition_item_line_key: "a", workflow_version: 1, submission_cycle: 2, layer_number: 1, approver_user_id: "A", status: "pending", organization_id: "o" },
  { requisition_id: "r", requisition_item_line_key: "a", workflow_version: 1, submission_cycle: 2, layer_number: 2, approver_user_id: "D", status: "pending", organization_id: "o" },
  { requisition_id: "r", requisition_item_line_key: "b", workflow_version: 1, submission_cycle: 2, layer_number: 2, approver_user_id: "B", status: "pending", organization_id: "o" },
  { requisition_id: "r", requisition_item_line_key: "c", workflow_version: 1, submission_cycle: 2, layer_number: 2, approver_user_id: "C", status: "approved", organization_id: "o" },
];
let result = actionableLineApprovers(states, steps, { requisitionId: "r", organizationId: "o", activeIds: new Set(["A", "B", "C", "D"]), permittedIds: new Set(["A", "B", "C", "D"]) });
assert.deepEqual(new Set(result.recipientIds), new Set(["A", "B"]));
assert.equal(groupedLineCycle(result.rows), "1:2:1|1:2:2");
assert.deepEqual(actionableLineApprovers(states, steps, { requisitionId: "r", organizationId: "o", actorId: "A", activeIds: new Set(["A", "B"]), permittedIds: new Set(["A", "B"]) }).recipientIds, ["B"]);
assert.deepEqual(actionableLineApprovers(states, steps, { requisitionId: "r", organizationId: "o", activeIds: new Set(["A"]), permittedIds: new Set(["A"]) }).recipientIds, ["A"]);
assert.equal(extractApprovalLevel({ approval_layers: [{ layer_number: 2, approver_user_id: "B" }] }), 2);
assert.equal(extractApprovalLevel({ approval_layers: [{ unknown: 2 }] }), null);
assert.notEqual(eventIdentity({ eventType: "awaiting", entityType: "attendance", entityId: "x", cycleId: "c", stage: 1 }), eventIdentity({ eventType: "awaiting", entityType: "attendance", entityId: "x", cycleId: "c", stage: 2 }));
assert.equal(eventIdentity({ eventType: "awaiting", entityType: "attendance", entityId: "x", cycleId: "c", stage: 1 }), eventIdentity({ eventType: "awaiting", entityType: "attendance", entityId: "x", cycleId: "c", stage: 1 }));
console.log("Notification Phase 2B executable behavior tests passed.");
