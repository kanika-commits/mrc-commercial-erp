import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/credit-notes/new/page.tsx", "utf8");
assert.match(page, /\/api\/commercial\/create-lookups/);
assert.match(page, /Unable to load Credit Note lookups from \/api\/commercial\/create-lookups/);
assert.match(page, /Unable to reach Supabase authentication while loading Credit Note form data/);
assert.doesNotMatch(page, /debit-notes/);
console.log("Credit Note lookup connectivity contract passed.");
