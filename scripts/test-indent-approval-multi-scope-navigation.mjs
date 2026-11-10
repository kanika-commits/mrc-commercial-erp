import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/purchase/requisitions/configuration/page.tsx", "utf8");
const route = fs.readFileSync("app/api/procurement/requisitions/configuration/route.ts", "utf8");
assert.match(page, /Select all/);
assert.match(page, /Clear/);
assert.match(page, /companyIds\.flatMap\(\(company_id\) => siteIds/);
assert.match(page, /These exact combinations will be changed/);
assert.match(page, /existing policy will be replaced/);
assert.match(page, /scopes, layer_count: count, layers/);
assert.match(route, /const requestedScopes = Array\.isArray\(payload\.scopes\)/);
assert.match(route, /requires_overwrite_confirmation/);
assert.match(route, /confirm_overwrite !== true/);
assert.match(route, /save_purchase_requisition_approval_configuration_atomic/);
assert.match(route, /active ERP user with access to each selected company and site/);
assert.match(route, /\[\{ company_id: payload\.company_id, site_id: payload\.site_id \}\]/);
console.log("Indent Approval multi-scope configuration regression passed.");
