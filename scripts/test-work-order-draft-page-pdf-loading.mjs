import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/work-orders/drafts/[id]/page.tsx", "utf8");
assert.match(page, /requestWithTimeout/);
assert.match(page, /application\/pdf/);
assert.match(page, /setDraft\(payload\)/);
assert.match(page, /View \/ Download Work Order PDF/);
assert.match(page, /Retry PDF/);
assert.match(page, /URL\.createObjectURL/);
assert.match(page, /URL\.revokeObjectURL/);
assert.match(page, /draft\?\.wo_number/);
assert.doesNotMatch(page, /Promise\.all\(/);

console.log("Work Order draft page metadata/PDF loading contract passed.");
