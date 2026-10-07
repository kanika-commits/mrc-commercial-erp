import assert from "node:assert/strict";
import fs from "node:fs";

const approvedPdf = fs.readFileSync("lib/workOrderApprovedPdf.server.ts", "utf8");
const renderer = fs.readFileSync("lib/workOrderPdfRenderer.server.ts", "utf8");

assert.match(approvedPdf, /JSON\.parse\(String\(order\.standard_terms_snapshot/);
assert.match(approvedPdf, /standard_terms_clauses: standardTermsClauses \|\| undefined/);
assert.match(renderer, /const structuredTerms = Array\.isArray\(row\.standard_terms_clauses\)/);
assert.match(renderer, /structuredTerms\.forEach\(\(clause: any\) => clauseBlocks\.push/);
assert.match(renderer, /drawTermsHeader/);
assert.match(renderer, /draw\("S\.No\.", LEFT \+ rowPadding/);
assert.match(renderer, /draw\("Description", LEFT \+ serialWidth \+ rowPadding/);
assert.match(renderer, /draw\("Terms", LEFT \+ serialWidth \+ headingWidth \+ rowPadding/);
assert.match(renderer, /draw\(String\(clauseIndex \+ 1\)/);
console.log("Work Order approval PDF structured T&C contract: PASS");
