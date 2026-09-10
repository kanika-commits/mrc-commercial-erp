import { NextResponse } from "next/server";
import { adminClient, applyOrganizationAccess, jsonError, requireProcurementAny, requireProcurementPermission, text } from "@/lib/serverProcurementAccess";
import { safeObjectKey } from "@/lib/storage/privateStorage";
import { recordAuditEvent } from "@/lib/auditEvent";

const MODULE = "procurement_purchase_orders";
const GST_BILLING_MODULE = "procurement_gst_billing_delivery_master";
const TERMS_MODULE = "procurement_po_terms_master";
const emptyId = "00000000-0000-0000-0000-000000000000";
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PO_TEMPLATE_BUCKET = "procurement-po-template-documents";
const PO_TEMPLATE_MIMES = new Set(["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);
const PO_TEMPLATE_MAX_BYTES = 20 * 1024 * 1024;

async function auditMasterMutation(admin: any, auth: any, request: Request, input: { organizationId: string; moduleCode: string; entityType: string; recordId?: string | null; action: "create" | "update" | "delete"; description: string; oldValues?: unknown; newValues?: unknown }) {
  await recordAuditEvent(admin, auth.user, {
    organizationId: input.organizationId,
    moduleCode: input.moduleCode,
    entityType: input.entityType,
    recordId: input.recordId,
    action: input.action,
    actionCategory: input.action === "delete" ? "delete" : input.action === "create" ? "create" : "update",
    activityLabel: `${input.action === "create" ? "Created" : input.action === "delete" ? "Deleted" : "Updated"} ${input.entityType.replaceAll("_", " ")}`,
    description: input.description,
    oldValues: input.oldValues,
    newValues: input.newValues,
  }, request);
}

function sourceInput(body: any) {
  const source = body.source || {};
  const path = text(source.path);
  const mimeType = text(source.mime_type);
  const filename = text(source.original_filename);
  const sizeBytes = Number(source.size_bytes || 0);
  if (!path || !filename || !PO_TEMPLATE_MIMES.has(mimeType) || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > PO_TEMPLATE_MAX_BYTES) return { error: "A PDF or DOCX template source file up to 20 MB is required.", status: 400 } as const;
  return { path, mimeType, filename, sizeBytes } as const;
}

async function verifySource(admin: any, organizationId: string, source: any) {
  if ("error" in source) return source;
  const prefix = `${organizationId}/`;
  if (!source.path.startsWith(prefix) || source.path.includes("..") || source.path.includes("\\")) return { error: "Template source is outside the authorized organization.", status: 403 } as const;
  const parts = source.path.split("/");
  const listed = await admin.storage.from(PO_TEMPLATE_BUCKET).list(parts.slice(0, -1).join("/"), { search: parts.at(-1), limit: 5 });
  if (listed.error) throw listed.error;
  const object = (listed.data || []).find((entry: any) => entry.name === parts.at(-1));
  if (!object) return { error: "Upload the template source file before saving.", status: 400 } as const;
  const metadata = object.metadata || {};
  const storedMime = metadata.mimetype || metadata.contentType || metadata.mime_type;
  const storedSize = Number(metadata.size || metadata.size_bytes || 0);
  if ((storedMime && storedMime !== source.mimeType) || (storedSize && storedSize !== source.sizeBytes)) return { error: "The uploaded template source metadata does not match the selected file.", status: 400 } as const;
  return source;
}

function legacyDeliveryAddress(body: any) {
  const structured = [body.address_line1, body.address_line2, body.city, body.state, body.pincode]
    .map((value) => text(value))
    .filter(Boolean)
    .join(", ");
  return structured || text(body.address) || null;
}

function masterModule(kind: string) {
  if (["billing_address", "delivery_location"].includes(kind)) return GST_BILLING_MODULE;
  if (["terms_template", "terms_section"].includes(kind)) return TERMS_MODULE;
  return MODULE;
}

async function authorize(request: Request, action: "view" | "add" | "edit", moduleCode = MODULE) {
  const moduleChecks = ["view", "add", "edit"].map((actionCode) => ({ moduleCode, actionCode }));
  return action === "view" ? requireProcurementAny(request, moduleChecks) : requireProcurementPermission(request, moduleCode, action);
}

function hasOrg(auth: any, organizationId: string) {
  return auth.isGlobalAccess || (auth.roleCodes || []).includes("platform_owner") || (auth.organizations || []).includes(organizationId);
}

function applySiteAccess(query: any, auth: any) {
  const scoped = applyOrganizationAccess(query, auth);
  if (!scoped || auth.isGlobalAccess || (auth.roleCodes || []).includes("platform_owner")) return scoped;
  return (auth.sites || []).length > 0 ? scoped.in("site_id", auth.sites) : scoped;
}

async function companyScope(admin: any, auth: any, companyId: string) {
  const result = await admin.from("companies").select("id,organization_id,status").eq("id", companyId).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data || result.data.status !== "active") return { error: "Selected company is invalid or inactive.", status: 400 } as const;
  if (!hasOrg(auth, result.data.organization_id) || ((auth.companies || []).length > 0 && !auth.companies.includes(companyId))) return { error: "Selected company is outside your access.", status: 403 } as const;
  return { organizationId: result.data.organization_id } as const;
}

async function siteScope(admin: any, auth: any, siteId: string) {
  const result = await admin.from("sites").select("id,organization_id,status").eq("id", siteId).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data || result.data.status !== "active") return { error: "Selected site is invalid or inactive.", status: 400 } as const;
  if (!hasOrg(auth, result.data.organization_id)) return { error: "Selected site is outside your organization access.", status: 403 } as const;
  if ((auth.sites || []).length > 0 && !auth.sites.includes(siteId)) return { error: "Selected site is outside your access.", status: 403 } as const;
  return { organizationId: result.data.organization_id } as const;
}

