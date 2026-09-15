import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const shell = read("app/platform/PlatformShell.tsx");
const list = read("app/platform/organizations/page.tsx");
const overview = read("app/api/platform/overview/route.ts");
const detail = read("app/api/platform/organizations/[id]/route.ts");

for (const source of [overview, detail]) assert.match(source, /requirePlatformOwner/);
assert.match(overview, /organizations/);
assert.match(detail, /organization_modules/);
assert.match(detail, /organization_domains/);
assert.match(detail, /maybeSingle/);
assert.match(shell, /\/platform\/organizations/);
assert.match(shell, /\/platform\/role-templates/);
assert.match(list, /Add Organization/);
assert.match(list, /\/platform\/organizations\/new/);
assert.doesNotMatch(overview, /rpc\(/);
assert.doesNotMatch(detail, /rpc\(/);

console.log("SiteQube read-only Platform Owner MVP rules: PASS");
