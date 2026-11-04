import assert from "node:assert/strict";
import ts from "typescript";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../lib/procurement/poTermsTemplateSelection.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const helper = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const snapshot = JSON.stringify({ template_id: "wo-template", template_name: "WO T&C", clauses: [
  { heading: "Order of Precedence", clause_body: "PO wording", sort_order: 0 },
  { heading: "Payment", clause_body: "Pay by PO terms", sort_order: 1 },
] });
const match = helper.findSavedPurchaseOrderTermsTemplate(snapshot, [
  { id: "wo-template", template_name: "WO T&C", sections: [{ heading: "Order of Precedence", clause_body: "WO wording", sort_order: 0 }, { heading: "Payment", clause_body: "WO payment", sort_order: 1 }] },
  { id: "po-template", template_name: "MRC Tech Solutions- PO T&C", sections: [{ heading: "Order of Precedence", clause_body: "PO wording", sort_order: 0 }, { heading: "Payment", clause_body: "Pay by PO terms", sort_order: 1 }] },
]);
assert.equal(match?.id, "po-template");
console.log("PO saved Terms template selection: PASS");
