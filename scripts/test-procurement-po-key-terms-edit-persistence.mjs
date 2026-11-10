import assert from "node:assert/strict";
import fs from "node:fs";

const updateRoute = fs.readFileSync("app/api/procurement/purchase-orders/[id]/route.ts", "utf8");
const page = fs.readFileSync("app/purchase/purchase-orders/new/page.tsx", "utf8");
const renderer = fs.readFileSync("lib/procurement/poPdfRenderer.server.ts", "utf8");

const keyTermsAssignment = updateRoute.indexOf("if (Array.isArray(body.key_terms)) commercial.key_terms = body.key_terms;");
const persistedCommercial = updateRoute.indexOf("const persistedCommercial =", keyTermsAssignment);
assert.ok(keyTermsAssignment >= 0, "draft edit must accept submitted key terms");
assert.ok(persistedCommercial > keyTermsAssignment, "key terms must be included before the persisted commercial snapshot is built");
assert.match(updateRoute, /commercial: persistedCommercial/);
assert.match(page, /setKeyTerms\(normalizeSavedKeyTerms\(po\.commercial_snapshot\?\.key_terms \|\| \[\]\)\)/);
assert.match(page, /key_terms: keyTerms\.map\(normalizeKeyTerm\)/);
assert.match(renderer, /Array\.isArray\(row\.commercial_snapshot\?\.key_terms\)/);

console.log("PO draft key-term edit persistence contract passed.");
