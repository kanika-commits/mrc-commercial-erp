import assert from "node:assert/strict";
import fs from "node:fs";

const form = fs.readFileSync("app/work-orders/new/structured/page.tsx", "utf8");
const previewRoute = fs.readFileSync("app/api/work-orders/preview/route.ts", "utf8");
const hrClient = fs.readFileSync("components/hr/hrClient.ts", "utf8");

assert.match(form, /const REQUEST_TIMEOUT_MS = 30_000/);
const saveBeforePreview = form.indexOf("Work Order draft save before preview");
const previewRequest = form.indexOf("/api/work-orders/preview");
assert.ok(saveBeforePreview >= 0, "existing drafts must be saved before preview");
assert.ok(previewRequest > saveBeforePreview, "preview must start after the draft save");
assert.match(form, /Preview was not started; your form values were kept/);
assert.match(form, /const creationRequestId = draftId \?/);
assert.match(form, /if \(draftId \|\|/);
assert.match(form, /wo_number: draft\.wo_number \|\| \"\"/);
assert.match(form, /setNumberEdited\(true\)/);
assert.match(previewRoute, /export const maxDuration = 30/);
assert.match(hrClient, /setTimeout\(\(\) => controller\.abort\(\), 30_000\)/);

console.log("work-order structured preview persistence checks passed");
