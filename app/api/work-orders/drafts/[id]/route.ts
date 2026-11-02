import { NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { requirePermission } from "@/lib/serverPermissions";
import { adminClient } from "@/lib/serverProcurementAccess";
import { applyOrganizationScope, isInOrganizationScope, loadActorOrganizationScope } from "@/lib/serverOrganizationScope";
import { readWorkOrderDraftSelections } from "@/lib/workOrderDraftSelections";

const text = (value: unknown) => String(value ?? "").trim();
const types = new Set(["Consultant", "Contractor (Labour)", "Contractor (SITC)", "Daily Wage", "Rental"]);

export async function loadDraft(request: Request, id: string) {
  const auth = await requirePermission(request, "work_orders", "edit");
  if ("response" in auth) return { response: auth.response } as const;
  const admin = adminClient();
  const scope = await loadActorOrganizationScope(admin, auth);
  let query: any = admin.from("work_orders").select("*").eq("id", id).eq("approval_status", "draft").not("creation_request_id", "is", null);
  query = applyOrganizationScope(query, scope);
  if (!query) return { response: NextResponse.json({ error: "Work Order draft was not found." }, { status: 404 }) } as const;
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data || !isInOrganizationScope(scope, data.organization_id)) return { response: NextResponse.json({ error: "Work Order draft was not found." }, { status: 404 }) } as const;
  // Keep company/site access aligned with the organization scope used to load
  // the draft.  Assignments from another organization must not affect the
  // site-vs-company fallback for this already authorized draft.
  let assignmentsQuery: any = admin.from("user_access_assignments").select("organization_id,company_id,site_id").eq("user_id", auth.user.id);
  if (scope !== null) assignmentsQuery = assignmentsQuery.in("organization_id", scope);
  const assignments = await assignmentsQuery;
  if (assignments.error) throw assignments.error;
  const siteIds = new Set((assignments.data || []).map((row: any) => row.site_id).filter(Boolean));
  const companyIds = new Set((assignments.data || []).map((row: any) => row.company_id).filter(Boolean));
  const inCompanySiteScope = scope === null
    || (siteIds.size > 0 ? siteIds.has(data.site_id) : companyIds.size > 0 && companyIds.has(data.company_id));
  if (!inCompanySiteScope) return { response: NextResponse.json({ error: "You do not have access to this Work Order draft." }, { status: 403 }) } as const;
  return { auth, admin, data, scope } as const;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const result = await loadDraft(request, (await params).id);
    if ("response" in result) return result.response;
    const [vendorResult, itemsResult] = await Promise.all([
      result.admin.from("work_order_vendors").select("vendor_id,vendor_role").eq("work_order_id", result.data.id).eq("is_primary", true).maybeSingle(),
      result.admin.from("work_order_items").select("*").eq("work_order_id", result.data.id).order("sort_order"),
    ]);
    if (vendorResult.error || itemsResult.error) throw vendorResult.error || itemsResult.error;
    const selections = readWorkOrderDraftSelections(result.data);
    const selection = result.data.delivery_snapshot?.master_selection || result.data.master_selection || {};
    const contacts = result.data.delivery_snapshot?.contact_selection || result.data.contact_selection || {};
    const savedTermsSnapshot = result.data.delivery_snapshot?.terms_template_snapshot || result.data.terms_template_snapshot || null;
    const termsResult = selections.terms_template_id
      ? await result.admin.from("company_po_terms_templates").select("id,organization_id,company_id,template_name").eq("id", selections.terms_template_id).eq("organization_id", result.data.organization_id).eq("company_id", result.data.company_id).eq("status", "active").maybeSingle()
      : { data: null, error: null };
    if (termsResult.error) throw termsResult.error;
    const termsTemplateSnapshot = termsResult.data
      ? { id: termsResult.data.id, company_id: termsResult.data.company_id, template_name: termsResult.data.template_name }
      : savedTermsSnapshot;
    return NextResponse.json({
      ...result.data,
      vendor_id: vendorResult.data?.vendor_id || "",
      vendor_role: vendorResult.data?.vendor_role || "Main Contractor",
      items: itemsResult.data || [],
      letterhead_id: selections.letterhead_id || result.data.template_id || "",
      terms_template_id: selections.terms_template_id || result.data.template_id || "",
      gst_registration_id: selections.gst_registration_id,
      billing_address_id: selections.billing_address_id,
      delivery_location_id: selections.delivery_location_id,
      billing_contact_id: selections.billing_contact_id,
      delivery_contact_id: selections.delivery_contact_id,
      delivery_snapshot: { ...result.data.delivery_snapshot, master_selection: selection, contact_selection: contacts, ...(termsTemplateSnapshot ? { terms_template_snapshot: termsTemplateSnapshot } : {}) },
    });
  } catch (error) {
    console.error("Work Order draft load failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "The Work Order draft could not be loaded." }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const result = await loadDraft(request, (await params).id);
  if ("response" in result) return result.response;
  const body = await request.json().catch(() => ({}));
  const payload = body.payload || body;
  const number = text(payload.wo_number), type = text(payload.wo_type), items = Array.isArray(payload.items) ? payload.items : [];
  if (!number || !/^[^/\s]+\/[^/\s]+\/\d+$/.test(number) || !types.has(type) || !items.length || !text(payload.company_id) || !text(payload.site_id) || !text(payload.vendor_id) || !text(payload.wo_date)) return NextResponse.json({ error: "Company, site, vendor, date, number, type, and item rows are required." }, { status: 400 });
  if (text(payload.company_id) !== result.data.company_id || text(payload.site_id) !== result.data.site_id) return NextResponse.json({ error: "A saved Work Order draft cannot change company or site." }, { status: 409 });
  const keyTerms = payload.work_order_key_terms || {};
  const inclusions = Array.isArray(keyTerms.inclusions) ? keyTerms.inclusions.map(text).filter(Boolean) : [];
  const exclusions = Array.isArray(keyTerms.exclusions) ? keyTerms.exclusions.map(text).filter(Boolean) : [];
  if (type !== "Daily Wage" && (!inclusions.length || !exclusions.length)) return NextResponse.json({ error: "At least one Mandatory Inclusion and one Mandatory Exclusion are required." }, { status: 400 });
  const [companyResult, siteResult, vendorResult] = await Promise.all([
    result.admin.from("companies").select("id,organization_id").eq("id", text(payload.company_id)).maybeSingle(),
    result.admin.from("sites").select("id,organization_id,company_id").eq("id", text(payload.site_id)).maybeSingle(),
    result.admin.from("vendors").select("id,organization_id").eq("id", text(payload.vendor_id)).maybeSingle(),
  ]);
  if (companyResult.error || siteResult.error || vendorResult.error) throw companyResult.error || siteResult.error || vendorResult.error;
  const company = companyResult.data, site = siteResult.data, vendor = vendorResult.data;
  // Reuse the scope that authorized the draft load.  Re-resolving it here
  // can disagree with the draft's organization context and incorrectly turn
  // an otherwise authorized preview autosave into a 403.
  const siteBelongsToCompany = site?.company_id == null || site?.company_id === company?.id;
  if (!company || !site || !vendor || !siteBelongsToCompany || company.organization_id !== site.organization_id || company.organization_id !== vendor.organization_id || !isInOrganizationScope(result.scope, company.organization_id)) return NextResponse.json({ error: "Selected records are outside the active authorized organization scope." }, { status: 403 });
  const ids = type === "Daily Wage" ? [] : Array.from(new Set(items.map((item: any) => text(item.item_master_id)).filter(Boolean)));
  if (type !== "Daily Wage" && ids.length !== items.length) return NextResponse.json({ error: "Each line must use a canonical Work Order Item Master item." }, { status: 400 });
  const mastersResult = ids.length ? await result.admin.from("work_order_item_masters").select("id,organization_id,item_header,description,unit,mode_of_measurement,status").in("id", ids).eq("organization_id", company.organization_id).eq("status", "active") : { data: [], error: null };
  if (mastersResult.error) throw mastersResult.error;
  const masterMap = new Map((mastersResult.data || []).map((item: any) => [item.id, item]));
  if (masterMap.size !== ids.length) return NextResponse.json({ error: "One or more item masters are unavailable." }, { status: 400 });
  const normalized = items.map((item: any, index: number) => { const daily = type === "Daily Wage"; const master = daily ? null : masterMap.get(text(item.item_master_id)); const description = text(daily ? item.description : master?.description); const header = text(daily ? item.description : master?.item_header); const unit = text(daily ? item.unit : master?.unit); const quantity = daily ? 1 : Number(item.quantity); const rate = Number(item.unit_rate); const gst = daily ? 0 : Number(item.gst_percent); if (!description || !header || !unit || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(rate) || rate < 0 || !Number.isFinite(gst) || gst < 0) throw new Error(`Invalid item row ${index + 1}.`); const basic = Number((quantity * rate).toFixed(2)); const gstAmount = Number((basic * gst / 100).toFixed(2)); return { work_order_id: result.data.id, organization_id: company.organization_id, item_master_id: daily ? null : text(item.item_master_id) || null, item_header_snapshot: header, description_snapshot: description, additional_description_snapshot: text(item.additional_description) || null, unit_snapshot: unit, mode_of_measurement_snapshot: daily ? null : text(master?.mode_of_measurement), quantity, unit_rate: rate, gst_percent: gst, basic_amount: basic, gst_amount: gstAmount, line_total: basic + gstAmount, sort_order: index + 1, created_by: result.auth.user.id, created_by_name: result.auth.user.user_metadata?.full_name || result.auth.user.email, created_by_email: result.auth.user.email || null }; });
  const basic = normalized.reduce((sum: number, item: any) => sum + item.basic_amount, 0), gst = normalized.reduce((sum: number, item: any) => sum + item.gst_amount, 0);
  const duplicate = await result.admin.from("work_orders").select("id").eq("organization_id", company.organization_id).ilike("wo_number", number).neq("id", result.data.id).maybeSingle();
  if (duplicate.error) throw duplicate.error;
  if (duplicate.data) return NextResponse.json({ error: "Work Order number already exists." }, { status: 409 });
  const action = body.action === "submit";
  let reviewedPdfPath = "";
  if (action) {
    const bytes = Buffer.from(text(body.reviewed_pdf_base64), "base64");
    const pdf = await PDFDocument.load(bytes).catch(() => null);
    if (!pdf || pdf.getPageCount() < 1) return NextResponse.json({ error: "A reviewed Work Order PDF artifact is required before submission." }, { status: 400 });
    reviewedPdfPath = `structured-pilot/${result.data.id}/reviewed-package.pdf`;
    const upload = await result.admin.storage.from("work-order-documents").upload(reviewedPdfPath, bytes, { contentType: "application/pdf", upsert: true });
    if (upload.error) throw upload.error;
  }
  const existingDeliverySnapshot = result.data.delivery_snapshot || {};
  const persistedDeliverySnapshot = {
    ...existingDeliverySnapshot,
    ...(payload.delivery_snapshot || {}),
    master_selection: payload.master_selection || existingDeliverySnapshot.master_selection || {},
    contact_selection: payload.contact_selection || existingDeliverySnapshot.contact_selection || {},
  };
  const { data: updated, error: updateError } = await result.admin.from("work_orders").update({ wo_number: number, wo_type: type, description: text(payload.description) || null, wo_date: text(payload.wo_date), status: "active", approval_status: action ? "pending" : "draft", wo_value: basic, gst_percent: Number(payload.gst_percent || 0), total_basic_amount: basic, total_gst_amount: gst, total_amount: basic + gst, standard_terms_snapshot: payload.standard_terms_snapshot || result.data.standard_terms_snapshot, delivery_snapshot: persistedDeliverySnapshot, work_order_key_terms: { inclusions, exclusions, additional: Array.isArray(keyTerms.additional) ? keyTerms.additional : [] }, letterhead_snapshot: payload.letterhead_snapshot || result.data.letterhead_snapshot }).eq("id", result.data.id).eq("organization_id", result.data.organization_id).eq("approval_status", "draft").select("id,organization_id,wo_number,approval_status,total_basic_amount,total_gst_amount,total_amount").single();
  if (updateError) throw updateError;
  const deleted = await result.admin.from("work_order_items").delete().eq("work_order_id", result.data.id); if (deleted.error) throw deleted.error;
  const inserted = await result.admin.from("work_order_items").insert(normalized); if (inserted.error) throw inserted.error;
  if (action) { const document = await result.admin.from("work_order_documents").insert({ organization_id: updated.organization_id, work_order_id: result.data.id, file_name: `${updated.wo_number}-reviewed-package.pdf`, file_url: reviewedPdfPath, file_path: reviewedPdfPath, uploaded_at: new Date().toISOString(), drive_sync_key: "pilot-reviewed-pdf", drive_sync_status: "succeeded" }); if (document.error) throw document.error; }
  return NextResponse.json({ workOrder: updated, ...(action ? { submitted: true } : { draft: true }) });
}
