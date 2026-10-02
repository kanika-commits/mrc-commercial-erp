import assert from "node:assert/strict";
import fs from "node:fs";

const renderer = fs.readFileSync("lib/procurement/poPdfRenderer.server.ts", "utf8");
const route = fs.readFileSync("app/api/procurement/purchase-orders/[id]/pdf/route.ts", "utf8");
const workOrderRenderer = fs.readFileSync("lib/workOrderPdfRenderer.server.ts", "utf8");

assert.match(route, /from "@\/lib\/procurement\/poPdfRenderer\.server"/);
assert.match(renderer, /function numberedTerms\(snapshot: unknown\)/);
assert.match(renderer, /parsed\.clauses\.flatMap\(\(clause, index\) => \[`\$\{index \+ 1\}\. /);
assert.match(renderer, /return normalized\.level === "main" \? `\$\{\+\+clauseNumber\}\. /);
for (const heading of ["order of precedence", "acceptance & authority", "price, quantity & escalation", "insurance", "indemnity", "set-off & recovery", "confidentiality", "discretion", "discharge"]) {
  assert.match(renderer, new RegExp(heading));
}
assert.ok(renderer.includes("buyer['’]s"));
assert.match(renderer, /const PO_HEADER_FILL = "0\.93 0\.95 0\.97"/);
assert.match(renderer, /const WORK_ORDER_HEADER_FILL = "0\.98 0\.91 0\.91"/);
assert.match(renderer, /row\.work_order_render \? WORK_ORDER_HEADER_FILL : PO_HEADER_FILL/);
assert.ok(workOrderRenderer.includes("const HEADER_FILL = rgb(0.93, 0.86, 0.86);"));
assert.match(renderer, /spacingBefore: 1, spacingAfter: 0, bold: true/);
assert.match(renderer, /spacingBefore: 0, spacingAfter: 0, bold: false/);
assert.match(renderer, /const trimmed = raw\.trim\(\); if \(!trimmed\) return;/);
assert.match(renderer, /if \(parsed\.marker\) draw\(parsed\.marker, parsed\.indent, y, TERMS_SIZE, parsed\.bold\)/);
assert.match(renderer, /draw\(lineText, textX, y, TERMS_SIZE, parsed\.bold\)/);
assert.doesNotMatch(renderer, /workOrderRenderer|lib\/workOrderPdfRenderer/);
assert.ok(workOrderRenderer.includes("const isClauseHeading = /^\\s*\\d+\\.\\s+\\S/.test(termLine);"));

console.log("PO PDF terms formatting isolation rules passed.");
