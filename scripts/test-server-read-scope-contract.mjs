import assert from "node:assert/strict";
import fs from "node:fs";

const detailPages = [
  "app/debit-notes/[id]/page.tsx",
  "app/work-orders/[id]/page.tsx",
  "app/ra-bills/[id]/page.tsx",
];

for (const file of detailPages) {
  const source = fs.readFileSync(file, "utf8");
  assert.doesNotMatch(source, /\.from\("(?:debit_notes|work_orders|ra_bills|invoices|payments|companies|sites|vendors|procurement_purchase_orders)"\)/, `${file} must not perform browser table reads`);
  assert.match(source, /Authorization: `Bearer \$\{(?:session\.access_token|token)\}`/);
}

const apiContracts = [
  ["app/api/debit-notes/[id]/route.ts", /requirePermission\(request, "debit_notes", "view"\)/, /organizationScope/, /loadAllowedWorkOrderIds/],
  ["app/api/ra-bills/[id]/route.ts", /requirePermission\(request, "ra_bills", "view"\)/, /loadActorOrganizationScope/, /organization_id/],
  ["app/api/work-orders/[id]/details/route.ts", /requirePermission\(request, "work_orders", "view"\)/, /loadActorOrganizationScope/, /applyOrganizationScope/],
  ["app/api/companies/route.ts", /requirePermission\(request, "companies", "view"\)/, /loadActorOrganizationScope/, /serviceRoleKey/],
  ["app/api/sites/route.ts", /requirePermission\(request, "sites", "view"\)/, /loadActorOrganizationScope/, /serviceRoleKey/],
];

for (const [file, ...patterns] of apiContracts) {
  const source = fs.readFileSync(file, "utf8");
  for (const pattern of patterns) assert.match(source, pattern, `${file} is missing ${pattern}`);
}

const accessControl = fs.readFileSync("lib/accessControl.ts", "utf8");
assert.doesNotMatch(accessControl, /supabase\.from\("(?:user_roles|user_permissions|user_access_assignments|roles|role_permissions)"\)/);
assert.match(accessControl, /server endpoint is the only source of authorization data/);
console.log("Server-read authorization and browser-table-access contract passed.");
