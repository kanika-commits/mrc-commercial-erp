import assert from "node:assert/strict";
import fs from "node:fs";

const items = fs.readFileSync("app/settings/items/page.tsx", "utf8");
const contacts = fs.readFileSync("app/settings/purchase-order-masters/site-contacts/page.tsx", "utf8");
const terms = fs.readFileSync("app/settings/purchase-order-masters/page.tsx", "utf8");

for (const [name, source, dependency] of [
  ["Item Master", items, "editing?.id"],
  ["Site Contact Master", contacts, "form?.id"],
]) {
  assert.match(source, /scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)/, `${name} scrolls the edit form into view`);
  assert.match(source, /scroll-mt-24/, `${name} reserves space below the sticky header`);
  const escapedDependency = dependency.replace(/[.?]/g, "\\$&");
  assert.match(source, new RegExp(`if \\(!${escapedDependency}`), `${name} ties scrolling to edit state`);
}

assert.match(terms, /scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)/, "Terms Master scrolls the edit form into view");
assert.match(terms, /if \(!form \|\| !form\.kind\.startsWith\("terms_"\)\) return;/, "Terms Master ties scrolling to its terms form state");

assert.match(items, /ref=\{editFormRef\}/);
assert.match(contacts, /ref=\{editFormRef\}/);
console.log("Master edit scroll behavior contracts passed.");
