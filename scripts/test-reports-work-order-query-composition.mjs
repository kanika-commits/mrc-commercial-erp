import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync("app/api/reports/run/route.ts", "utf8");

assert.match(route, /return \{ query: applyFilters\(query, filters\) \};/, "The base query must remain composable");
assert.match(route, /return \{ query \};/, "A vendor-free query must not be executed before pagination");
assert.match(route, /return \{ query: query\.in\("id", workOrderIds\) \};/, "Vendor filtering must return a composable query");
assert.match(route, /const base = await baseQuery\(admin, auth, definition\.filters\);/, "Report execution must await the query wrapper, not the Supabase builder");
assert.match(route, /const filtered = await applyVendorFilter\(admin, base\.query, definition\.filters\.vendor_id\);/, "Vendor filtering must preserve the query wrapper");
assert.match(route, /const \{ data, error, count \} = await query\.limit\(5000\);/, "Aggregate reports must paginate the builder after composition");
assert.doesNotMatch(route, /let query = await baseQuery\(/, "Awaiting a Supabase builder would cause r.limit is not a function");
assert.doesNotMatch(route, /query = await applyVendorFilter\(/, "Awaiting a Supabase builder returned by a filter would execute it early");

console.log("Report query composition rules passed.");
