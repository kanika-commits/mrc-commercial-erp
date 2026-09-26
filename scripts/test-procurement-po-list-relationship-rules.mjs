import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync("app/api/procurement/purchase-orders/route.ts", "utf8");
const page = fs.readFileSync("app/purchase/purchase-orders/page.tsx", "utf8");
const schema = fs.readFileSync("supabase/migrations/202609060001_procurement_purchase_orders_non_rfq_baseline.sql", "utf8");

assert.match(route, /company:companies!procurement_purchase_orders_company_id_fkey\(id,company_name,company_code\)/);
assert.doesNotMatch(route, /company:companies\(id,company_name,company_code\)/);
assert.match(schema, /company_id uuid not null references public\.companies\(id\)/);
assert.match(route, /applyOrganizationAccess\(admin\.from\("procurement_purchase_orders"\)/);
assert.match(route, /applyCompanySiteAccess\(query, auth\)/);
assert.match(page, /const \[loadError, setLoadError\] = useState\(""\)/);
assert.match(page, /setLoadError\(detail\)/);
assert.match(page, /loadError \? <tr><td colSpan=\{11\}[^>]*>Purchase Orders could not be loaded/);
assert.match(page, /loadError \? [\s\S]*?: filtered\.length === 0 \? <tr><td colSpan=\{11\}[^>]*>No Purchase Orders found/);

console.log("purchase order list relationship/error-state rules: PASS");
