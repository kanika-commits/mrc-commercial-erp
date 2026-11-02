import assert from "node:assert/strict";
import fs from "node:fs";

const form = fs.readFileSync("app/work-orders/new/structured/preview/page.tsx", "utf8");
const create = fs.readFileSync("app/api/work-orders/create/route.ts", "utf8");
const register = fs.readFileSync("app/api/work-orders/register/route.ts", "utf8");

assert.match(form, /apiFetch\("\/api\/work-orders\/create", \{ method: "POST"/);
assert.match(form, /creation_request_id: draft\.creationRequestId/);
assert.match(create, /approval_status: "draft"/);
assert.match(create, /creation_request_id: creationRequestId \|\| null/);
assert.match(register, /pilotOnly = false/);
assert.match(register, /approval_status\.in\.\(draft,pending,approved\),status\.eq\.active/);
assert.match(register, /next = next\.not\("creation_request_id", "is", null\)/);
assert.match(register, /commonFilters\.pilotOnly/);

console.log("Pilot Work Order draft create-to-list contract passed.");
