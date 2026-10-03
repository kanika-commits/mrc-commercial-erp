import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/serverPermissions";
import { adminClient } from "@/lib/serverProcurementAccess";
import { isInOrganizationScope, loadActorOrganizationScope, resolveWriteOrganizationId } from "@/lib/serverOrganizationScope";
import { loadWorkOrderLetterheadAssets, renderWorkOrderPdf } from "@/lib/workOrderPdfRenderer.server";
import { addWorkOrderDraftWatermark, addWorkOrderPackagePageNumbers } from "@/lib/workOrderPdfPackage.server";
import { appendWorkOrderSupportingPdfs, validateWorkOrderSupportingFiles } from "@/lib/workOrderSupportingDocuments.server";

const text = (value: unknown, fallback = "—") => { const result = String(value ?? "").trim(); return result || fallback; };
const money = (value: unknown) => `Rs. ${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function loadAuthorizedPreviewData(admin: any, auth: any, request: Request, body: any) {
  const companyId = text(body.company_id, "");
  const siteId = text(body.site_id, "");
  const vendorId = text(body.vendor_id, "");
  const scope = await loadActorOrganizationScope(admin, auth);
  if (!companyId || !siteId || !vendorId) throw new Error("Company, site, and vendor are required for preview.");

  const [companyResult, siteResult, vendorResult] = await Promise.all([
    admin.from("companies").select("id,organization_id,company_name,status").eq("id", companyId).maybeSingle(),
    admin.from("sites").select("id,organization_id,company_id,site_name,status").eq("id", siteId).maybeSingle(),
    admin.from("vendors").select("id,organization_id,vendor_name,address,gstin,pan,status").eq("id", vendorId).maybeSingle(),
  ]);
  if (companyResult.error || siteResult.error || vendorResult.error) throw companyResult.error || siteResult.error || vendorResult.error;
  const company = companyResult.data;
  const site = siteResult.data;
  const vendor = vendorResult.data;
  if (!company || !site || !vendor || company.status !== "active" || site.status !== "active" || vendor.status !== "active") throw new Error("Selected company, site, or vendor is missing or inactive.");
  const activeOrganizationId = resolveWriteOrganizationId(scope, company.organization_id);
  if (!activeOrganizationId || !isInOrganizationScope(scope, company.organization_id) || company.organization_id !== site.organization_id || company.organization_id !== vendor.organization_id || (site.company_id && site.company_id !== company.id)) {
    throw new Error("Selected company, site, or vendor is outside the authorized organization scope.");
  }

  const selection = body.master_selection || {};
  const contacts = body.contact_selection || {};
  const gstId = text(selection.gst_registration_id, "");
  const billingId = text(selection.billing_address_id, "");
  const deliveryId = text(selection.delivery_location_id, "");
  const letterheadId = text(selection.letterhead_id, "");
  const termsId = text(selection.terms_template_id, "");
  const billingContactId = text(contacts.billing_contact_id, "");
  const deliveryContactId = text(contacts.delivery_contact_id, "");
  const itemIds = Array.from(new Set((Array.isArray(body.items) ? body.items : []).map((item: any) => text(item.item_master_id, "")).filter(Boolean)));

  const [gstResult, billingResult, deliveryResult, contactResult, letterheadResult, termsResult, itemResult, vendorContactsResult] = await Promise.all([
    admin.from("company_gst_registrations").select("id,organization_id,company_id,gstin,legal_name,trade_name,state,state_code,registration_type").eq("id", gstId).eq("organization_id", company.organization_id).eq("company_id", company.id).eq("status", "active").maybeSingle(),
    admin.from("company_billing_addresses").select("id,organization_id,company_id,gst_registration_id,label,address_line1,address_line2,city,state,pincode,gstin,contact_name,mobile,email").eq("id", billingId).eq("organization_id", company.organization_id).eq("company_id", company.id).eq("status", "active").maybeSingle(),
    admin.from("site_delivery_locations").select("id,organization_id,company_id,site_id,billing_address_id,billing_address:company_billing_addresses!inner(id,gst_registration_id),location_name,address,address_line1,address_line2,city,state,pincode,gstin,contact_name,mobile,email").eq("id", deliveryId).eq("organization_id", company.organization_id).eq("site_id", site.id).eq("status", "active").eq("billing_address.gst_registration_id", gstId).maybeSingle(),
    admin.from("site_contacts").select("id,organization_id,site_id,contact_name,designation,mobile,email,contact_type").in("id", [billingContactId, deliveryContactId]).eq("organization_id", company.organization_id).eq("site_id", site.id).eq("status", "active"),
    admin.from("procurement_company_letterheads").select("id,organization_id,company_id,letterhead_name,status,versions:procurement_company_letterhead_versions(id,version_number,version_status,header_content_hash,footer_content_hash,header_storage_provider,header_storage_bucket,header_storage_key,footer_storage_provider,footer_storage_bucket,footer_storage_key,header_height_points,footer_height_points)").eq("id", letterheadId).eq("organization_id", company.organization_id).eq("company_id", company.id).eq("status", "active").maybeSingle(),
    admin.from("company_po_terms_templates").select("id,organization_id,company_id,template_name,status,sections:company_po_terms_sections(id,heading,clause_body,sort_order,status)").eq("id", termsId).eq("organization_id", company.organization_id).eq("company_id", company.id).eq("status", "active").maybeSingle(),
    itemIds.length ? admin.from("work_order_item_masters").select("id,organization_id,item_header,description,unit,mode_of_measurement,status").in("id", itemIds).eq("organization_id", company.organization_id).eq("status", "active") : Promise.resolve({ data: [], error: null }),
    admin.from("vendor_contacts").select("id,contact_name,contact_number,email,designation,is_primary").eq("organization_id", company.organization_id).eq("vendor_id", vendor.id).order("is_primary", { ascending: false }).order("created_at"),
  ]);
  const queryError = gstResult.error || billingResult.error || deliveryResult.error || contactResult.error || letterheadResult.error || termsResult.error || itemResult.error || vendorContactsResult.error;
  if (queryError) throw queryError;
  const siteContacts = contactResult.data || [];
  const billingContact = siteContacts.find((row: any) => row.id === billingContactId);
  const deliveryContact = siteContacts.find((row: any) => row.id === deliveryContactId);
  const letterheadVersion = (letterheadResult.data?.versions || []).filter((version: any) => version.version_status === "ready" && version.header_content_hash && version.footer_content_hash).sort((a: any, b: any) => Number(b.version_number || 0) - Number(a.version_number || 0))[0];
  const itemMap = new Map<string, any>((itemResult.data || []).map((item: any) => [item.id, item] as [string, any]));
  if (!gstResult.data || !billingResult.data || !deliveryResult.data || !billingContact || !deliveryContact || !letterheadResult.data || !letterheadVersion || !termsResult.data || itemMap.size !== itemIds.length) throw new Error("One or more selected Work Order masters are missing, inactive, or outside the authorized scope.");
  if (billingResult.data.gst_registration_id !== gstResult.data.id) throw new Error("Selected Billing Address is not linked to the selected GST/Billing Master.");

  const primaryVendorContact = (vendorContactsResult.data || [])[0] || {};
  const vendorSnapshot = { vendor_id: vendor.id, vendor_name: vendor.vendor_name, address: vendor.address || null, gstin: vendor.gstin || null, pan: vendor.pan || null, contact_person: primaryVendorContact.contact_name || "", phone: primaryVendorContact.contact_number || "", email: primaryVendorContact.email || "", contacts: vendorContactsResult.data || [] };
  const letterheadSnapshot = { id: letterheadResult.data.id, company_id: letterheadResult.data.company_id, letterhead_name: letterheadResult.data.letterhead_name, version_id: letterheadVersion.id, version_number: letterheadVersion.version_number, header_storage_provider: letterheadVersion.header_storage_provider, header_storage_bucket: letterheadVersion.header_storage_bucket, header_storage_key: letterheadVersion.header_storage_key, footer_storage_provider: letterheadVersion.footer_storage_provider, footer_storage_bucket: letterheadVersion.footer_storage_bucket, footer_storage_key: letterheadVersion.footer_storage_key, header_height_points: letterheadVersion.header_height_points, footer_height_points: letterheadVersion.footer_height_points };
  const terms = (termsResult.data.sections || []).filter((section: any) => section.status === "active").sort((a: any, b: any) => Number(a.sort_order || 0) - Number(b.sort_order || 0)).map((section: any) => `${section.heading}\n${section.clause_body}`).join("\n\n");
  return { company, site, vendorSnapshot, itemMap, gst: gstResult.data, billing: billingResult.data, delivery: deliveryResult.data, billingContact, deliveryContact, letterheadSnapshot, terms };
}

export async function POST(request: Request) {
  try {
    const auth = await requirePermission(request, "work_orders", "add");
    if ("response" in auth) return auth.response;
    let body: any = {};
    let supportingFiles: File[] = [];
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      const formData = await request.formData();
      body = JSON.parse(String(formData.get("payload") || "{}"));
      supportingFiles = formData.getAll("supporting_documents").filter((value): value is File => value instanceof File && value.size > 0);
    } else {
      body = await request.json().catch(() => ({}));
    }
    validateWorkOrderSupportingFiles(supportingFiles);
    if (!text(body.wo_number, "")) return NextResponse.json({ error: "Work Order Number is required for preview." }, { status: 400 });
    const admin = adminClient();
    const authorized = await loadAuthorizedPreviewData(admin, auth, request, body);
    const items = (Array.isArray(body.items) ? body.items : []).map((item: any, index: number) => {
      const master = authorized.itemMap.get(text(item.item_master_id, ""));
      if (!master) throw new Error(`Item ${index + 1} is outside the authorized Work Order Item Master scope.`);
      const basic = Number(item.quantity || 0) * Number(item.unit_rate || 0);
      const gstAmount = basic * Number(item.gst_percent || 0) / 100;
      return { item_name_snapshot: master.item_header, item_code_snapshot: "", specification_snapshot: master.description || "", additional_description_snapshot: item.additional_description || "", make_snapshot: master.mode_of_measurement || "", quantity: item.quantity, uom_snapshot: master.unit || "", unit_rate: item.unit_rate, gst_rate: item.gst_percent, gst_amount: gstAmount, total_amount: basic + gstAmount, serial_no: index + 1 };
    });
    const rawTerms = authorized.terms.replace(/Purchase Order/g, "Work Order").replace(/\bPO\b/g, "WO");
    const terms = rawTerms.split(/\n\s*\n/).map((block: string, index: number) => block.trim() ? `${index + 1}. ${block.trim()}` : block).join("\n\n");
    const keyTerms = [
      ...(body.work_order_key_terms?.inclusions || []).filter(Boolean).map((value: string) => ({ description: "Inclusion", value })),
      ...(body.work_order_key_terms?.exclusions || []).filter(Boolean).map((value: string) => ({ description: "Exclusion", value })),
    ];
    const rendered = await renderWorkOrderPdf({
      company: { company_name: authorized.company.company_name }, site: { site_name: authorized.site.site_name },
      vendor_snapshot: authorized.vendorSnapshot, wo_number: body.wo_number, wo_date: body.wo_date, wo_type: body.wo_type,
      delivery_snapshot: { gst_billing: authorized.gst, billing_address: authorized.billing, delivery_location: authorized.delivery, billing_contact: authorized.billingContact, delivery_contact: authorized.deliveryContact },
      items, total_basic_amount: items.reduce((sum: number, item: any) => sum + Number(item.quantity || 0) * Number(item.unit_rate || 0), 0),
      total_gst_amount: items.reduce((sum: number, item: any) => sum + Number(item.gst_amount || 0), 0),
      total_amount: items.reduce((sum: number, item: any) => sum + Number(item.total_amount || 0), 0),
      approval_status: "draft",
      status: "active",
      created_by: auth.user.id,
      created_by_name: auth.user.user_metadata?.full_name || auth.user.email,
      created_by_email: auth.user.email || null,
      created_at_display: new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date()),
      work_order_key_terms: body.work_order_key_terms, standard_terms_snapshot: terms,
    }, await loadWorkOrderLetterheadAssets(authorized.letterheadSnapshot, authorized.letterheadSnapshot.id, authorized.company.id));
    const merged = supportingFiles.length ? await appendWorkOrderSupportingPdfs(rendered, supportingFiles) : rendered;
    const combined = await addWorkOrderPackagePageNumbers(await addWorkOrderDraftWatermark(merged));
    return NextResponse.json({ pdf_base64: combined.toString("base64"), wo_number: text(body.wo_number), persisted: false, supporting_documents: supportingFiles.map((file) => file.name) });
  } catch (error: any) { return NextResponse.json({ error: error.message || "Could not generate Work Order preview." }, { status: 500 }); }
}
