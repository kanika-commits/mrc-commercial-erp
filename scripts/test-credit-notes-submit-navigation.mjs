import assert from "node:assert/strict";
import fs from "node:fs";

const form = fs.readFileSync("app/credit-notes/new/page.tsx", "utf8");
const queue = fs.readFileSync("app/approvals/page.tsx", "utf8");
const compatibility = fs.readFileSync("app/credit-notes/approvals/page.tsx", "utf8");
const api = fs.readFileSync("app/api/credit-notes/route.ts", "utf8");

assert.doesNotMatch(form, /Linked RA Bill/);
assert.doesNotMatch(form, /ra_bill_id/);
assert.match(form, /router\.push\(`\/approvals\?credit_note_submitted=/);
assert.doesNotMatch(form, /router\.push\(`\/credit-notes\/\$\{/);
assert.match(form, /files\.forEach\(\(file\) => data\.append\("attachments", file\)\)/);
assert.match(form, /setMessage\(error\.message/);
assert.match(api, /credit_note_documents/);
assert.match(api, /storage\.from\(BUCKET\)\.upload/);
assert.match(queue, /Pending Credit Notes/);
assert.match(queue, /updateCreditNoteStatus/);
assert.match(compatibility, /redirect\("\/approvals"\)/);
assert.match(queue, /credit-notes\/\$\{note\.id\}/);
assert.match(queue, /api\/credit-notes\?credit_note_id/);

console.log("Credit Note submit, queue, and attachment contract passed.");
