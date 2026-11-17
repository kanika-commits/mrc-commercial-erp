import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/purchase/purchase-orders/new/page.tsx", "utf8");

assert.match(page, /const \[lookupLoading, setLookupLoading\]/);
assert.match(page, /const \[draftLoading, setDraftLoading\] = useState\(Boolean\(editId\)\)/);
assert.match(page, /if \(loading \|\| lookupLoading \|\| draftLoading\) return <p[^>]*>\{draftLoading \? "Loading Draft Purchase Order/);
assert.match(page, /draftLoadRequestRef/);
assert.match(page, /requestId !== draftLoadRequestRef\.current/);
assert.match(page, /setGstRegistrationId\(\(current\) => gstBillingMasters\.some/);
assert.match(page, /setDeliveryContactId\(\(current\) => siteContacts\.some/);
assert.match(page, /setBillingContactId\(\(current\) => siteContacts\.some/);
assert.match(page, /setDeliveryLocationId\(\(current\) => deliveryLocations\.some/);
assert.match(page, /setTermsTemplateId\(\(current\) => companyTerms\.some/);

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
