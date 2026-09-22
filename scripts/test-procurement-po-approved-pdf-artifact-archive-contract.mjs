import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile("supabase/migrations/202609220002_procurement_po_approved_pdf_artifact_archive.sql", "utf8");
const approvalRoute = await readFile("app/api/procurement/purchase-orders/[id]/route.ts", "utf8");
const pdfRoute = await readFile("app/api/procurement/purchase-orders/[id]/pdf/route.ts", "utf8");
const retryRoute = await readFile("app/api/procurement/purchase-orders/[id]/pdf/archive/route.ts", "utf8");
const archive = await readFile("lib/procurement/poOfficialArtifact.server.ts", "utf8");
const baseRenderer = await readFile("lib/procurement/poPdfBaseGeneration.server.ts", "utf8");
const approvalWorkflow = await readFile("supabase/migrations/202609120004_procurement_po_revision_stage_c1_workflow.sql", "utf8");

assert.match(migration, /create table if not exists public\.procurement_purchase_order_artifacts/i);
assert.match(migration, /unique \(organization_id, purchase_order_id, artifact_type\)/i);
assert.match(migration, /on delete restrict/i);
assert.match(migration, /artifact_status in \('pending', 'archiving', 'archived', 'failed'\)/i);
assert.match(migration, /old\.artifact_status = 'archived'[\s\S]*?immutable/i);
assert.match(migration, /create table if not exists public\.procurement_purchase_order_artifact_archive_config/i);
assert.match(migration, /feature_enabled_at timestamptz not null default clock_timestamp\(\)/i);
assert.match(migration, /insert into public\.procurement_purchase_order_artifact_archive_config[\s\S]*?on conflict \(singleton\) do nothing/i);
assert.match(migration, /enable row level security/i);
assert.match(migration, /revoke all on table public\.procurement_purchase_order_artifact_archive_config from public, anon, authenticated/i);
assert.match(migration, /grant select on table public\.procurement_purchase_order_artifact_archive_config to service_role/i);
assert.doesNotMatch(migration, /seed_procurement_purchase_order_official_artifact|procurement_purchase_order_seed_official_artifact/i);
assert.doesNotMatch(migration, /create\s+trigger\s+[^;]*on\s+public\.procurement_purchase_orders/i);
assert.doesNotMatch(migration, /insert\s+into\s+public\.procurement_purchase_order_artifacts\s*\([^)]*\)\s*select/i);
assert.doesNotMatch(migration, /procurement_purchase_order_documents/i);
assert.doesNotMatch(migration, /create policy/i);
assert.match(approvalWorkflow, /approved_at\s*=\s*case when p_action='approve' then now\(\) else approved_at end/i);

assert.match(archive, /readOfficialPoArchiveFeatureEnabledAt/);
assert.match(archive, /approvalIsAtOrAfterArchiveFeatureEnable/);
assert.match(archive, /approvalTime >= enabledTime/);
assert.match(archive, /archiveOrigin\?: "approval" \| "reconstruction"/);
assert.match(archive, /archive_origin: input\.archiveOrigin \|\| "approval"/);
assert.match(archive, /No approval archive record exists for this Purchase Order revision; legacy approvals are not auto-backfilled/);
assert.match(retryRoute, /select\("id,organization_id,status,approved_at"\)/);
assert.match(retryRoute, /if \(!artifact\)[\s\S]*?readOfficialPoArchiveFeatureEnabledAt/);
assert.match(retryRoute, /approvalIsAtOrAfterArchiveFeatureEnable\(po\.approved_at, featureEnabledAt\)/);
assert.match(retryRoute, /if \(!approvalIsAtOrAfterArchiveFeatureEnable[\s\S]*?legacy revision[\s\S]*?return jsonError/);
assert.match(retryRoute, /archiveOrigin: "reconstruction"/);
assert.match(retryRoute, /ensureOfficialPoArtifact\(admin/);
assert.match(retryRoute, /\["pending", "failed"\]/);

// Approval must succeed even if the out-of-transaction archive callback fails;
// issuing and revision operations remain independent of archive row existence.
assert.match(approvalRoute, /if \(action === "approve" && rpc\.data\?\.status === "approved"\)/);
assert.match(approvalRoute, /after\(async \(\) =>[\s\S]*?catch \(archiveError\)[\s\S]*?console\.error/);
assert.match(approvalRoute, /catch \(scheduleError\)[\s\S]*?console\.error[\s\S]*?return NextResponse\.json\(\{ result: rpc\.data \}\)/);
assert.doesNotMatch(approvalRoute, /artifact_status.*(?:issue|revision)|(?:issue|revision).*artifact_status/i);

assert.match(approvalRoute, /transition_procurement_purchase_order_atomic/);
assert.match(approvalRoute, /if \(action === "approve" && rpc\.data\?\.status === "approved"\)/);
assert.match(approvalRoute, /after\(async \(\) =>/);
assert.match(approvalRoute, /Approved Purchase Order succeeded but official PDF archiving failed/);
assert.match(approvalRoute, /return NextResponse\.json\(\{ result: rpc\.data \}\)/);

assert.match(archive, /\.upload\(artifact\.storage_key, bytes,[\s\S]*?upsert: false/);
assert.match(archive, /createHash\("sha256"\)/);
assert.match(archive, /verifiedBytes\.byteLength !== bytes\.byteLength \|\| sha256\(verifiedBytes\) !== digest/);
assert.match(archive, /artifact_status: "archived"/);
assert.match(archive, /artifact_status: "failed"/);
assert.match(archive, /retry[\s\S]*?No approval archive record exists[\s\S]*?legacy approvals are not auto-backfilled/);
assert.match(baseRenderer, /export async function renderApprovedPurchaseOrderBasePdf/);
assert.doesNotMatch(baseRenderer, /appendPackage|procurement_purchase_order_documents/);

assert.match(pdfRoute, /readVerifiedOfficialPo/);
assert.match(pdfRoute, /if \(archived\)/);
assert.match(pdfRoute, /Archived Purchase Order PDF unavailable; using dynamic fallback/);
assert.match(pdfRoute, /renderPurchaseOrderBasePdf/);
assert.match(pdfRoute, /"X-PO-PDF-Source": pdfSource/);
assert.match(retryRoute, /requireProcurementPermission\(request, "procurement_purchase_orders", "approve"\)/);
assert.match(retryRoute, /applyOrganizationAccess/);
assert.match(retryRoute, /applyCompanySiteAccess/);

console.log("PASS: archive-enable boundary, legacy protection, post-enable reconstruction retry, approval isolation, verified storage and scoped retry contracts");
