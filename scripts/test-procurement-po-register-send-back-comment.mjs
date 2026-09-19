import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const source = read("../lib/procurement/poSendBackPresentation.ts");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const helper = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const event = (purchase_order_id, event_note, created_at, event_type = "send_back") => ({
  id: `${purchase_order_id}-${created_at}`,
  purchase_order_id,
  event_type,
  event_note,
  created_at,
});

const directComment = helper.attachCurrentSendBackComments(
  [{ id: "po-a", status: "sent_back", revision_no: 0 }],
  [event("po-a", "Please correct the rate for Item 3.", "2026-09-19T11:00:00Z")],
);
assert.equal(directComment[0].latest_send_back_comment, "Please correct the rate for Item 3.", "current Sent Back row receives its authoritative event note");

const longComment = "Please correct the rate for Item 3. ".repeat(20);
const longResult = helper.attachCurrentSendBackComments(
  [{ id: "po-long", status: "sent_back" }],
  [event("po-long", longComment, "2026-09-19T12:00:00Z")],
);
assert.equal(longResult[0].latest_send_back_comment, longComment.trim(), "long comment remains intact in the API value for UI truncation and tooltip");

for (const status of ["approved", "draft", "pending_approval", "issued", "rejected"]) {
  const hidden = helper.attachCurrentSendBackComments(
    [{ id: `po-${status}`, status }],
    [event(`po-${status}`, "Historical send-back reason", "2026-09-19T13:00:00Z")],
  );
  assert.equal(hidden[0].latest_send_back_comment, null, `${status} row hides historical send-back notes`);
}

const currentRevision = helper.attachCurrentSendBackComments(
  [{ id: "po-r1", status: "sent_back", revision_no: 1, revision_indicator: "Revision in Progress" }],
  [
    event("po-r0", "Old R-0 reason", "2026-09-18T09:00:00Z"),
    event("po-r1", "Current R-1 reason", "2026-09-19T09:00:00Z"),
    event("po-r1", "Latest R-1 approval-cycle reason", "2026-09-19T11:00:00Z"),
  ],
);
assert.equal(currentRevision[0].latest_send_back_comment, "Latest R-1 approval-cycle reason", "latest Send Back event for the current revision and approval cycle wins");

const noCurrentSendBack = helper.attachCurrentSendBackComments(
  [{ id: "po-r1-approved", status: "approved", revision_no: 1, revision_indicator: "Current" }],
  [event("po-r0", "Previous revision reason", "2026-09-18T09:00:00Z")],
);
assert.equal(noCurrentSendBack[0].latest_send_back_comment, null, "previous revision reason never appears on a current revision without Send Back");

const register = read("../app/purchase/purchase-orders/page.tsx");
const route = read("../app/api/procurement/purchase-orders/route.ts");
const workflowRoute = read("../app/api/procurement/purchase-orders/[id]/route.ts");
const migration = read("../supabase/migrations/202609120004_procurement_po_revision_stage_c1_workflow.sql");
assert.ok(migration.includes("event_type,event_note") && migration.includes("values(v_po.id,p_action,p_note"), "persisted send-back reason is procurement_purchase_order_events.event_note");
assert.ok(workflowRoute.includes('action === "send_back"') && workflowRoute.includes("p_note: text(body.note)"), "send-back API persists the entered reason as event note");
assert.ok(route.includes('from("procurement_purchase_order_events")') && route.includes('.eq("event_type", "send_back")') && route.includes('attachCurrentSendBackComments'), "register loads send-back history in one batched query and matches current PO ids");
assert.ok(register.includes('row.status === "sent_back" && row.latest_send_back_comment') && register.includes("line-clamp-2") && register.includes('title={String(row.latest_send_back_comment)}'), "register shows a two-line red reason with full text available by tooltip only for Sent Back");
assert.ok(register.includes("row.revision_indicator") && route.includes('revision_indicator: open ? "Revision in Progress" : effective ? "Current" : "Historical"'), "existing revision indicators are preserved");

console.log("PO register Send Back comment and revision safety: PASS");
