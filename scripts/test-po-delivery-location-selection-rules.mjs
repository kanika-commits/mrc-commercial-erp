import fs from "node:fs";
const page = fs.readFileSync("app/purchase/purchase-orders/new/page.tsx", "utf8");
const lookup = fs.readFileSync("app/api/procurement/purchase-orders/lookups/route.ts", "utf8");
if (!page.includes("row.site_id === siteId") || page.includes("row.billing_address_id === selectedBilling.id")) throw new Error("PO delivery locations must be scoped by site without legacy billing coupling");
if (page.includes("siteCompatibleBillingIds") || page.includes("siteId || siteCompatibleBillingIds.has(row.billing_address?.id)")) throw new Error("Billing identity must not gate site delivery locations");
if (!page.includes("defaultDeliveryLocation") || !page.includes("deliveryAddressFor(selectedDeliveryLocation)")) throw new Error("Delivery default/address hydration is missing");
if (!lookup.includes('.eq("status", "active")') || !lookup.includes('.in("site_id", auth.sites)') || !lookup.includes("accessibleBillingIds") || !lookup.includes("accessibleSiteIds.has(row.site_id) || !row.billing_address_id")) throw new Error("Lookup organization/site scope is incomplete");
if (!page.includes('setDeliveryLocationId("")') || !page.includes('setDeliveryContactId("")')) throw new Error("Company/site reset behavior is missing");
console.log("PO delivery-location selection rules: PASS");
