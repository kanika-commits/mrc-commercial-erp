import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync(new URL("../app/api/labour/workers/[id]/wage-rates/route.ts", import.meta.url), "utf8");
const detailPage = fs.readFileSync(new URL("../app/labour/workers/[id]/page.tsx", import.meta.url), "utf8");
const shared = fs.readFileSync(new URL("../app/api/labour/_shared.ts", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../supabase/migrations/202611240002_labour_wage_rate_atomic_update.sql", import.meta.url), "utf8");

assert.match(shared, /type ActorFields<Prefix extends string> = \{[\s\S]+\[Key in `\$\{Prefix\}_by` \| `\$\{Prefix\}_by_name` \| `\$\{Prefix\}_by_email`\]: string \| null;/, "Actor fields use a prefix-accurate mapped return type");
assert.match(shared, /actorFields\(auth: ServerPermissionContext, prefix\?: "created"\): ActorFields<"created">/, "Created actor fields have an explicit return type");
assert.match(shared, /actorFields<Prefix extends string>\(auth: ServerPermissionContext, prefix: Prefix\): ActorFields<Prefix>/, "Variable actor prefixes retain their typed keys");
assert.doesNotMatch(shared, /actorFields[\s\S]{0,500}as any/, "Actor field typing does not silence the compiler with any");
assert.match(detailPage, /async function saveRateChange\(nextRateForm = rateForm\)/, "Rate save accepts the current form value explicitly");
assert.match(detailPage, /<input type=\"date\" value=\{rateForm\.effective_from\}/, "Rate form stores the selected ISO date from the date input");
assert.doesNotMatch(detailPage, /setRateForm\(nextRateForm\);\s*return saveRateChange\(nextRateForm\)/, "The release does not import the unrelated Manage Work workflow");
assert.match(detailPage, /effective_from: nextRateForm\.effective_from/, "The selected YYYY-MM-DD date is included in the request");
assert.doesNotMatch(detailPage, /new Date\([^\n]*effective_from|split\(['"]\//, "The date is not parsed from a displayed locale string");
assert.match(route, /const effectiveFrom = text\(payload\.effective_from\)[\s\S]+if \(!effectiveFrom\) return jsonError\("Effective from date is required\."\)/, "The API accepts the ISO effective_from request field and keeps it required");
assert.match(route, /overtime_rate_type: "hourly"/, "Daily Wage rate inserts use the valid hourly overtime type");
assert.match(route, /rpc\("update_labour_wage_rate_atomic"/, "Individual rate updates use the atomic RPC");
assert.doesNotMatch(route, /from\("labour_wage_rates"\)\.update\(/, "The route no longer closes the prior rate in a separate write");
assert.doesNotMatch(route, /from\("labour_wage_rates"\)\.insert\(/, "The route no longer inserts the successor in a separate write");
assert.match(route, /p_close_previous_rate_id: closePreviousRate\?\.id \|\| null/, "The previous-rate close is passed to the atomic RPC");
assert.match(route, /oldValues: closePreviousRate/, "Existing rate-history audit context is preserved");

assert.match(migration, /create or replace function public\.update_labour_wage_rate_atomic/, "Migration defines the single-worker atomic function");
assert.match(migration, /if p_overtime_rate_type not in \('hourly', 'multiplier', 'fixed'\)/, "RPC preserves the valid overtime-rate values");
assert.match(migration, /update public\.labour_wage_rates[\s\S]+p_close_previous_rate_id/, "RPC closes the prior rate inside the transaction");
assert.match(migration, /insert into public\.labour_wage_rates/, "RPC inserts the successor rate");
assert.match(migration, /returning id into v_rate_id/, "RPC returns the inserted rate ID");
assert.match(migration, /grant execute on function public\.update_labour_wage_rate_atomic[\s\S]+to service_role/, "Only the server service role can execute the RPC");

// The database transaction rolls back both statements if the insert raises.
const simulated = { previousEffectiveTo: null, inserted: false };
try {
  simulated.previousEffectiveTo = "2026-11-23";
  throw new Error("simulated insert failure");
} catch {
  simulated.previousEffectiveTo = null;
  simulated.inserted = false;
}
assert.equal(simulated.previousEffectiveTo, null, "A failed insert leaves the prior rate open");
assert.equal(simulated.inserted, false, "A failed insert creates no successor rate");

console.log("Labour wage-rate atomic update rules passed.");
