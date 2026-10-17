import assert from "node:assert/strict";
import fs from "node:fs";

const files = [
  "app/api/credit-notes/route.ts",
  "app/api/credit-notes/documents/route.ts",
  "app/credit-notes/page.tsx",
  "app/credit-notes/new/page.tsx",
  "app/credit-notes/[id]/page.tsx",
  "app/credit-notes/approvals/page.tsx",
  "supabase/migrations/202610140001_create_credit_notes.sql",
];
for (const file of files) assert.equal(fs.existsSync(file), true, `${file} missing`);
const api = fs.readFileSync("app/api/credit-notes/route.ts", "utf8");
const migration = fs.readFileSync("supabase/migrations/202610140001_create_credit_notes.sql", "utf8");
assert.match(api, /from\("credit_notes"\)/);
assert.match(api, /from\("credit_note_documents"\)/);
assert.match(api, /credit_notes/);
assert.doesNotMatch(api, /from\("debit_notes"\)/);
assert.doesNotMatch(api, /api\/debit-notes/);
assert.match(migration, /create table if not exists public\.credit_notes/);
assert.match(migration, /credit_note_documents/);
assert.match(migration, /credit_note_rejections/);
assert.match(migration, /credit_note_audit/);
assert.doesNotMatch(migration, /debit_notes/);
const drive = fs.readFileSync("src/lib/googleDrive.ts", "utf8");
assert.doesNotMatch(drive, /CREDIT_NOTES_FOLDER_NAME/);
assert.match(drive, /action: "upload_file"/);
console.log("Credit Note isolation contract passed.");