async function ownedOrganization(admin: any, auth: any, kind: string, id: string) {
    const queries: Record<string, Promise<any>> = {
    billing_address: admin.from("company_billing_addresses").select("id,organization_id,company_id").eq("id", id).maybeSingle(),
    site_contact: admin.from("site_contacts").select("id,organization_id,site_id").eq("id", id).maybeSingle(),
    terms_template: admin.from("company_po_terms_templates").select("id,organization_id,company_id").eq("id", id).maybeSingle(),
    terms_section: admin.from("company_po_terms_sections").select("id,status,template:company_po_terms_templates!inner(organization_id)").eq("id", id).maybeSingle(),
    po_template: admin.from("procurement_purchase_order_templates").select("id,organization_id,company_id").eq("id", id).maybeSingle(),
    po_template_version: admin.from("procurement_purchase_order_template_versions").select("id,template:procurement_purchase_order_templates!inner(organization_id)").eq("id", id).maybeSingle(),
    delivery_location: admin.from("site_delivery_locations").select("id,organization_id,company_id,site_id,billing_address_id").eq("id", id).maybeSingle(),
  };
  const result = await queries[kind];
  if (!result) return { error: "Unsupported master-data type.", status: 400 } as const;
  if (result.error) throw result.error;
  const organizationId = ["terms_section", "po_template_version"].includes(kind) ? result.data?.template?.organization_id : result.data?.organization_id;
  if (!result.data) return { error: "Master-data record was not found.", status: 404 } as const;
  if (!hasOrg(auth, organizationId)) return { error: "Master-data record is outside your organization access.", status: 403 } as const;
  if (kind === "site_contact") {
    const siteAccess = await siteScope(admin, auth, result.data.site_id);
    if ("error" in siteAccess) return siteAccess;
  }
  if (kind === "delivery_location") {
    const siteAccess = await siteScope(admin, auth, result.data.site_id);
    if ("error" in siteAccess) return siteAccess;
  }
  return { row: result.data, organizationId } as const;
}

