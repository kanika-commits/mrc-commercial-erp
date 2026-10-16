import assert from "node:assert/strict";
import fs from "node:fs";

const api = fs.readFileSync("app/api/credit-notes/route.ts", "utf8");
const form = fs.readFileSync("app/credit-notes/new/page.tsx", "utf8");
assert.match(api, /export async function PUT/);
assert.match(api, /Only pending Credit Notes can be edited/);
assert.match(api, /Only pending Credit Notes can be reviewed/);
assert.match(api, /linkedWorkOrder\.organization_id !== note\.organization_id/);
assert.match(form, /credit_note_id/);
assert.match(form, /method:\s*"PUT"/);
assert.match(form, /Saved documents/);
assert.doesNotMatch(api, /from\("debit_notes"\)/);
assert.doesNotMatch(form, /debit-notes/);
console.log("Credit Note edit and approval contract passed.");
