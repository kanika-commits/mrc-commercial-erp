import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync("supabase/migrations/202610140001_create_credit_notes.sql", "utf8");
const route = fs.readFileSync("app/api/credit-notes/route.ts", "utf8");

assert.match(migration, /create table if not exists public\.credit_note_documents/);
assert.match(migration, /file_name text/);
assert.match(migration, /file_url text/);
assert.doesNotMatch(migration, /mime_type/);
assert.doesNotMatch(route, /credit_note_documents"\)\.select\([^\n]*mime_type/);
assert.match(route, /downloaded\.data\.type \|\| "application\/octet-stream"/);
assert.match(route, /retry_filing/);
assert.match(route, /drive_filing_status: "filed"/);
assert.match(route, /drive_filing_status: "failed"/);

console.log("Credit Note attachment schema contract passed");
