import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync("app/api/procurement/purchase-orders/[id]/route.ts", "utf8");
const projectionSource = fs.readFileSync("lib/procurement/poDraftMasterView.server.ts", "utf8");

function resolveProjection(po, masters, { strict = false } = {}) {
  if (po.revision_no !== 0 || po.previous_revision_id) return structuredClone(po);
  const selected = po.delivery_snapshot.master_selection;
  const required = (value, label) => {
    if (strict && !value) throw new Error(`Selected ${label} could not be resolved.`);
    return value;
  };
  const vendor = required(masters.vendors[selected.vendor_id], "Vendor");
  const company = required(masters.companies[po.company_id], "Company");
  const site = required(masters.sites[po.site_id], "Site");
  const billing = selected.billing_address_id ? required(masters.billing[selected.billing_address_id], "billing address") : null;
  const delivery = selected.delivery_location_id ? required(masters.delivery[selected.delivery_location_id], "delivery location") : null;
  const contact = selected.site_contact_id ? required(masters.contacts[selected.site_contact_id], "site contact") : null;
  return {
    ...structuredClone(po),
    vendor_name_snapshot: vendor.name,
    vendor_snapshot: { ...po.vendor_snapshot, ...vendor.contact, vendor_name: vendor.name, address: vendor.address },
    delivery_snapshot: {
      ...po.delivery_snapshot,
      billing_address: billing || po.delivery_snapshot.billing_address,
      delivery_location: delivery || po.delivery_snapshot.delivery_location,
      site_contact: contact || po.delivery_snapshot.site_contact,
      delivery_contact: contact || po.delivery_snapshot.delivery_contact,
    },
  };
}

function freeze(po, masters) {
  return resolveProjection(po, masters, { strict: true });
}

const base = {
  id: "r0",
  po_number: "PO/R-0",
  revision_no: 0,
  previous_revision_id: null,
  status: "draft",
  company_id: "company-1",
  site_id: "site-1",
  vendor_snapshot: { vendor_name: "Vendor", contact_person: "A", phone: "1", email: "a@example.test", designation: "Old" },
  delivery_snapshot: { master_selection: { vendor_id: "vendor-1", billing_address_id: "billing-1", delivery_location_id: "delivery-1", site_contact_id: "contact-1" } },
  items: [{ quantity: 2, unit_rate: 10, tax_amount: 3 }],
  total_amount: 23,
  standard_terms_snapshot: "terms",
};

const masters = {
  companies: { "company-1": { name: "Company" } },
  sites: { "site-1": { name: "Site" } },
  vendors: { "vendor-1": { name: "Vendor", address: "Address", contact: { contact_person: "B", phone: "2", email: "b@example.test", designation: "Sales" } } },
  billing: { "billing-1": { line1: "Billing B" } },
  delivery: { "delivery-1": { line1: "Delivery B" } },
  contacts: { "contact-1": { contact_name: "Site B", contact_number: "22", email: "site-b@example.test", designation: "Manager" } },
};

const draftProjection = resolveProjection(base, masters);
assert.equal(draftProjection.vendor_snapshot.contact_person, "B");
const submitted = freeze(base, masters);
assert.equal(submitted.vendor_snapshot.contact_person, "B");
assert.deepEqual(submitted.items, base.items);
assert.equal(submitted.total_amount, base.total_amount);
assert.equal(submitted.standard_terms_snapshot, base.standard_terms_snapshot);

masters.vendors["vendor-1"].contact = { contact_person: "C", phone: "3", email: "c@example.test", designation: "New" };
assert.equal(submitted.vendor_snapshot.contact_person, "B");

const sentBack = { ...submitted, status: "sent_back" };
assert.equal(freeze(sentBack, masters).vendor_snapshot.contact_person, "C");

for (const [key, label] of [["vendors", "Vendor"], ["companies", "Company"], ["billing", "billing address"], ["sites", "Site"], ["delivery", "delivery location"], ["contacts", "site contact"]]) {
  const missing = structuredClone(masters);
  const id = key === "vendors" ? "vendor-1" : key === "companies" ? "company-1" : key === "sites" ? "site-1" : key === "billing" ? "billing-1" : key === "delivery" ? "delivery-1" : "contact-1";
  delete missing[key][id];
  assert.throws(() => freeze(sentBack, missing), new RegExp(`Selected ${label} could not be resolved`));
}

const revision = { ...base, id: "r1", revision_no: 1, previous_revision_id: "r0", vendor_snapshot: { ...base.vendor_snapshot } };
assert.deepEqual(resolveProjection(revision, masters), revision);

assert.match(route, /resolvePoMasterProjection\(result\.admin, result\.row, \{ strict: true \}\)/);
assert.match(route, /revision_no \|\| 0\) === 0/);
assert.match(route, /vendor_name_snapshot: frozenProjection\.vendor_name_snapshot/);
assert.match(route, /vendor_snapshot: frozenProjection\.vendor_snapshot/);
assert.match(route, /delivery_snapshot: frozenProjection\.delivery_snapshot/);
assert.doesNotMatch(route, /sites\.company_id/);
assert.doesNotMatch(route, /items:\s*frozenProjection|total_amount:\s*frozenProjection|standard_terms_snapshot:\s*frozenProjection/);
assert.match(projectionSource, /if \(Number\(row\?\.revision_no \|\| 0\) !== 0 \|\| row\?\.previous_revision_id\) return row/);
assert.match(projectionSource, /if \(strict\) throw error/);

console.log("PASS: isolated R-0 submit/resubmit snapshot-freeze regression");
