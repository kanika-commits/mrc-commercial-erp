import assert from "node:assert/strict";
import fs from "node:fs";

const edit = fs.readFileSync("app/labour/workers/[id]/edit/page.tsx", "utf8");
const detail = fs.readFileSync("app/labour/workers/[id]/page.tsx", "utf8");
const registration = fs.readFileSync("app/labour/workers/new/page.tsx", "utf8");

assert.match(edit, /const profile = \{/);
assert.doesNotMatch(edit, /<Select label="Contractor/);
assert.doesNotMatch(edit, /<Select label="Work Order/);
assert.doesNotMatch(edit, /<Select label="Labour Category/);
assert.doesNotMatch(edit, /<Input label="Joining Date/);
assert.doesNotMatch(edit, /<Select label="Status/);
assert.match(detail, />Manage Work</);
assert.doesNotMatch(detail, /Manage Work Action/);
assert.match(detail, /Current Site & Contractor/);
assert.match(detail, /Effective From/);
assert.match(detail, /manageStatus/);
assert.match(detail, /status_only: true/);
assert.match(detail, /\/api\/labour\/workers\/\$\{params\.id\}\/deployments/);
assert.match(registration, /Labour Registration/);
assert.match(registration, /\/api\/labour\/workers\/register/);

console.log("Labour Registration UI cleanup rules passed");
