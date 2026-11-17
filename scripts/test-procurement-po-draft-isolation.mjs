import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/purchase/purchase-orders/new/page.tsx", "utf8");
const route = fs.readFileSync("app/api/procurement/purchase-orders/[id]/route.ts", "utf8");
assert.match(page, /const \[draftLoading, setDraftLoading\] = useState\(Boolean\(editId\)\)/);
assert.match(page, /draftLoadRequestRef/);
assert.match(page, /requestId !== draftLoadRequestRef\.current/);
assert.match(page, /setCommercial\(\{ payment_terms: "", delivery_terms: "", purpose: "General Purchase"/);
assert.match(page, /Purchase Purpose/);
assert.match(page, /purpose: po\.purpose \|\| po\.commercial_snapshot\?\.purpose/);
assert.match(route, /commercial\.purpose \?\? result\.row\.purpose/);

const drafts = {
  a: { company: "company-a", site: "site-a", vendor: "vendor-a", gst: "gst-a", purpose: "Asset Purchase" },
  b: { company: "company-b", site: "site-b", vendor: "vendor-b", gst: "gst-b", purpose: "Recover from contractor" },
};
let form = {};
function hydrate(draft) { form = { ...draft }; return form; }
assert.deepEqual(hydrate(drafts.a), drafts.a);
assert.deepEqual(hydrate(drafts.b), drafts.b);
assert.deepEqual(hydrate(drafts.a), drafts.a);
assert.deepEqual(hydrate(drafts.b), drafts.b);
assert.notEqual(drafts.a.company, drafts.b.company);
assert.notEqual(drafts.a.gst, drafts.b.gst);
console.log("PO draft-specific isolation and purpose hydration rules passed");
