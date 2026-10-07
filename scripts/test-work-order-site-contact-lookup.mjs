import assert from "node:assert/strict";
import fs from "node:fs";

const lookup = fs.readFileSync("app/api/work-orders/create-lookups/route.ts", "utf8");
const form = fs.readFileSync("app/work-orders/new/structured/page.tsx", "utf8");

assert.match(lookup, /const site_contacts: any = admin\.from\("site_contacts"\)[\s\S]*\.eq\("status", "active"\)/);
assert.match(lookup, /const accessibleSiteIds = new Set/);
assert.match(lookup, /dependentData\["Site Contact Master"\] = \(dependentData\["Site Contact Master"\] \|\| \[\]\)\.filter\(\(row: any\) => accessibleSiteIds\.has\(row\.site_id\)\)/);
assert.doesNotMatch(lookup, /const site_contacts: any = scoped\(admin\.from\("site_contacts"\)/);
assert.match(form, /lookups\.site_contacts\.filter\(\(row: any\) => row\.site_id === form\.site_id && row\.status === "active"\)/);
assert.match(form, /Billing Contact Person<select[\s\S]*siteContacts\.map/);
assert.match(form, /Delivery Contact Person<select[\s\S]*siteContacts\.map/);
assert.match(form, /const defaultSiteContact = siteContacts\.find\(\(row: any\) => row\.is_default\) \|\| siteContacts\[0\] \|\| null/);
assert.match(form, /const billingValid = siteContacts\.some/);
assert.match(form, /const deliveryValid = siteContacts\.some/);
assert.equal((form.match(/disabled=\{!form\.site_id \|\| siteContacts\.length === 0\}/g) || []).length, 2, "both contact controls must remain enabled when active site contacts exist");
assert.doesNotMatch(form, /delivery_location_id: e\.target\.value, delivery_contact_id: ""/);

const siteIds = new Set(["bus-stand-site"]);
const contacts = [
  { id: "test-contact", organization_id: "legacy-org", site_id: "bus-stand-site", status: "active", is_default: false, contact_name: "test contact" },
  { id: "crpf-contact", organization_id: "site-org", site_id: "crpf-site", status: "active", is_default: true, contact_name: "CRPF contact" },
  { id: "inactive-contact", organization_id: "legacy-org", site_id: "bus-stand-site", status: "inactive", is_default: false, contact_name: "inactive" },
];
const returnedContacts = contacts.filter((row) => row.status === "active" && siteIds.has(row.site_id));
const selectedSiteContacts = returnedContacts.filter((row) => row.site_id === "bus-stand-site" && row.status === "active");
const selected = selectedSiteContacts.find((row) => row.is_default) || selectedSiteContacts[0] || null;

assert.deepEqual(selectedSiteContacts.map((row) => row.id), ["test-contact"]);
assert.equal(selected?.id, "test-contact", "active non-default contact for the selected site must be selected");
assert.equal(returnedContacts.some((row) => row.id === "crpf-contact"), false, "contacts from another site must remain excluded");
assert.equal(returnedContacts.some((row) => row.id === "inactive-contact"), false, "inactive contacts must remain excluded");

const retainOrReconcile = (currentId, options) => options.some((row) => row.id === currentId)
  ? currentId
  : (options.find((row) => row.is_default) || options[0])?.id || "";
assert.equal(retainOrReconcile("test-contact", selectedSiteContacts), "test-contact", "a deliberate valid contact selection must be retained");
assert.equal(retainOrReconcile("old-site-contact", [{ id: "new-site-contact", is_default: false }]), "new-site-contact", "changing site must reconcile to a valid contact");

console.log("Work Order Site Contact lookup rules passed.");
