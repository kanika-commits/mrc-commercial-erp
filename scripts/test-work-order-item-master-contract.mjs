import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  "supabase/migrations/202609300001_work_order_item_master_and_lines.sql",
  "utf8",
);

assert.match(migration, /create table if not exists public\.work_order_item_masters/);
assert.match(migration, /organization_id uuid not null references public\.organizations\(id\)/);
for (const field of ["item_header", "description", "unit", "mode_of_measurement"]) {
  assert.match(migration, new RegExp(`\\b${field}\\b`));
}
assert.match(migration, /create table if not exists public\.work_order_items/);
assert.match(migration, /work_order_id uuid not null references public\.work_orders\(id\)/);
assert.match(migration, /item_master_id uuid not null references public\.work_order_item_masters\(id\)/);
for (const snapshot of ["item_header_snapshot", "description_snapshot", "unit_snapshot", "mode_of_measurement_snapshot"]) {
  assert.match(migration, new RegExp(`\\b${snapshot}\\b`));
}
assert.match(migration, /enable row level security/);
assert.match(migration, /grant all on table public\.work_order_item_masters, public\.work_order_items to service_role/);
assert.doesNotMatch(migration, /procurement_items|procurement_purchase_order_templates|procurement_purchase_orders/);
const compatibility = fs.readFileSync("supabase/migrations/202609300002_work_order_pdf_template_compatibility.sql", "utf8");
assert.match(compatibility, /supports_work_orders boolean/);
assert.match(compatibility, /alter table public\.work_orders/);
assert.match(compatibility, /template_snapshot jsonb/);
assert.match(compatibility, /generated_pdf_upload_key/);
const previewRoute = fs.readFileSync("app/api/work-orders/[id]/generated-pdf/route.ts", "utf8");
const renderer = fs.readFileSync("lib/workOrderApprovedPdf.server.ts", "utf8");
assert.match(previewRoute, /requireAnyPermission\(request, \[/);
assert.match(renderer, /from\("work_order_items"\)/);
assert.match(previewRoute, /Content-Type.*application\/pdf/);
console.log("Work Order Item Master additive contract passed.");
