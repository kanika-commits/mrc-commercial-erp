import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/forms/pilot/ra-bills/[id]/page.tsx", "utf8");
const route = fs.readFileSync("app/api/work-orders/pilot-ra-bills/[id]/route.ts", "utf8");
const detail = fs.readFileSync("app/api/work-orders/pilot-ra-bills/[id]/detail/route.ts", "utf8");

assert.match(page, /Pilot RA Bill not found/);
assert.ok(page.includes("[0-9a-f]{8}"));
assert.match(route, /const isUuid/);
assert.match(route, /if \(!isUuid\(id\)\) return NextResponse\.json\(\{ error: "Pilot RA Bill not found\." \}, \{ status: 404 \}\)/);
assert.match(detail, /const isUuid/);
assert.match(detail, /if \(!isUuid\(id\)\)/);
console.log("Pilot RA Bill invalid-ID diagnostic route contract passed.");
