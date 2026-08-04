import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(new URL("../supabase/migrations/202607290004_expand_labour_trade_master.sql", import.meta.url), "utf8");
const registrationPage = fs.readFileSync(new URL("../app/labour/workers/new/page.tsx", import.meta.url), "utf8");
const lookupsRoute = fs.readFileSync(new URL("../app/api/labour/lookups/route.ts", import.meta.url), "utf8");
const importPreviewRoute = fs.readFileSync(new URL("../app/api/labour/import/preview/route.ts", import.meta.url), "utf8");

const requiredTrades = [
  "Labour",
  "Contractual Labour",
  "Coolie",
  "Helper",
  "Mason",
  "Carpenter",
  "Bar Bender",
  "Steel Fixer",
  "Plumber",
  "Electrician",
  "Welder",
  "Painter",
  "Scaffolder",
  "Rigger",
  "Foreman",
  "Supervisor",
  "Site Supervisor",
  "Store Keeper",
  "Store Incharge",
  "Cook",
  "Cook Helper",
  "Sweeper",
  "Housekeeping",
  "Security Guard",
  "Driver",
  "JCB Operator",
  "Crane Operator",
  "Plant Operator",
  "Concrete Plant Operator",
  "Concrete Pump Operator",
  "Pump Operator",
  "Generator Operator",
  "Excavator Operator",
  "Dumper Operator",
  "Roller Operator",
  "Lab Incharge",
];

for (const trade of requiredTrades) {
  assert.match(migration, new RegExp(`'${trade.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`), `${trade} must be seeded in the Labour Trade master`);
}

for (const hrDesignation of ["Accountant", "Project Manager", "HR Manager", "Engineer", "Site Engineer", "Billing Engineer", "ERP Executive", "Director"]) {
  assert.doesNotMatch(migration, new RegExp(`'${hrDesignation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`), `${hrDesignation} must not be seeded as a Labour Trade`);
}

assert.match(migration, /where not exists[\s\S]+public\.labour_trades/, "trade seed must preserve existing IDs by inserting only missing trades");
assert.match(migration, /upper\(regexp_replace\(trim\(t\.trade_name\)/, "trade seed must dedupe by normalized trade name");
assert.match(registrationPage, /options=\{lookups\.trades \|\| \[\]\}/, "Labour Registration dropdown must remain backed by Labour Trade lookups");
assert.match(lookupsRoute, /\.from\("labour_trades"\)\.select\("id, organization_id, trade_name, trade_code, status"\)\.eq\("status", "active"\)/, "Registration lookups must expose active Labour Trades");
assert.match(importPreviewRoute, /\.from\("labour_trades"\)\.select\("id, trade_name, trade_code"\)\.eq\("organization_id", batch\.organization_id\)\.eq\("status", "active"\)/, "Labour Import mapping dropdown must expose active Labour Trades");

console.log("Labour Trade master rules passed.");
