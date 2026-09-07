import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { adminClient, applyOrganizationAccess, jsonError, requireProcurementPermission, text } from "@/lib/serverProcurementAccess";
import { createPrivateStorageAdapter, safeObjectKey } from "@/lib/storage/privateStorage";
import { recordAuditEvent } from "@/lib/auditEvent";

const MODULE = "procurement_letterhead_master";
const BUCKET = "procurement-company-letterhead-assets";
const MAX_BYTES = 10 * 1024 * 1024;
const LAYOUT_KEYS = ["header_height_points", "footer_height_points", "content_margin_left_points", "content_margin_right_points", "content_gap_after_header_points", "content_gap_before_footer_points"];
function actor(access: any) { return { id: access.user.id, name: text(access.user.user_metadata?.full_name || access.user.user_metadata?.name || access.user.email), email: access.user.email || null }; }
function scoped(access: any, organizationId: string, companyId?: string) { return access.isGlobalAccess || ((access.organizations || []).includes(organizationId) && (!companyId || !(access.companies || []).length || access.companies.includes(companyId))); }
async function guard(request: Request, action: "view" | "add" | "edit" | "delete") { return requireProcurementPermission(request, MODULE, action); }
async function validatePng(file: File, label: string) {
  if (file.type !== "image/png") return { error: `${label} must be a PNG image.` };
  if (file.size <= 0 || file.size > MAX_BYTES) return { error: `${label} image must not exceed 10 MB.` };
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length < 24 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") return { error: `${label} image is corrupt or invalid.` };
  const width = bytes.readUInt32BE(16); const height = bytes.readUInt32BE(20); const minimum = label === "Header" ? [800, 180] : [800, 100];
  if (width < minimum[0] || height < minimum[1]) return { error: `${label} image resolution is too low for a sharp A4 Purchase Order.` };
  return { bytes, width, height, hash: createHash("sha256").update(bytes).digest("hex") };
}

export async function GET(request: Request) {
  try {
    const access = await guard(request, "view"); if ("response" in access) return access.response;
    const admin = adminClient(); const url = new URL(request.url); const versionId = url.searchParams.get("version_id");
    if (versionId) {
      const result = await admin.from("procurement_company_letterhead_versions").select("*,letterhead:procurement_company_letterheads!inner(organization_id,company_id)").eq("id", versionId).maybeSingle();
      if (result.error) throw result.error; if (!result.data || !scoped(access, result.data.letterhead.organization_id, result.data.letterhead.company_id)) return jsonError("Letterhead version is outside your access.", 403);
      const adapter = createPrivateStorageAdapter(admin); const urls: any = {};
      for (const field of ["header", "footer"] as const) { const bucket = result.data[`${field}_storage_bucket`]; const key = result.data[`${field}_storage_key`]; if (bucket && key) urls[field] = await adapter.createSignedReadUrl({ bucket, key, expiresIn: 300 }); }
      return NextResponse.json({ version: result.data, urls });
    }
    const query = applyOrganizationAccess(admin.from("procurement_company_letterheads").select("*,company:companies(id,company_name,company_code),versions:procurement_company_letterhead_versions(*)").order("company_id").order("letterhead_name"), access);
    if (!query) return NextResponse.json({ letterheads: [] }); const result = await query; if (result.error) throw result.error; return NextResponse.json({ letterheads: result.data || [] });
  } catch { return jsonError("Could not load Company Letterheads.", 500); }
}

