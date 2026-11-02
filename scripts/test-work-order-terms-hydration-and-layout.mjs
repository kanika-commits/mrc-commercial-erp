import assert from "node:assert/strict";
import fs from "node:fs";

const helper = fs.readFileSync("lib/workOrderDraftSelections.ts", "utf8");
const renderer = fs.readFileSync("lib/workOrderPdfRenderer.server.ts", "utf8");
const form = fs.readFileSync("app/work-orders/new/structured/page.tsx", "utf8");

assert.match(helper, /savedId = text\(parsed\?\.terms_template_id/);
assert.match(helper, /savedName = text\(parsed\?\.template_name/);
assert.match(helper, /const byId = templates\.find/);
assert.match(form, /matchSavedTermsTemplateId\(savedMasterSnapshot \|\| form\.standard_terms_snapshot, authorizedTerms\)/);
assert.match(form, /matchSavedTermsTemplateId\(form\.standard_terms_snapshot, authorizedTerms\)/);
assert.match(form, /setForm\(\(current: any\) => current\.terms_template_id === matchedId/);
assert.match(renderer, /saved terms\(\?: &\| and\) conditions/);
assert.match(renderer, /const withoutMetadata = normalized\.filter/);
assert.match(renderer, /withoutMetadata\[0\]\.clause_body\.split/);
assert.match(renderer, /const structuredTerms = normalizeStructuredTerms/);
assert.match(renderer, /draw\(`\$\{clauseIndex \+ 1\}\.`, LEFT, y - 4, TERMS_SIZE, true\)/);
assert.match(renderer, /draw\(line, LEFT \+ 18, y - 4, TERMS_SIZE, true\)/);
assert.match(renderer, /draw\(line, LEFT \+ 18, y - 4, TERMS_SIZE, false\)/);

console.log("Work Order Terms master hydration and PDF clause layout contract passed.");
