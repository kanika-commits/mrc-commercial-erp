import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "po-duplicate-lines-"));
const source = fs.readFileSync("lib/procurement/poRevisionComparison.ts", "utf8");
const output = path.join(temp, "comparison.mjs");
fs.writeFileSync(output, ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
const { buildPurchaseOrderRevisionComparison } = await import(output);
const previous = { id: "r0", items: [
  { item_id_snapshot: "same-item", item_code_snapshot: "SAME", item_name_snapshot: "Same item", quantity: 1, unit_rate: 56 },
  { item_id_snapshot: "same-item", item_code_snapshot: "SAME", item_name_snapshot: "Same item", quantity: 1, unit_rate: 63 },
] };
const current = { id: "r1", items: [
  { item_id_snapshot: "same-item", item_code_snapshot: "SAME", item_name_snapshot: "Same item", quantity: 1, unit_rate: 63 },
  { item_id_snapshot: "same-item", item_code_snapshot: "SAME", item_name_snapshot: "Same item", quantity: 1, unit_rate: 63 },
] };
const comparison = buildPurchaseOrderRevisionComparison(previous, current);
assert.equal(comparison.items.length, 2);
assert.deepEqual(comparison.items.map((item) => item.revision_line_key), ["same-item", "same-item#1"]);
assert.equal(comparison.items[0].fields.unit_rate.state, "changed");
assert.equal(comparison.items[1].fields.unit_rate.state, "unchanged");
assert.equal(comparison.items.some((item) => item.state === "removed"), false);
console.log("PO duplicate revision-line matching: PASS");
