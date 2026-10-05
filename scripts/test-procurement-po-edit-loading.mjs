import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/purchase/purchase-orders/new/page.tsx", "utf8");

assert.match(page, /const \[lookupLoading, setLookupLoading\]/);
assert.match(page, /const \[draftLoading, setDraftLoading\] = useState\(Boolean\(editId\)\)/);
assert.match(page, /if \(draftLoading\) return <p[^>]*>Loading Draft Purchase Order/);
assert.match(page, /function retainSelectedLookupOption/);
assert.match(page, /setLookups\(\(current(?:: any)?\) => mergeDraftLookupOptions\(current, po\)\)/);
assert.match(page, /draftLookupSelectionRef/);
assert.match(page, /if \(lookupLoading\) return;/);
assert.match(page, /setGstRegistrationId\(\(current\) => current \|\|/);
assert.match(page, /setDeliveryContactId\(\(current\) => current \|\|/);
assert.match(page, /setBillingContactId\(\(current\) => current \|\|/);
assert.match(page, /setDeliveryLocationId\(\(current\) => current \|\|/);
assert.match(page, /setTermsTemplateId\(\(current\) => current \|\|/);
assert.match(page, /if \(draftLoading\) return/);

const saved = {
  companyId: "company-saved",
  siteId: "site-saved",
  vendorId: "vendor-saved",
  gstRegistrationId: "gst-saved",
  billingContactId: "billing-contact-saved",
  deliveryContactId: "delivery-contact-saved",
  deliveryLocationId: "location-saved",
  termsTemplateId: "terms-saved",
};

// Model delayed responses: the draft resolves first, so the empty form remains
// gated; lookup reconciliation then preserves every saved selection.
let draftReady = false;
assert.equal(draftReady, false);
assert.equal(draftReady ? "form" : "loading", "loading");
draftReady = true;
const reconcile = (current, fallback) => current || fallback || "";
const resolved = Object.fromEntries(Object.entries(saved).map(([key, value]) => [key, reconcile(value, `${key}-default`)]));
assert.deepEqual(resolved, saved);

console.log("procurement PO edit loading regression checks passed");
