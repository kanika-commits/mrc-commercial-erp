import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/credit-notes/new/page.tsx", "utf8");
const route = fs.readFileSync("app/api/credit-notes/route.ts", "utf8");

assert.match(page, /\/api\/credit-notes\?next_number=1/);
assert.match(page, /if \(editId \|\| !form\.work_order_id\) return/);
assert.match(page, /form\.work_order_id\]\);/);
assert.match(page, /Suggested number: \$\{form\.credit_note_number\}/);
assert.match(page, /Loading next Credit Note number/);
assert.match(page, /name="credit_note_number" value=\{form\.credit_note_number\}/);
assert.match(route, /next_number/);
assert.match(route, /credit_note_number,organization_id,approval_status/);
assert.doesNotMatch(route, /deleted_at/);
assert.match(route, /String\(note\.approval_status \|\| ""\)\.toLowerCase\(\) !== "rejected"/);
assert.match(route, /return NextResponse\.json\(\{ next_number: String\(maximum \+ 1\) \}\)/);
assert.match(route, /Credit Note number already exists/);
console.log("Credit Note number suggestion contract passed.");
