import assert from "node:assert/strict";
import fs from "node:fs";

const helper = fs.readFileSync("lib/workOrderDraftSelections.ts", "utf8");
const renderer = fs.readFileSync("lib/workOrderPdfRenderer.server.ts", "utf8");
const form = fs.readFileSync("app/work-orders/new/structured/page.tsx", "utf8");

assert.match(helper, /savedId = text\(parsed\?\.terms_template_id/);
assert.match(helper, /savedName = text\(parsed\?\.template_name/);
assert.match(helper, /const byId = templates\.find/);
assert.match(form, /mergeWorkOrderDraftLookupOptions\(nextLookups, draft\)/);
assert.match(form, /matchSavedTermsTemplateId\(form\.standard_terms_snapshot, lookups\.terms_templates\)/);
assert.match(form, /setForm\(\(current: any\) => current\.terms_template_id === matchedId/);
assert.match(renderer, /const structuredTerms = normalizeStructuredTerms/);
assert.match(renderer, /draw\(`\$\{clauseIndex \+ 1\}\.`, LEFT, y - 4, TERMS_SIZE, true\)/);
assert.match(renderer, /draw\(line, LEFT \+ 18, y - 4, TERMS_SIZE, true\)/);
assert.match(renderer, /draw\(line, LEFT \+ 18, y - 4, TERMS_SIZE, false\)/);

console.log("Work Order Terms master hydration and PDF clause layout contract passed.");
