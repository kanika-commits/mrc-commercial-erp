import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/settings/purchase-order-masters/page.tsx", "utf8");
const api = fs.readFileSync("app/api/procurement/purchase-orders/master-data/route.ts", "utf8");
const migration = fs.readFileSync("supabase/migrations/202609090001_procurement_po_delivery_location_contract.sql", "utf8");
const poPage = fs.readFileSync("app/purchase/purchase-orders/new/page.tsx", "utf8");

assert.match(page, /Associated Company \(Optional\)/);
assert.match(page, /Shipping GSTIN \(Optional\)/);
assert.doesNotMatch(page, /Project \/ Associated Company<select required/);
assert.doesNotMatch(page, /Shipping GSTIN<input required/);
assert.match(page, /<label className="text-sm font-semibold">Site<select required/);
assert.match(page, /Location Name<input required/);

assert.match(api, /const companyId = text\(body\.company_id\) \|\| null/);
assert.match(api, /const shippingGstin = text\(body\.gstin\)\.toUpperCase\(\) \|\| null/);
assert.match(api, /if \(shippingGstin && !GSTIN_REGEX\.test\(shippingGstin\)\)/);
assert.match(api, /if \(companyId\) \{/);
assert.match(api, /company_id: companyId, gstin: shippingGstin/);
assert.doesNotMatch(api, /if \(!text\(body\.company_id\) \|\| !shippingGstin/);

assert.match(migration, /SECURITY DEFINER/);
assert.match(migration, /SET search_path TO 'public', 'pg_temp'/);
assert.equal((migration.match(/company_id is null or company_id = p_company_id/g) || []).length, 3);
assert.doesNotMatch(migration, /sites\.company_id/);
assert.doesNotMatch(migration, /billing_address_id = v_billing\.id/);
assert.match(migration, /site_id = p_site_id[\s\S]{0,180}status = 'active'[\s\S]{0,180}company_id is null or company_id = p_company_id/);
assert.match(migration, /if v_delivery\.billing_address_id is not null/);
assert.match(migration, /company_id = p_company_id[\s\S]{0,180}status = 'active'/);
assert.match(migration, /Selected Delivery Location has an inactive, outside-organization, or incompatible Billing Address/);
assert.match(migration, /coalesce\(v_gst\.gstin, v_billing\.gstin\)/);

assert.match(poPage, /selectedDeliveryBilling/);
assert.match(poPage, /selectedDeliveryGst/);
assert.match(poPage, /mappedGstBilling/);
assert.match(poPage, /const selectedGstBilling = mappedGstBilling \|\|/);
assert.match(poPage, /setDeliveryLocationId\(""\)/);

console.log("Delivery Location master contract rules: PASS");
