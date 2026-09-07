import assert from "node:assert/strict";
import fs from "node:fs";

const guard = fs.readFileSync("components/AuthGuard.tsx", "utf8");
const launcher = fs.readFileSync("components/ModulePage.tsx", "utf8");
const itemPage = fs.readFileSync("app/settings/items/page.tsx", "utf8");
const itemApi = fs.readFileSync("app/api/procurement/items/route.ts", "utf8");
const masterPage = fs.readFileSync("app/settings/purchase-order-masters/page.tsx", "utf8");

for (const moduleCode of [
  "procurement_items",
  "procurement_gst_billing_delivery_master",
  "procurement_site_contact_master",
  "procurement_letterhead_master",
  "procurement_po_terms_master",
]) assert.match(guard, new RegExp(moduleCode));

assert.match(guard, /function hasSettingsViewAccess/);
assert.match(guard, /pathname === "\/settings\/items"/);
assert.match(guard, /pathname === "\/settings\/purchase-order-masters\/site-contacts"/);
assert.match(guard, /pathname === "\/settings\/purchase-order-masters\/letterheads"/);
assert.match(guard, /settingsRouteAccess\(pathname, access\) \?\? hasSettingsViewAccess\(access\)/);
assert.doesNotMatch(guard, /if \(pathname\.startsWith\("\/settings"\)\) \{\s*return globalAccess;/);
assert.match(launcher, /procurement_items:/);
assert.match(launcher, /module_code: "procurement_gst_billing_delivery_master"/);
assert.match(launcher, /can\(permissions, page\.module_code, "view"\)/);
assert.match(itemPage, /canAdd = can\(permissions, "procurement_items", "add"\)/);
assert.match(itemApi, /requireProcurementPermission\(request, ITEM_MODULE, "add"\)/);
assert.match(masterPage, /can\(permissions, masterModule, "view"\)/);
assert.doesNotMatch(guard, /roleCodes\.includes\("gm_proc"\)/);
console.log("Settings permission guard rules passed.");
