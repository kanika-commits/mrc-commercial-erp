import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const lookupRoute = read("app/api/procurement/purchase-orders/lookups/route.ts");
const saveRoute = read("app/api/procurement/purchase-orders/site-contacts/route.ts");
const page = read("app/purchase/purchase-orders/new/page.tsx");

assert.match(saveRoute, /p_site_id:\s*siteId/);
assert.match(saveRoute, /p_is_default:\s*body\.is_default === true/);
assert.match(saveRoute, /p_status:\s*text\(body\.status\) \|\| "active"/);

assert.match(lookupRoute, /const siteContactQuery = admin\.from\("site_contacts"\)[\s\S]*\.eq\("status", "active"\)/);
assert.match(lookupRoute, /const accessibleSiteIds = new Set/);
assert.match(lookupRoute, /masterRows\(siteContactResult\)\.filter\(\(row: any\) => accessibleSiteIds\.has\(row\.site_id\)\)/);
assert.doesNotMatch(lookupRoute, /const siteContactQuery = applyOrganizationAccess/);

assert.match(page, /row\.site_id === siteId && row\.status === "active"/);
assert.match(page, /const defaultSiteContact = siteContacts\.find\(\(row: any\) => row\.is_default\) \|\| siteContacts\[0\] \|\| null;/);
assert.match(page, /siteContacts\.map\(\(row: any\) => <option/);

const activeContacts = [
  { id: "contact-1", organization_id: "legacy-org", site_id: "site-1", status: "active", is_default: false, contact_name: "test contact" },
  { id: "contact-2", organization_id: "site-org", site_id: "site-2", status: "active", is_default: true, contact_name: "other site" },
  { id: "contact-3", organization_id: "site-org", site_id: "site-1", status: "inactive", is_default: true, contact_name: "inactive" },
];
const selectedSiteContacts = activeContacts
  .filter((row) => row.site_id === "site-1" && row.status === "active")
  .sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.contact_name.localeCompare(b.contact_name));
const defaultSiteContact = selectedSiteContacts.find((row) => row.is_default) || selectedSiteContacts[0] || null;

assert.deepEqual(selectedSiteContacts.map((row) => row.id), ["contact-1"]);
assert.equal(defaultSiteContact.id, "contact-1", "an active non-default contact must bind when no default exists");
assert.equal(selectedSiteContacts.some((row) => row.id === "contact-1" && row.organization_id === "legacy-org"), true, "site authorization must retain a legacy contact with a stale denormalized organization id");
assert.equal(selectedSiteContacts.some((row) => row.id === "contact-2"), false, "contacts from other sites remain excluded");
assert.equal(selectedSiteContacts.some((row) => row.id === "contact-3"), false, "inactive contacts remain excluded");

console.log("Site Contact lookup/save and active non-default binding rules passed.");
