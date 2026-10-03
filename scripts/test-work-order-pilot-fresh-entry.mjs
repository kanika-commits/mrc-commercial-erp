import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/work-orders/new/structured/page.tsx", "utf8");
const preview = fs.readFileSync("app/work-orders/new/structured/preview/page.tsx", "utf8");

assert.match(page, /searchParams\.get\("from"\) === "preview"/);
assert.match(page, /const preservedPreviewDraft = returningFromPreview \? getWorkOrderPilotDraft\(\) : null/);
assert.match(page, /preservedPreviewDraft\?\.form/);
assert.match(page, /preservedPreviewDraft\?\.supportingDocuments/);
assert.doesNotMatch(page, /useState<any>\(\(\) => getWorkOrderPilotDraft\(\)\?\.form/);
assert.match(preview, /\/work-orders\/new\/structured\?from=preview/);

console.log("Work Order Pilot fresh-entry state contract passed.");