export async function POST(request: Request) {
  try {
    const access = await guard(request, "add"); if ("response" in access) return access.response; const form = await request.formData(); const companyId = text(form.get("company_id")); const name = text(form.get("letterhead_name"));
    if (!companyId || !name) return jsonError("Company and Letterhead Name are required.", 400); const admin = adminClient(); const company = await admin.from("companies").select("id,organization_id,status").eq("id", companyId).maybeSingle();
    if (company.error) throw company.error; if (!company.data || company.data.status !== "active") return jsonError("Selected company is invalid or inactive.", 400); if (!scoped(access, company.data.organization_id, companyId)) return jsonError("Selected company is outside your access.", 403);
    const a = actor(access); const logical = await admin.from("procurement_company_letterheads").insert({ organization_id: company.data.organization_id, company_id: companyId, letterhead_name: name, created_by: a.id, created_by_name: a.name, created_by_email: a.email }).select("id").single(); if (logical.error) throw logical.error;
    const version = await admin.from("procurement_company_letterhead_versions").insert({ organization_id: company.data.organization_id, letterhead_id: logical.data.id, version_number: 1, created_by: a.id }).select("id").single(); if (version.error) throw version.error; await recordAuditEvent(admin, access.user, { organizationId: company.data.organization_id, companyId, moduleCode: MODULE, entityType: "letterhead", recordId: logical.data.id, action: "create", actionCategory: "create", activityLabel: "Created Letterhead", description: `Created letterhead ${name}.`, newValues: { letterhead_name: name, company_id: companyId } }, request); return NextResponse.json({ id: logical.data.id, version_id: version.data.id });
  } catch (error: any) { if (error?.code === "23505") return jsonError("A Company Letterhead with this name already exists for the selected company.", 409); return jsonError("Could not create Company Letterhead.", 500); }
}

export async function PUT(request: Request) {
  try {
    const access = await guard(request, "edit"); if ("response" in access) return access.response; const form = await request.formData(); const versionId = text(form.get("version_id")); if (!versionId) return jsonError("Letterhead version is required.", 400); const admin = adminClient();
    const current = await admin.from("procurement_company_letterhead_versions").select("*,letterhead:procurement_company_letterheads!inner(organization_id,company_id)").eq("id", versionId).maybeSingle(); if (current.error) throw current.error; if (!current.data || !scoped(access, current.data.letterhead.organization_id, current.data.letterhead.company_id)) return jsonError("Letterhead version is outside your access.", 403); if (current.data.version_status === "ready") return jsonError("Ready Letterhead versions are immutable. Create a new version.", 409);
    const patch: any = {}; for (const key of LAYOUT_KEYS) if (form.has(key)) { const value = Number(form.get(key)); if (!Number.isFinite(value) || value < 0) return jsonError("Letterhead layout values must be valid non-negative numbers.", 400); patch[key] = value; }
    for (const field of ["header", "footer"] as const) { const file = form.get(field); if (!(file instanceof File) || file.size === 0) continue; const meta = await validatePng(file, field === "header" ? "Header" : "Footer"); if (meta.error || !meta.bytes) return jsonError(meta.error || `${field} image is invalid.`, 400); const key = safeObjectKey([current.data.letterhead.organization_id, current.data.letterhead.company_id, current.data.letterhead_id, current.data.id, `${field}-${crypto.randomUUID()}.png`]); const stored = await createPrivateStorageAdapter(admin).upload({ bucket: BUCKET, key, file }); patch[`${field}_storage_provider`] = stored.provider; patch[`${field}_storage_bucket`] = BUCKET; patch[`${field}_storage_key`] = key; patch[`${field}_original_file_name`] = file.name; patch[`${field}_mime_type`] = file.type; patch[`${field}_size_bytes`] = meta.bytes.length; patch[`${field}_width_px`] = meta.width; patch[`${field}_height_px`] = meta.height; patch[`${field}_content_hash`] = meta.hash; }
    const bodyArea = Number(patch.header_height_points ?? current.data.header_height_points) + Number(patch.footer_height_points ?? current.data.footer_height_points) + Number(patch.content_gap_after_header_points ?? current.data.content_gap_after_header_points) + Number(patch.content_gap_before_footer_points ?? current.data.content_gap_before_footer_points); if (bodyArea >= 842) return jsonError("Letterhead layout leaves no usable A4 content area.", 400);
    const result = await admin.from("procurement_company_letterhead_versions").update(patch).eq("id", versionId).eq("version_status", "draft"); if (result.error) throw result.error; await recordAuditEvent(admin, access.user, { organizationId: current.data.letterhead.organization_id, companyId: current.data.letterhead.company_id, moduleCode: MODULE, entityType: "letterhead_version", recordId: versionId, action: "update", actionCategory: "update", activityLabel: "Updated Letterhead", description: "Updated Letterhead draft.", oldValues: current.data, newValues: patch }, request); return NextResponse.json({ ok: true });
  } catch { return jsonError("Could not save Company Letterhead draft.", 500); }
}

