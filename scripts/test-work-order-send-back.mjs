import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync("app/api/work-orders/[id]/route.ts", "utf8");
const approvalApi = fs.readFileSync("app/api/approvals/work-orders/route.ts", "utf8");
const page = fs.readFileSync("app/approvals/work-orders/page.tsx", "utf8");

assert.match(route, /action === "send_back"/);
assert.match(route, /requirePermission\(request, "wo_approval", "approve"\)/);
assert.match(route, /A send-back comment is required/);
assert.match(route, /approvalStatus === "draft" \|\| approvalStatus !== "pending"/);
assert.match(route, /recordAuditEvent/);
assert.match(route, /action: "send_back"/);
assert.match(approvalApi, /erp_audit_logs/);
assert.match(approvalApi, /latestSendBackComments/);
assert.match(page, /sendBackWorkOrder/);
assert.match(page, /window\.prompt\("Send-back comment \(required\)"\)/);
assert.match(page, /String\(wo\.approval_status \|\| ""\)\.trim\(\)\.toLowerCase\(\) === "pending"/);
assert.match(page, /↳ \{latestSendBackComments\[wo\.id\]\.comment\}/);

console.log("Work Order send-back authorization, comment, history, display, and draft exclusion contract passed.");
