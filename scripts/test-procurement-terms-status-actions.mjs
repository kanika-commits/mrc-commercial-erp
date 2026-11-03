import assert from "node:assert/strict";
import fs from "node:fs";
const page = fs.readFileSync("app/settings/purchase-order-masters/page.tsx", "utf8");
const api = fs.readFileSync("app/api/procurement/purchase-orders/master-data/route.ts", "utf8");
for (const marker of ["activateTerms", "More actions", "data-terms-action-menu", "Escape", "Copying…", "Activating…", "Inactivating…", "Loading clauses…", "if (saving)", "Copy to companies"]) assert.ok(page.includes(marker), `missing ${marker}`);
assert.match(api, /terms_template_copy/); assert.match(api, /p_status: "inactive"/);
console.log("Terms status/action rules: PASS");
