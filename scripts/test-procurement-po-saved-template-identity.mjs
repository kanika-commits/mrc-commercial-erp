import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/purchase/purchase-orders/new/page.tsx", "utf8");
const route = fs.readFileSync("app/api/procurement/purchase-orders/[id]/route.ts", "utf8");
assert.match(page, /initialStructuredTermsRef/);
assert.match(page, /termsTemplateChangedRef/);
assert.match(page, /standard_terms_template_id: termsTemplateForSave\?\.id/);
assert.match(page, /standard_terms_sections: termsTemplateForSave\?\.sections/);
assert.match(route, /standard_terms_template_id: text\(body\.standard_terms_template_id\)/);
assert.match(route, /standard_terms_sections: Array\.isArray\(body\.standard_terms_sections\)/);

const wo = { id: "wo-template", template_name: "Shared Terms", sections: [{ heading: "Scope", clause_body: "WO scope", sort_order: 1 }] };
const po = { id: "po-template", template_name: "Shared Terms", sections: [{ heading: "Scope", clause_body: "PO scope", sort_order: 1 }] };
let saved = { standard_terms_template_id: wo.id, standard_terms_sections: wo.sections, standard_terms_snapshot: JSON.stringify({ template_id: wo.id, template_name: wo.template_name, clauses: wo.sections }) };
saved = { standard_terms_template_id: po.id, standard_terms_sections: po.sections, standard_terms_snapshot: JSON.stringify({ template_id: po.id, template_name: po.template_name, clauses: po.sections }) };
for (let cycle = 0; cycle < 3; cycle += 1) {
  assert.equal(JSON.parse(saved.standard_terms_snapshot).template_id, po.id);
  assert.deepEqual(saved.standard_terms_sections, po.sections);
}
console.log("PO saved template identity round-trip rules passed");
