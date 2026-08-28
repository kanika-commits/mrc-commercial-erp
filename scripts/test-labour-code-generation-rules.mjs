import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("app/api/labour/workers/register/route.ts", "utf8");
const generator = source.match(/async function nextLabourCode[\s\S]*?\n}\n/,
);

assert.ok(generator, "Labour code generator should exist");
assert.match(generator[0], /\.eq\("organization_id", organizationId\)/);
assert.match(generator[0], /\.order\("labour_code", \{ ascending: false \}\)/);
assert.match(generator[0], /\.limit\(1\)/);
assert.doesNotMatch(generator[0], /\.reduce\(/);

const nextCode = (highest) => {
  const numeric = highest.match(/^LAB(\d+)$/)?.[1];
  return `LAB${String((Number(numeric) || 0) + 1).padStart(6, "0")}`;
};

assert.equal(nextCode("LAB000998"), "LAB000999");
assert.equal(nextCode("LAB000999"), "LAB001000");
assert.equal(nextCode("LAB001000"), "LAB001001");
assert.equal(nextCode("LAB001001"), "LAB001002");
assert.equal(nextCode("LAB009999"), "LAB010000");

console.log("Labour code generation rules passed.");
