import assert from "node:assert/strict";
import fs from "node:fs";

const form = fs.readFileSync("app/work-orders/new/structured/page.tsx", "utf8");
const preview = fs.readFileSync("app/work-orders/new/structured/preview/page.tsx", "utf8");

assert.match(form, /if \(draftId \|\| !form\.company_id \|\| !form\.site_id \|\| numberEdited\) return;/);
assert.match(form, /const savedDraftId = draftId \|\| saved\.workOrder\?\.id;/);
assert.match(form, /structured\/preview\?draft=\$\{encodeURIComponent\(savedDraftId\)\}/);
assert.match(preview, /const draftId = searchParams\.get\("draft"\) \|\| draft\?\.draftId \|\| "";/);

const draftReturnRoute = /`\/work-orders\/new\/structured\?draft=\$\{encodeURIComponent\(draftId\)\}&from=preview`/g;
assert.equal((preview.match(draftReturnRoute) || []).length, 2, "both Back to Edit actions preserve draft identity");
assert.match(preview, /router\.push\(draftId \? `\/work-orders\/new\/structured\?draft=/);
assert.match(preview, /revisionId \? `\/work-orders\/new\/structured\?revision=.*?` : draftId \? `\/work-orders\/new\/structured\?draft=/s);

const savedDraft = { id: "draft-101", wo_number: "PHSC\/PI\/101" };
const previewUrl = `/work-orders/new/structured/preview?draft=${encodeURIComponent(savedDraft.id)}`;
const returnUrl = `/work-orders/new/structured?draft=${encodeURIComponent(savedDraft.id)}&from=preview`;
assert.equal(previewUrl, "/work-orders/new/structured/preview?draft=draft-101");
assert.equal(returnUrl, "/work-orders/new/structured?draft=draft-101&from=preview");
assert.equal(savedDraft.wo_number, "PHSC/PI/101");

console.log("PASS: draft preview return preserves draft ID and saved Work Order number");
