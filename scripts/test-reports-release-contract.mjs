import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const labourPage = read("app/reports/labour-audit/page.tsx");
const labourApi = read("app/api/reports/labour-audit/route.ts");
const vendorApi = read("app/api/reports/vendors/route.ts");
const authGuard = read("components/AuthGuard.tsx");
const lockdown = read("supabase/migrations/202610260001_reports_browser_access_lockdown.sql");

assert.match(labourPage, /supabase\.auth\.getSession/);
assert.match(labourPage, /Authorization: `Bearer \$\{session\?\.access_token/);
assert.match(labourPage, /fetch\(`\/api\/reports\/labour-audit\?\$\{query\.toString\(\)\}`, \{ headers: await authHeaders\(\) \}\)/);
assert.match(labourPage, /fetch\(`\/api\/reports\/labour-audit\?\$\{params\.toString\(\)\}`, \{ headers: await authHeaders\(\) \}\)/);
assert.doesNotMatch(labourPage, /window\.location\.href = `\/api\/reports\/labour-audit/);

assert.match(labourApi, /const METADATA_LIMIT = 200/);
assert.match(labourApi, /\.range\(0, METADATA_LIMIT - 1\)/);
assert.match(labourApi, /Unable to load Labour Audit Report\./);
assert.doesNotMatch(labourApi, /error\?\.message/);
assert.match(vendorApi, /const REPORT_PAGE_SIZE = 200/);
assert.match(vendorApi, /\.range\(0, resultLimit - 1\)/);
assert.match(vendorApi, /Unable to load Vendor Report\./);
assert.doesNotMatch(vendorApi, /error\?\.message/);

assert.match(authGuard, /pathname === "\/modules\/reports"/);
assert.match(read("app/modules/reports/page.tsx"), /@\/app\/reports\/page/);
assert.match(lockdown, /revoke all on table public\.erp_audit_logs from anon, authenticated/);
assert.match(lockdown, /revoke all on table public\.vendor_audit_logs from anon, authenticated/);
assert.match(lockdown, /grant select on table public\.erp_audit_logs to service_role/);
assert.match(lockdown, /grant select, insert on table public\.vendor_audit_logs to service_role/);
assert.match(lockdown, /grant select, insert on table public\.vendor_audit_logs/);
assert.doesNotMatch(lockdown, /\b(update|delete|drop|truncate)\b/i);

console.log("Reports release contract passed.");
