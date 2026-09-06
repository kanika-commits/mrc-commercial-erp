import fs from "node:fs";
import assert from "node:assert/strict";
const root = new URL("..", import.meta.url).pathname;
const read = (file) => fs.readFileSync(`${root}/${file}`, "utf8");
for (const file of ["app/api/procurement/inventory/route.ts", "app/api/procurement/inventory/[id]/route.ts", "app/api/procurement/material-issues/[id]/route.ts"]) {
  const source = read(file);
  assert.match(source, /requireProcurement/);
  assert.match(source, /applyOrganizationAccess/);
  assert.match(source, /applyCompanySiteAccess/);
}
assert.match(read("app/api/procurement/inventory/route.ts"), /in\("id", body\.items/);
assert.match(read("app/api/procurement/material-issues/[id]/route.ts"), /applyCompanySiteAccess/);
console.log("Procurement inventory authorization rules: PASS");
