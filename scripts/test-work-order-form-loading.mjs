import assert from "node:assert/strict";
import fs from "node:fs";

const form = fs.readFileSync("app/work-orders/new/structured/page.tsx", "utf8");
const lookup = fs.readFileSync("app/api/work-orders/create-lookups/route.ts", "utf8");
const notifications = fs.readFileSync("components/NotificationCenter.tsx", "utf8");
const availability = fs.readFileSync("app/api/work-orders/pilot/availability/route.ts", "utf8");

assert.match(form, /lookupRequestRef = useRef<Promise<any> \| null>\(null\)/);
assert.match(form, /lookupRequestRef\.current \|\| \(lookupRequestRef\.current = requestWithTimeout\("\/api\/work-orders\/create-lookups", "Work Order lookup loading"\)\)/);
assert.match(form, /REQUEST_TIMEOUT_MS/);
assert.match(form, /work-order-draft-error-summary/);
assert.match(form, /company_id=\$\{encodeURIComponent\(form\.company_id\)\}/);
assert.match(form, /site_id=\$\{encodeURIComponent\(form\.site_id\)\}/);
assert.match(lookup, /Promise\.all\(\[vendorContactsPromise, Promise\.all\(dependentQueries/);
assert.match(lookup, /\.in\("site_id", Array\.from\(accessibleSiteIds\)\)/);
assert.match(notifications, /loadingRef = useRef\(false\)/);
assert.match(notifications, /setTimeout\(\(\) => void load\(\), 1000\)/);
assert.match(availability, /export async function GET\(request: Request\)/);

console.log("Work Order form loading, scoped lookup, notification deferral, and availability contracts passed.");