export async function GET(request: Request) {
  try {
    const auth = await requireProcurementAny(request, [
      { moduleCode: GST_BILLING_MODULE, actionCode: "view" },
      { moduleCode: TERMS_MODULE, actionCode: "view" },
      { moduleCode: MODULE, actionCode: "view" },
    ]);
    if ("response" in auth) return auth.response;
    const admin = adminClient();
    const [companies, sites, billing, templates, locations, addressContacts, poTemplates] = await Promise.all([
      applyOrganizationAccess(admin.from("companies").select("id,organization_id,company_name,company_code,status").eq("status", "active").order("company_name"), auth),
      applyOrganizationAccess(admin.from("sites").select("id,organization_id,company_id,site_name,site_code,status").eq("status", "active").order("site_name"), auth),
      applyOrganizationAccess(admin.from("company_billing_addresses").select("*").order("company_id").order("is_default", { ascending: false }), auth),
      applyOrganizationAccess(admin.from("company_po_terms_templates").select("*,sections:company_po_terms_sections(*)").order("company_id").order("is_default", { ascending: false }), auth),
      applySiteAccess(admin.from("site_delivery_locations").select("*").order("site_id").order("is_default", { ascending: false }), auth),
      applyOrganizationAccess(admin.from("procurement_address_contacts").select("*").order("sort_order"), auth),
      applyOrganizationAccess(admin.from("procurement_purchase_order_templates").select("id,organization_id,company_id,template_name,template_code,status,is_default,updated_at,versions:procurement_purchase_order_template_versions(id,version_number,status,layout_definition,header_asset_reference,footer_asset_reference,source_storage_bucket,source_storage_path,source_original_filename,source_mime_type,source_size_bytes,source_uploaded_at,readiness_status,created_at)").order("company_id").order("template_name"), auth),
    ]);
    const results = [companies, sites, billing, templates, locations, addressContacts, poTemplates].filter(Boolean) as any[];
    for (const result of results) if (result.error) throw result.error;
    return NextResponse.json({ companies: companies?.data || [], sites: sites?.data || [], billing_addresses: billing?.data || [], terms_templates: templates?.data || [], delivery_locations: locations?.data || [], address_contacts: addressContacts?.data || [], po_templates: poTemplates?.data || [] });
  } catch (error: any) { return jsonError(error.message || "Failed to load Purchase Order master data.", 500); }
}

export async function POST(request: Request) { return mutate(request, "add"); }
export async function PUT(request: Request) { return mutate(request, "edit"); }

