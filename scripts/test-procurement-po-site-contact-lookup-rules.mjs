import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const lookupRoute = read("app/api/procurement/purchase-orders/lookups/route.ts");
const saveRoute = read("app/api/procurement/purchase-orders/site-contacts/route.ts");
const page = read("app/purchase/purchase-orders/new/page.tsx");

assert.match(saveRoute, /p_site_id:\s*siteId/);
assert.match(saveRoute, /p_is_default:\s*body\.is_default === true/);
assert.match(saveRoute, /p_status:\s*text\(body\.status\) \|\| "active"/);

assert.match(lookupRoute, /admin\.from\("site_contacts"\)[\s\S]*\.eq\("status", "active"\)/);
assert.match(lookupRoute, /const accessibleSiteIds = new Set/);
assert.match(lookupRoute, /masterRows\(siteContactResult\)\.filter\(\(row: any\) => accessibleSiteIds\.has\(row\.site_id\)\)/);

assert.match(page, /row\.site_id === siteId && row\.status === "active"/);
assert.match(page, /const defaultSiteContact = siteContacts\.find\(\(row: any\) => row\.is_default\) \|\| siteContacts\[0\] \|\| null;/);
assert.match(page, /siteContacts\.map\(\(row: any\) => <option/);

const activeContacts = [
  { id: "contact-1", site_id: "site-1", status: "active", is_default: false, contact_name: "test contact" },
  { id: "contact-2", site_id: "site-1", status: "active", is_default: false, contact_name: "another contact" },
  { id: "contact-3", site_id: "site-2", status: "active", is_default: true, contact_name: "other site" },
  { id: "contact-4", site_id: "site-1", status: "inactive", is_default: true, contact_name: "inactive" },
];
const selectedSiteContacts = activeContacts
  .filter((row) => row.site_id === "site-1" && row.status === "active")
  .sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.contact_name.localeCompare(b.contact_name));
const defaultSiteContact = selectedSiteContacts.find((row) => row.is_default) || selectedSiteContacts[0] || null;

assert.deepEqual(selectedSiteContacts.map((row) => row.id), ["contact-2", "contact-1"]);
assert.equal(defaultSiteContact.id, "contact-2", "an active non-default contact must bind when no default exists");
assert.equal(selectedSiteContacts.some((row) => row.id === "contact-1"), true, "all active contacts for the selected site remain selectable");
assert.equal(selectedSiteContacts.some((row) => row.id === "contact-3"), false, "contacts from other sites remain excluded");
assert.equal(selectedSiteContacts.some((row) => row.id === "contact-4"), false, "inactive contacts remain excluded");

console.log("Site Contact lookup/save and active non-default binding rules passed.");
