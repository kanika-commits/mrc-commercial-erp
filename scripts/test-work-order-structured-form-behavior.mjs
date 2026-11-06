import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("app/work-orders/new/structured/page.tsx", "utf8");

assert.match(source, /if \(draftId \|\| !form\.company_id \|\| !form\.site_id \|\| numberEdited\) return;/);
assert.match(source, /apiFetch\(`\/api\/work-orders\/drafts\/\$\{encodeURIComponent\(draftId\)\}`,\s*\{\s*method: "PATCH",\s*body: JSON\.stringify\(\{ \.\.\.payload, action: "draft" \}\)/s);
assert.ok(source.indexOf('method: "PATCH"') < source.indexOf('apiFetch("/api/work-orders/preview"'), "draft save must happen before preview");
assert.match(source, /Draft could not be saved\. Preview was not started/);
assert.match(source, /Draft saved, but Preview could not be generated\. You can retry Preview/);
assert.match(source, /const defaultDeliveryLocation = eligibleDeliveryLocations\.length === 1 \? eligibleDeliveryLocations\[0\] : null;/);
assert.match(source, /if \(lookupLoading \|\| !form\.billing_address_id \|\| selectedBillingAddress\) return;/);
assert.match(source, /if \(draftId \|\| lookupLoading \|\| form\.billing_address_id \|\| billingAddresses\.length !== 1\) return;/);
assert.match(source, /if \(draftId \|\| lookupLoading \|\| siteContacts\.length !== 1\) return;/);
assert.match(source, /billing_contact_id: current\.billing_contact_id \|\| onlySiteContactId/);
assert.match(source, /delivery_contact_id: current\.delivery_contact_id \|\| onlySiteContactId/);
assert.match(source, /if \(draftId \|\| lookupLoading \|\| form\.delivery_location_id \|\| !defaultDeliveryLocation\) return;/);
assert.ok(source.indexOf("Supporting Documents") < source.indexOf("Preview Work Order PDF"), "Preview remains after Supporting Documents");

console.log("Structured Work Order form draft-save, stable-number, lookup-preservation, and action-order checks passed.");