export async function DELETE(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const kind = text(body.kind); const id = text(body.id);
    const auth = await authorize(request, "edit", masterModule(kind));
    if ("response" in auth) return auth.response;
    const owned = await ownedOrganization(adminClient(), auth, kind, id);
    if ("error" in owned) return jsonError(owned.error || "Invalid master-data record.", owned.status || 400);
    const admin = adminClient();
    const table = kind === "billing_address" ? "company_billing_addresses" : kind === "site_contact" ? "site_contacts" : kind === "terms_template" ? "company_po_terms_templates" : kind === "delivery_location" ? "site_delivery_locations" : kind === "po_template" ? "procurement_purchase_order_templates" : "procurement_purchase_order_template_versions";
    const permanent = body.permanent === true;
    if (permanent) {
      if (kind !== "billing_address" && kind !== "delivery_location" && kind !== "site_contact" && kind !== "po_template" && kind !== "po_template_version") return jsonError("Only unused legacy address and site-contact records can be permanently deleted. Inactivate other master records instead.", 400);
      let templateVersions: any[] = [];
      if (kind === "po_template" || kind === "po_template_version") {
        const references = await admin.from("procurement_purchase_orders").select("id", { count: "exact", head: true }).eq("template_version_id", id);
        if (references.error) throw references.error;
        if (kind === "po_template_version") {
          const direct = await admin.from("procurement_purchase_orders").select("id", { count: "exact", head: true }).eq("template_id", id);
          if (direct.error) throw direct.error;
          if ((references.count || 0) + (direct.count || 0) > 0) return jsonError("This PO template version is used by a Purchase Order and cannot be deleted. Inactivate it instead.", 409);
        } else {
          const template = await admin.from("procurement_purchase_order_template_versions").select("id,source_storage_bucket,source_storage_path").eq("template_id", id);
          if (template.error) throw template.error;
          templateVersions = template.data || [];
          const versionIds = templateVersions.map((version: any) => version.id);
          const versionReferences = versionIds.length ? await admin.from("procurement_purchase_orders").select("id", { count: "exact", head: true }).in("template_version_id", versionIds) : { count: 0, error: null };
          if (versionReferences.error) throw versionReferences.error;
          const direct = await admin.from("procurement_purchase_orders").select("id", { count: "exact", head: true }).eq("template_id", id);
          if (direct.error) throw direct.error;
          if ((direct.count || 0) + (versionReferences.count || 0) > 0) return jsonError("This PO template is used by a Purchase Order and cannot be deleted. Inactivate it instead.", 409);
        }
      }
      if (kind === "billing_address") {
        const children = await admin.from("site_delivery_locations").select("id", { count: "exact", head: true }).eq("billing_address_id", id).in("status", ["active", "inactive"]);
        if (children.error) throw children.error;
        if ((children.count || 0) > 0) return jsonError("This GSTIN / Billing Address has delivery addresses. Remove or reassign them before deleting it.", 409);
        const references = await admin.from("procurement_purchase_orders").select("id", { count: "exact", head: true }).filter("delivery_snapshot->>billing_address_id", "eq", id);
        if (references.error && references.error.code !== "42703") throw references.error;
        if ((references.count || 0) > 0) return jsonError("This address is already used in Purchase Orders and cannot be deleted. Inactivate it instead.", 409);
      }
      if (kind === "delivery_location") {
        const references = await admin.from("procurement_purchase_orders").select("id", { count: "exact", head: true }).filter("delivery_snapshot->>delivery_location_id", "eq", id);
        if (references.error && references.error.code !== "42703") throw references.error;
        if ((references.count || 0) > 0) return jsonError("This delivery address is already used in Purchase Orders and cannot be deleted. Inactivate it instead.", 409);
      }
      if (kind === "site_contact") {
        const references = await admin.from("procurement_purchase_orders").select("id", { count: "exact", head: true }).filter("delivery_snapshot->>delivery_contact_id", "eq", id);
        if (references.error && references.error.code !== "42703") throw references.error;
        if ((references.count || 0) > 0) return jsonError("This Site Contact is already used in Purchase Orders and cannot be deleted. Inactivate it instead.", 409);
      }
      if (kind === "po_template" && templateVersions.length) {
        const versionsDeleted = await admin.from("procurement_purchase_order_template_versions").delete().eq("template_id", id);
        if (versionsDeleted.error) throw versionsDeleted.error;
      }
      const deleted = await admin.from(table).delete().eq("id", id);
      if (deleted.error) {
        if (deleted.error.code === "23503") return jsonError("This master record is already used and cannot be deleted. Inactivate it instead.", 409);
        throw deleted.error;
      }
      if (kind === "po_template" && templateVersions.some((version) => version.source_storage_bucket && version.source_storage_path)) {
        const paths = templateVersions.filter((version) => version.source_storage_bucket === PO_TEMPLATE_BUCKET && version.source_storage_path).map((version) => version.source_storage_path);
        if (paths.length) { const removed = await admin.storage.from(PO_TEMPLATE_BUCKET).remove(paths); if (removed.error) throw removed.error; }
      }
      await auditMasterMutation(admin, auth, request, { organizationId: owned.organizationId, moduleCode: masterModule(kind), entityType: kind, recordId: id, action: "delete", description: `Deleted ${kind.replaceAll("_", " ")} ${id}.`, oldValues: "row" in owned ? owned.row : null });
      return NextResponse.json({ ok: true, deleted: true });
    }
    const values = kind === "terms_section" ? { status: "inactive" } : { status: "inactive", is_default: false };
    const result = await admin.from(table).update(values).eq("id", id);
    if (result.error) throw result.error;
    await auditMasterMutation(admin, auth, request, { organizationId: owned.organizationId, moduleCode: masterModule(kind), entityType: kind, recordId: id, action: "update", description: `Deactivated ${kind.replaceAll("_", " ")} ${id}.`, oldValues: "row" in owned ? owned.row : null, newValues: values });
    return NextResponse.json({ ok: true });
  } catch (error: any) { return jsonError(error.message || "Failed to deactivate master data.", 500); }
}

