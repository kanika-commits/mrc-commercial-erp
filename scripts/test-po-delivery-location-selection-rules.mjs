import fs from "node:fs";
const page = fs.readFileSync("app/purchase/purchase-orders/new/page.tsx", "utf8");
const lookup = fs.readFileSync("app/api/procurement/purchase-orders/lookups/route.ts", "utf8");
if (!page.includes("row.site_id === siteId") || !page.includes("row.billing_address_id === selectedBilling.id")) throw new Error("PO page is not scoped by both site and billing identity");
if (!page.includes("siteCompatibleBillingIds") || !page.includes("siteId || siteCompatibleBillingIds.has(row.billing_address?.id)")) throw new Error("Billing identity is not resolved by selected-site compatibility");
if (!page.includes("defaultDeliveryLocation") || !page.includes("deliveryAddressFor(selectedDeliveryLocation)")) throw new Error("Delivery default/address hydration is missing");
if (!lookup.includes('.eq("status", "active")') || !lookup.includes('.in("site_id", auth.sites)') || !lookup.includes("accessibleBillingIds")) throw new Error("Lookup organization/site/billing scope is incomplete");
if (!page.includes('setDeliveryLocationId("")') || !page.includes('setDeliveryContactId("")')) throw new Error("Company/site reset behavior is missing");
console.log("PO delivery-location selection rules: PASS");
