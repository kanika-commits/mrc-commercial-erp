import assert from "node:assert/strict";
import fs from "node:fs";

const create = fs.readFileSync("app/api/work-orders/create/route.ts", "utf8");
const approvedPdf = fs.readFileSync("lib/workOrderApprovedPdf.server.ts", "utf8");
const submitPreview = fs.readFileSync("app/work-orders/new/structured/preview/page.tsx", "utf8");
const renderer = fs.readFileSync("lib/workOrderPdfRenderer.server.ts", "utf8");

// The create payload must persist the same contact and structured terms data shown by preview.
assert.match(create, /contact_person: primaryVendorContact\.contact_name/);
assert.match(create, /phone: primaryVendorContact\.contact_number/);
assert.match(create, /email: primaryVendorContact\.email/);
assert.match(create, /standard_terms_snapshot: JSON\.stringify\(standardTermsClauses\)/);

// Approval reload must stay organization-scoped and resolve authorized master/snapshot fallbacks.
assert.match(approvedPdf, /from\("companies"\)\.select\("id,organization_id,company_name,status"\)/);
assert.match(approvedPdf, /\.eq\("organization_id", order\.organization_id\)/);
assert.match(approvedPdf, /contact_person: vendorSnapshot\.contact_person \|\| vendorSnapshot\.contact_name \|\| primaryVendorContact\.contact_name/);
assert.match(approvedPdf, /standard_terms_clauses: standardTermsClauses \|\| undefined/);
assert.match(renderer, /Array\.isArray\(row\.standard_terms_clauses\)/);
assert.match(renderer, /draw\(serial, LEFT, y - 4, TERMS_SIZE, true\)/);
assert.doesNotMatch(renderer, /drawTermsHeader/);

// Successful creation must land on the existing Work Order detail/review route.
assert.match(submitPreview, /router\.push\(`\/work-orders\/\$\{result\.workOrder\.id\}`\)/);
assert.doesNotMatch(submitPreview, /router\.push\(`\/work-orders\/\$\{result\.workOrder\.id\}\/preview`\)/);

console.log("Work Order pilot submit/approval PDF contract: PASS");