async function mutate(request: Request, action: "add" | "edit") {
  try {
    const body = await request.json().catch(() => ({}));
    const admin = adminClient(); const kind = text(body.kind); const id = text(body.id);
    const auth = await authorize(request, action, masterModule(kind));
    if ("response" in auth) return auth.response;
    if (action === "edit") { const owned = await ownedOrganization(admin, auth, kind, id); if ("error" in owned) return jsonError(owned.error || "Invalid master-data record.", owned.status || 400); }
    if (kind === "site_contact") {
      return jsonError(
        "Standalone Site Contacts are retired from Purchase Order Masters. Manage Purchase Order contacts through Billing / Delivery Address contacts instead.",
        410,
      );
    }
    if (kind === "billing_address") {
      const scope = await companyScope(admin, auth, text(body.company_id));
      if ("error" in scope) return jsonError(scope.error || "Invalid company.", scope.status || 400);
      if (!text(body.label) || !text(body.gstin) || !text(body.address_line1) || !text(body.city) || !text(body.state) || !text(body.pincode)) return jsonError("Company, GSTIN, Label, Address Line 1, City, State and Pincode are required.", 400);
      const atomic = await admin.rpc("save_procurement_combined_gst_billing_atomic", { p_organization_id: scope.organizationId, p_parent_id: id || null, p_parent: body, p_contacts: Array.isArray(body.contacts) ? body.contacts : [] });
      if (atomic.error) throw atomic.error;
      await auditMasterMutation(admin, auth, request, { organizationId: scope.organizationId, moduleCode: masterModule(kind), entityType: kind, recordId: atomic.data?.id || id, action: id ? "update" : "create", description: `${id ? "Updated" : "Created"} ${kind.replaceAll("_", " ")}.`, newValues: body });
      return NextResponse.json(atomic.data);
    }
    if (kind === "po_template") {
      const scope = await companyScope(admin, auth, text(body.company_id));
      if ("error" in scope) return jsonError(scope.error || "Invalid company.", scope.status || 400);
      if (!text(body.template_name) || !text(body.template_code)) return jsonError("Company, Template Name and Template Code are required.", 400);
      const source = body.source ? sourceInput(body) : null;
      if (!id && !source) return jsonError("A template source PDF or DOCX is required.", 400);
      if (source) {
        const checked = await verifySource(admin, scope.organizationId, source);
        if ("error" in checked) return jsonError(checked.error, checked.status || 400);
      }
      const values = { organization_id: scope.organizationId, company_id: text(body.company_id), template_name: text(body.template_name), template_code: text(body.template_code).toUpperCase(), is_default: body.is_default === true, status: text(body.status) || "active", updated_by: auth.user.id };
      if (!id) {
        const existing = await admin.from("procurement_purchase_order_templates").select("id").eq("organization_id", scope.organizationId).eq("company_id", values.company_id).eq("template_code", values.template_code).maybeSingle();
        if (existing.error) throw existing.error;
        if (existing.data) return jsonError("A PO template with this code already exists for the selected company.", 409);
      }
      if (values.is_default) { const cleared = await admin.from("procurement_purchase_order_templates").update({ is_default: false }).eq("company_id", values.company_id).eq("status", "active").neq("id", id || emptyId); if (cleared.error) throw cleared.error; }
      const result = id ? await admin.from("procurement_purchase_order_templates").update(values).eq("id", id).select("id").single() : await admin.from("procurement_purchase_order_templates").insert({ ...values, created_by: auth.user.id }).select("id").single();
      if (result.error) { if (result.error.code === "23505") return jsonError("A PO template with this code already exists for the selected company.", 409); throw result.error; }
      if (!id) {
        const version = await admin.from("procurement_purchase_order_template_versions").insert({ template_id: result.data.id, version_number: 1, layout_definition: {}, readiness_status: "setup_required", ...(source ? { source_storage_bucket: PO_TEMPLATE_BUCKET, source_storage_path: source.path, source_original_filename: source.filename, source_mime_type: source.mimeType, source_size_bytes: source.sizeBytes, source_uploaded_at: new Date().toISOString(), source_uploaded_by: auth.user.id } : {}), created_by: auth.user.id });
        if (version.error) throw version.error;
      } else if (source) {
        const latest = await admin.from("procurement_purchase_order_template_versions").select("version_number").eq("template_id", id).order("version_number", { ascending: false }).limit(1).maybeSingle();
        if (latest.error) throw latest.error;
        const version = await admin.from("procurement_purchase_order_template_versions").insert({ template_id: id, version_number: Number(latest.data?.version_number || 0) + 1, layout_definition: {}, readiness_status: "setup_required", source_storage_bucket: PO_TEMPLATE_BUCKET, source_storage_path: source.path, source_original_filename: source.filename, source_mime_type: source.mimeType, source_size_bytes: source.sizeBytes, source_uploaded_at: new Date().toISOString(), source_uploaded_by: auth.user.id, created_by: auth.user.id });
        if (version.error) throw version.error;
      }
      await auditMasterMutation(admin, auth, request, { organizationId: scope.organizationId, moduleCode: masterModule(kind), entityType: kind, recordId: result.data!.id, action: id ? "update" : "create", description: `${id ? "Updated" : "Created"} PO template ${values.template_name}.`, newValues: values });
      return NextResponse.json({ id: result.data!.id });
    }
    if (kind === "po_template_version") {
      const parent = await admin.from("procurement_purchase_order_templates").select("id,organization_id").eq("id", text(body.template_id)).maybeSingle();
      if (parent.error) throw parent.error;
      if (!parent.data || !hasOrg(auth, parent.data.organization_id)) return jsonError("Template is outside your organization access.", 403);
      const latest = await admin.from("procurement_purchase_order_template_versions").select("version_number").eq("template_id", text(body.template_id)).order("version_number", { ascending: false }).limit(1).maybeSingle();
      if (latest.error) throw latest.error;
      const result = await admin.from("procurement_purchase_order_template_versions").insert({ template_id: text(body.template_id), version_number: Number(latest.data?.version_number || 0) + 1, layout_definition: body.layout_definition || {}, header_asset_reference: body.header_asset_reference || null, footer_asset_reference: body.footer_asset_reference || null, created_by: auth.user.id }).select("id").single();
      if (result.error) throw result.error;
      await auditMasterMutation(admin, auth, request, { organizationId: parent.data.organization_id, moduleCode: masterModule(kind), entityType: kind, recordId: result.data.id, action: "create", description: `Created PO template version ${result.data.id}.`, newValues: body });
      return NextResponse.json({ id: result.data!.id });
    }
    if (kind === "delivery_location") {
      const scope = await siteScope(admin, auth, text(body.site_id));
      if ("error" in scope) return jsonError(scope.error || "Invalid site.", scope.status || 400);
      const companyId = text(body.company_id) || null;
      const shippingGstin = text(body.gstin).toUpperCase() || null;
      if (!text(body.location_name) || !text(body.address_line1) || !text(body.city) || !text(body.state) || !text(body.pincode)) return jsonError("Site, Location Name, Address Line 1, City, State and Pincode are required.", 400);
      if (shippingGstin && !GSTIN_REGEX.test(shippingGstin)) return jsonError("Invalid Shipping GSTIN format.", 400);
      if (companyId) {
        const shippingCompany = await companyScope(admin, auth, companyId);
        if ("error" in shippingCompany || shippingCompany.organizationId !== scope.organizationId) return jsonError("Shipping company is outside the selected site organization.", 403);
      }
      const billingAddressId = text(body.billing_address_id) || null;
      const site = await admin.from("sites").select("id,organization_id").eq("id", text(body.site_id)).maybeSingle();
      if (site.error) throw site.error;
      if (!site.data || site.data.organization_id !== scope.organizationId) return jsonError("Selected Site is outside the selected organization.", 400);
      if (billingAddressId) {
        const parent = await admin.from("company_billing_addresses").select("id,organization_id,company_id").eq("id", billingAddressId).maybeSingle();
        if (parent.error) throw parent.error;
        if (!parent.data || parent.data.organization_id !== scope.organizationId) return jsonError("Selected GSTIN / Billing Address is outside the selected organization.", 400);
      }
      const atomic = await admin.rpc("save_procurement_address_with_contacts_atomic", { p_kind: kind, p_organization_id: scope.organizationId, p_parent_id: id || null, p_parent: { ...body, company_id: companyId, gstin: shippingGstin, address: legacyDeliveryAddress(body), billing_address_id: billingAddressId }, p_contacts: Array.isArray(body.contacts) ? body.contacts : [] });
      if (atomic.error) throw atomic.error;
      await auditMasterMutation(admin, auth, request, { organizationId: scope.organizationId, moduleCode: masterModule(kind), entityType: kind, recordId: atomic.data?.id || id, action: id ? "update" : "create", description: `${id ? "Updated" : "Created"} delivery location.`, newValues: body });
      return NextResponse.json(atomic.data);
    }
    if (kind === "terms_template") {
      const scope = await companyScope(admin, auth, text(body.company_id));
      if ("error" in scope) return jsonError(scope.error || "Invalid company.", scope.status || 400);
      const templateName = text(body.template_name) || "Standard Purchase Order Terms";
      if (!id && !templateName) return jsonError("Add at least one clause before creating Standard PO Terms.", 400);
      const atomic = await admin.rpc("save_procurement_terms_template_with_sections_atomic", {
        p_organization_id: scope.organizationId,
        p_template_id: id || null,
        p_company_id: text(body.company_id),
        p_template_name: templateName,
        p_is_default: body.is_default === true,
        p_status: text(body.status) || "active",
        p_sections: Array.isArray(body.sections) ? body.sections.map((section: any, index: number) => ({ ...section, sort_order: index, status: "active" })) : [],
      });
      if (atomic.error) throw atomic.error;
      await auditMasterMutation(admin, auth, request, { organizationId: scope.organizationId, moduleCode: masterModule(kind), entityType: kind, recordId: atomic.data?.id || id, action: id ? "update" : "create", description: `${id ? "Updated" : "Created"} terms template ${templateName}.`, newValues: { ...body, sections: Array.isArray(body.sections) ? body.sections : [] } });
      return NextResponse.json(atomic.data);
    }
    if (kind === "terms_section") {
      if (!text(body.template_id) || !text(body.heading) || !text(body.clause_body)) return jsonError("Template, Heading and Clause Body are required.", 400);
      const parent = await admin.from("company_po_terms_templates").select("id,organization_id").eq("id", text(body.template_id)).maybeSingle();
      if (parent.error) throw parent.error;
      if (!parent.data || !hasOrg(auth, parent.data.organization_id)) return jsonError("Template is outside your organization access.", 403);
      const values = { template_id: text(body.template_id), heading: text(body.heading), clause_body: text(body.clause_body), sort_order: Number(body.sort_order || 0), status: text(body.status) || "active" };
      const result = id ? await admin.from("company_po_terms_sections").update(values).eq("id", id).select("id").single() : await admin.from("company_po_terms_sections").insert(values).select("id").single();
      if (result.error) throw result.error;
      const parentForAudit = await admin.from("company_po_terms_templates").select("organization_id").eq("id", text(body.template_id)).single();
      if (parentForAudit.error) throw parentForAudit.error;
      await auditMasterMutation(admin, auth, request, { organizationId: parentForAudit.data.organization_id, moduleCode: masterModule(kind), entityType: kind, recordId: result.data.id, action: id ? "update" : "create", description: `${id ? "Updated" : "Created"} terms section.`, newValues: values });
      return NextResponse.json({ id: result.data.id });
    }
    return jsonError("Unsupported master-data type.", 400);
  } catch (error: any) { return jsonError(error.message || "Failed to save Purchase Order master data.", 500); }
}
