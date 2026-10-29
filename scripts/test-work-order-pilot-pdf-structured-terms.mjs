import assert from "node:assert/strict";
import fs from "node:fs";

const approvedPdf = fs.readFileSync("lib/workOrderApprovedPdf.server.ts", "utf8");
const renderer = fs.readFileSync("lib/workOrderPdfRenderer.server.ts", "utf8");

assert.match(approvedPdf, /structuredTermsFromSnapshot\(order\.standard_terms_snapshot\)/);
assert.match(approvedPdf, /standard_terms_clauses: standardTermsClauses \|\| undefined/);
assert.match(renderer, /const structuredTerms = normalizeStructuredTerms\(Array\.isArray\(row\.standard_terms_clauses\)/);
assert.match(renderer, /if \(structuredTerms\) structuredTerms\.forEach\(\(clause\) => clauseBlocks\.push/);
assert.match(renderer, /heading\("TERMS & CONDITIONS", 70\)/);
assert.match(renderer, /clauseBlocks\.forEach\(\(clause, clauseIndex\)/);
assert.match(renderer, /draw\(serial, LEFT, y - 4, TERMS_SIZE, true\)/);
console.log("Work Order approval PDF structured T&C contract: PASS");
