import assert from "node:assert/strict";
import fs from "node:fs";

const api = fs.readFileSync("app/api/payments/register/route.ts", "utf8");
const page = fs.readFileSync("app/payments/page.tsx", "utf8");

for (const parameter of ["company_id", "payment_type", "party", "from_account", "date_from", "date_to", "created_by"]) {
  assert.ok(api.includes(`searchParams.get("${parameter}")`), `${parameter} is read by the register API`);
  assert.ok(page.includes(`params.set("${parameter}"`), `${parameter} is sent by the register UI`);
}

assert.match(api, /const FILTER_OPTIONS_PAGE_SIZE = 500/);
assert.match(api, /function loadAllFilterRows[\s\S]*\.range\(offset, offset \+ FILTER_OPTIONS_PAGE_SIZE - 1\)/);
assert.match(api, /async function buildFilterOptions[\s\S]*loadAllFilterRows[\s\S]*"companies"[\s\S]*"vendors"[\s\S]*"company_bank_accounts"[\s\S]*loadCreatorProfiles/);
assert.match(api, /applyOrganizationScope\([\s\S]*from\("payments"\)/);
assert.match(api, /\.from\("profiles"\)[\s\S]*\.select\("email, full_name"\)/);
assert.match(api, /created_by_display:[\s\S]*creatorProfiles\.get[\s\S]*created_by_name[\s\S]*created_by_email/);
assert.match(api, /filters\.companyId[\s\S]*filters\.paymentType[\s\S]*filters\.bankTransfer[\s\S]*filters\.vendorIds[\s\S]*filters\.accountId[\s\S]*filters\.dateFrom[\s\S]*filters\.dateTo[\s\S]*filters\.createdBy/);
assert.match(api, /applyPaymentFilters\(query,[\s\S]*\)[\s\S]*\.order\("payment_date"[\s\S]*\.range\(from, to\)/);
assert.doesNotMatch(page, /Status\s*<select|filters\.status|filterPaymentRegisterRows/);
assert.match(page, /Created By[\s\S]*filterOptions\.creators/);
assert.match(page, /Search and filters apply across all matching payments/);
assert.doesNotMatch(page, /toolbar filters the rows on the current page/);

console.log("Payment Register server-filter contracts passed.");