export async function PATCH(request: Request) {
  try {
    const access = await guard(request, "edit"); if ("response" in access) return access.response; const body = await request.json(); const action = text(body.action); const admin = adminClient();
    const lookup = await admin.from("procurement_company_letterhead_versions").select("*,letterhead:procurement_company_letterheads!inner(id,organization_id,company_id,status,is_default)").eq("id", text(body.version_id)).maybeSingle(); if (lookup.error) throw lookup.error; const version = lookup.data; if (!version || !scoped(access, version.letterhead.organization_id, version.letterhead.company_id)) return jsonError("Letterhead version is outside your access.", 403);
    if (action === "ready") { if (version.version_status !== "draft" || !version.header_storage_key || !version.footer_storage_key || !version.header_content_hash || !version.footer_content_hash || !version.header_width_px || !version.footer_width_px) return jsonError("Upload valid header and footer PNG files before marking Ready.", 400); const result = await admin.from("procurement_company_letterhead_versions").update({ version_status: "ready" }).eq("id", version.id).eq("version_status", "draft"); if (result.error) throw result.error; await recordAuditEvent(admin, access.user, { organizationId: version.organization_id, companyId: version.letterhead.company_id, moduleCode: MODULE, entityType: "letterhead_version", recordId: version.id, action: "update", actionCategory: "workflow", activityLabel: "Marked Letterhead Ready", description: "Marked Letterhead version ready.", oldValues: { version_status: version.version_status }, newValues: { version_status: "ready", operation: "ready" } }, request); return NextResponse.json({ ok: true }); }
    if (action === "default") { if (version.version_status !== "ready" || version.letterhead.status !== "active") return jsonError("Only an active Letterhead with a Ready version can be default.", 400); const result = await admin.rpc("make_procurement_company_letterhead_default_atomic", { p_organization_id: version.letterhead.organization_id, p_company_id: version.letterhead.company_id, p_letterhead_id: version.letterhead.id, p_actor: access.user.id }); if (result.error) throw result.error; await recordAuditEvent(admin, access.user, { organizationId: version.organization_id, companyId: version.letterhead.company_id, moduleCode: MODULE, entityType: "letterhead", recordId: version.letterhead.id, action: "update", actionCategory: "workflow", activityLabel: "Set Letterhead Default", description: "Set Letterhead as the company default.", newValues: { operation: "set_default", version_id: version.id } }, request); return NextResponse.json({ ok: true }); }
    if (action === "toggle") { if (version.letterhead.status === "active" && version.letterhead.is_default) return jsonError("Choose another default Letterhead before deactivating this one.", 409); const nextStatus = version.letterhead.status === "active" ? "inactive" : "active"; const result = await admin.from("procurement_company_letterheads").update({ status: nextStatus, is_default: false }).eq("id", version.letterhead.id); if (result.error) throw result.error; await recordAuditEvent(admin, access.user, { organizationId: version.organization_id, companyId: version.letterhead.company_id, moduleCode: MODULE, entityType: "letterhead", recordId: version.letterhead.id, action: "update", actionCategory: "workflow", activityLabel: `${nextStatus === "active" ? "Activated" : "Deactivated"} Letterhead`, description: `${nextStatus === "active" ? "Activated" : "Deactivated"} Letterhead.`, oldValues: { status: version.letterhead.status }, newValues: { status: nextStatus, operation: "toggle" } }, request); return NextResponse.json({ ok: true }); }
    if (action === "new_version") { if (version.version_status !== "ready") return jsonError("Only a Ready Letterhead can create a new version.", 400); for (let attempt = 0; attempt < 3; attempt += 1) { const latest = await admin.from("procurement_company_letterhead_versions").select("version_number").eq("letterhead_id", version.letterhead.id).order("version_number", { ascending: false }).limit(1).maybeSingle(); if (latest.error) throw latest.error; const inserted = await admin.from("procurement_company_letterhead_versions").insert({ organization_id: version.organization_id, letterhead_id: version.letterhead.id, version_number: Number(latest.data?.version_number || 0) + 1, created_by: access.user.id, header_height_points: version.header_height_points, footer_height_points: version.footer_height_points, content_margin_left_points: version.content_margin_left_points, content_margin_right_points: version.content_margin_right_points, content_gap_after_header_points: version.content_gap_after_header_points, content_gap_before_footer_points: version.content_gap_before_footer_points }).select("id").maybeSingle(); if (!inserted.error) { await recordAuditEvent(admin, access.user, { organizationId: version.organization_id, companyId: version.letterhead.company_id, moduleCode: MODULE, entityType: "letterhead_version", recordId: inserted.data?.id, action: "create", actionCategory: "create", activityLabel: "Created Letterhead Version", description: "Created a new Letterhead version.", newValues: { operation: "new_version", letterhead_id: version.letterhead.id, version_id: inserted.data?.id } }, request); return NextResponse.json({ id: inserted.data?.id }); } if (inserted.error.code !== "23505") throw inserted.error; } return jsonError("Could not allocate a new Letterhead version. Please try again.", 409); }
    return jsonError("Unsupported Letterhead action.", 400);
  } catch { return jsonError("Could not update Company Letterhead.", 500); }
}

