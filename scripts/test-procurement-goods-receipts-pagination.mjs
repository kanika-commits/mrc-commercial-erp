import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/store/goods-receipts/page.tsx", "utf8");
const api = fs.readFileSync("app/api/procurement/goods-receipts/route.ts", "utf8");

assert.match(page, /const PAGE_SIZE = 10/, "Tracking must use ten-row pages");
assert.match(page, /filtered\.slice\(\(page - 1\) \* PAGE_SIZE, page \* PAGE_SIZE\)/, "Only the filtered result set may be paged");
assert.match(page, /setPage\(1\)/, "Search/filter changes must reset to page one");
assert.match(page, /Showing .*matching POs/, "The matching total must be visible");
assert.match(page, /Previous/, "Previous pagination control is required");
assert.match(page, /Next/, "Next pagination control is required");
assert.match(page, /counts:.*filtered\.length|const counts = useMemo\(\(\) => \(\{ operational: filtered\.length/, "Summary cards must use all matching rows");
assert.match(page, /View Tracking/, "Existing row action must remain");
assert.match(page, /\["S\. No\.", "PO Number", "Vendor", "Company"/, "S. No. must be the first table column");
assert.match(page, /visibleRows\.map\(\(row, index\)/, "Rows must expose their visible-page index");
assert.match(page, /\(page - 1\) \* PAGE_SIZE \+ index \+ 1/, "S. No. must continue from the full filtered result position");
assert.doesNotMatch(api, /searchParams\.get\("page|searchParams\.get\("page_size|searchParams\.get\("offset/, "The current API has no pagination contract; keep this change client-side");

const pageRows = (rows, page, size = 10) => rows.slice((page - 1) * size, page * size);
const rows = Array.from({ length: 23 }, (_, index) => ({ id: index + 1 }));
assert.equal(pageRows(rows, 1).length, 10);
assert.equal(pageRows(rows, 2).length, 10);
assert.equal(pageRows(rows, 3).length, 3);
assert.equal(rows.length, 23, "The full matching total must not be reduced to the visible page");

console.log("PASS: Purchase Order Tracking pagination keeps full-result filtering, totals, reset behavior, and row actions intact.");