function snapshotReferences(snapshot: any, letterhead: any, version: any) {
  const selection = snapshot?.master_selection || {};
  const frozen = snapshot?.letterhead || {};
  return selection.letterhead_id === letterhead.id
    || (version && selection.letterhead_version_id === version.id)
    || frozen.letterhead_id === letterhead.id
    || (version && frozen.version_id === version.id)
    || (version && version.header_storage_key && frozen.header_storage_key === version.header_storage_key)
    || (version && version.footer_storage_key && frozen.footer_storage_key === version.footer_storage_key);
}

export async function DELETE(request: Request) {
  try {
    const access = await guard(request, "delete"); if ("response" in access) return access.response;
    const body = await request.json().catch(() => ({})); const versionId = text(body.version_id); const letterheadId = text(body.letterhead_id); if (!versionId && !letterheadId) return jsonError("Letterhead version or master is required.", 400);
    const admin = adminClient();
    if (!versionId) {
      const lookup = await admin.from("procurement_company_letterheads").select("id,organization_id,company_id,status,is_default,letterhead_name,versions:procurement_company_letterhead_versions(id)").eq("id", letterheadId).maybeSingle();
      if (lookup.error) throw lookup.error; const letterhead = lookup.data;
      if (!letterhead || !scoped(access, letterhead.organization_id, letterhead.company_id)) return jsonError("Letterhead is outside your access.", 403);
      if (letterhead.status === "active" || letterhead.is_default) return jsonError("Only an inactive, non-default Letterhead can be removed.", 409);
      if ((letterhead.versions || []).length) return jsonError("This Letterhead still has versions and cannot be removed.", 409);
      const references = await admin.from("procurement_purchase_orders").select("id,po_number,delivery_snapshot").eq("organization_id", letterhead.organization_id).eq("company_id", letterhead.company_id);
      if (references.error) throw references.error;
      if ((references.data || []).some((po: any) => snapshotReferences(po.delivery_snapshot, letterhead, null))) return jsonError("This Letterhead is referenced by a Purchase Order and cannot be removed.", 409);
      const deleted = await admin.from("procurement_company_letterheads").delete().eq("id", letterhead.id).eq("status", "inactive").eq("is_default", false).select("id").maybeSingle();
      if (deleted.error) throw deleted.error;
      if (!deleted.data) return jsonError("The inactive Letterhead could not be removed because a protected dependency remains.", 409);
      return NextResponse.json({ deleted: true, parent_deleted: true });
    }
    const lookup = await admin.from("procurement_company_letterhead_versions").select("*,letterhead:procurement_company_letterheads!inner(id,organization_id,company_id,status,is_default,letterhead_name)").eq("id", versionId).maybeSingle();
    if (lookup.error) throw lookup.error; const version = lookup.data;
    if (!version || !scoped(access, version.letterhead.organization_id, version.letterhead.company_id)) return jsonError("Letterhead version is outside your access.", 403);
    if (version.version_status !== "draft") return jsonError("Only an unused Draft Letterhead version can be deleted. Deactivate Ready or Active records instead.", 409);
    if (version.letterhead.is_default) return jsonError("Choose another default Letterhead before deleting this one.", 409);
    const references = await admin.from("procurement_purchase_orders").select("id,po_number,delivery_snapshot").eq("organization_id", version.letterhead.organization_id).eq("company_id", version.letterhead.company_id);
    if (references.error) throw references.error;
    if ((references.data || []).some((po: any) => snapshotReferences(po.delivery_snapshot, version.letterhead, version))) return jsonError("This Letterhead is frozen into a Purchase Order and cannot be deleted. Deactivate it instead.", 409);
    const versions = await admin.from("procurement_company_letterhead_versions").select("id").eq("letterhead_id", version.letterhead.id);
    if (versions.error) throw versions.error;
    const onlyVersion = (versions.data || []).length === 1;
    if (onlyVersion && (version.letterhead.status === "active" || version.letterhead.is_default)) return jsonError("The final Draft version cannot be deleted while its Letterhead is active or default. Deactivate it only after configuring another Letterhead.", 409);
    const deleted = await admin.from("procurement_company_letterhead_versions").delete().eq("id", version.id).eq("version_status", "draft");
    if (deleted.error) throw deleted.error;
    if (onlyVersion) {
      const remaining = await admin.from("procurement_company_letterhead_versions").select("id").eq("letterhead_id", version.letterhead.id).limit(1);
      if (remaining.error) throw remaining.error;
      const referencesAfterDelete = await admin.from("procurement_purchase_orders").select("id,delivery_snapshot").eq("organization_id", version.letterhead.organization_id).eq("company_id", version.letterhead.company_id);
      if (referencesAfterDelete.error) throw referencesAfterDelete.error;
      const stillReferenced = (referencesAfterDelete.data || []).some((po: any) => snapshotReferences(po.delivery_snapshot, version.letterhead, version));
      if (remaining.data?.length || stillReferenced || version.letterhead.status === "active" || version.letterhead.is_default) return jsonError("The Draft version was deleted, but its Letterhead could not be safely removed because a protected dependency remains.", 409);
      const logical = await admin.from("procurement_company_letterheads").delete().eq("id", version.letterhead.id).eq("status", "inactive").eq("is_default", false).select("id").maybeSingle();
      if (logical.error) throw logical.error;
      if (!logical.data) return jsonError("The Draft version was deleted, but its inactive Letterhead could not be removed because a protected dependency remains.", 409);
    }
    const adapter = createPrivateStorageAdapter(admin);
    for (const field of ["header", "footer"] as const) {
      const bucket = version[`${field}_storage_bucket`]; const key = version[`${field}_storage_key`];
      if (bucket && key) await adapter.delete({ bucket, key });
    }
    return NextResponse.json({ deleted: true });
  } catch (error: any) { return jsonError(error.message || "Could not delete unused Draft Letterhead.", 500); }
}
