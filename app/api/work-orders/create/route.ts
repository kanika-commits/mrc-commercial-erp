import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/serverPermissions";
import { adminClient, hasGlobalProcurementAccess } from "@/lib/serverProcurementAccess";
import { isInOrganizationScope, loadActorOrganizationScope, resolveWriteOrganizationId } from "@/lib/serverOrganizationScope";
import { validateWorkOrderSupportingFiles } from "@/lib/workOrderSupportingDocuments.server";

const n = (value: unknown) => { const result = Number(value); return Number.isFinite(result) ? result : NaN; };
const text = (value: unknown) => String(value ?? "").trim();
const WORK_ORDER_TYPES = new Set(["Consultant", "Contractor (Labour)", "Contractor (SITC)", "Daily Wage", "Rental"]);
const SUPPORTING_DOCUMENT_BUCKET = "work-order-documents";

function supportingDocumentPath(workOrderId: string, index: number, fileName: string) {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "supporting-document.pdf";
  return `structured-pilot/${workOrderId}/${String(index + 1).padStart(4, "0")}-${safeName}`;
}

export async function POST(request: Request) {
  const uploadedSupportingPaths: string[] = [];
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
    const companyId = text(body.company_id), siteId = text(body.site_id), vendorId = text(body.vendor_id);
    const lines = Array.isArray(body.items) ? body.items : [];
    const woNumber = text(body.wo_number);
    const woType = text(body.wo_type);
    if (!companyId || !siteId || !vendorId || !woNumber || !text(body.wo_date) || !WORK_ORDER_TYPES.has(woType) || lines.length === 0) return NextResponse.json({ error: "Company, site, vendor, Work Order number, date, valid type, and at least one item are required." }, { status: 400 });
    if (!/^[^/\s]+\/[^/\s]+\/\d+$/.test(woNumber)) return NextResponse.json({ error: "Work Order number must use SITE_CODE/COMPANY_CODE/SEQUENCE format." }, { status: 400 });
    const admin = adminClient();
    const creationRequestId = text(body.creation_request_id);
    if (creationRequestId) {
      const { data: existing, error: existingError } = await admin.from("work_orders").select("id,wo_number,approval_status,total_basic_amount,total_gst_amount,total_amount").eq("creation_request_id", creationRequestId).maybeSingle();
      if (existingError) throw existingError;
      if (existing) return NextResponse.json({ workOrder: existing, idempotent: true });
    }
    const scope = await loadActorOrganizationScope(admin, auth);
    const [companyResult, siteResult, vendorResult] = await Promise.all([
      admin.from("companies").select("id,organization_id,company_code,status").eq("id", companyId).maybeSingle(),
      admin.from("sites").select("id,organization_id,company_id,site_code,status").eq("id", siteId).maybeSingle(),
      admin.from("vendors").select("id,organization_id,vendor_name,address,gstin,pan,status").eq("id", vendorId).maybeSingle(),
    ]);
    if (companyResult.error) throw companyResult.error; if (siteResult.error) throw siteResult.error; if (vendorResult.error) throw vendorResult.error;
    const company = companyResult.data, site = siteResult.data, vendor = vendorResult.data;
    if (!company || !site || !vendor) return NextResponse.json({ error: "Selected company, site, or vendor was not found." }, { status: 404 });
    const activeOrganizationId = resolveWriteOrganizationId(scope);
    const access: any = auth;
    const globalAccess = hasGlobalProcurementAccess(auth);
    const companyAllowed = globalAccess || (access.companies || []).length === 0 || access.companies.includes(company.id);
    const siteAllowed = globalAccess || (access.sites || []).length === 0 || access.sites.includes(site.id);
    if (!activeOrganizationId || !isInOrganizationScope(scope, company.organization_id) || company.organization_id !== activeOrganizationId || company.organization_id !== site.organization_id || company.organization_id !== vendor.organization_id || !companyAllowed || !siteAllowed) return NextResponse.json({ error: "Selected records are outside the active authorized organization scope." }, { status: 403 });
    const { data: vendorContacts, error: vendorContactsError } = await admin.from("vendor_contacts").select("id,contact_name,contact_number,email,designation,is_primary").eq("organization_id", company.organization_id).eq("vendor_id", vendor.id).order("is_primary", { ascending: false }).order("created_at");
    if (vendorContactsError) throw vendorContactsError;
    const masterSelection = body.master_selection || {};
    const letterheadId = text(masterSelection.letterhead_id);
    const termsTemplateId = text(masterSelection.terms_template_id);
    const billingId = text(masterSelection.billing_address_id);
    const deliveryId = text(masterSelection.delivery_location_id);
    const contactSelection = body.contact_selection || {};
    const billingContactId = text(contactSelection.billing_contact_id), deliveryContactId = text(contactSelection.delivery_contact_id);
    const [gstResult, billingResult, deliveryResult, contactResult, letterheadResult, termsResult] = await Promise.all([
      admin.from("company_gst_registrations").select("id,organization_id,company_id,gstin,legal_name,trade_name,state,state_code,registration_type").eq("id", text(masterSelection.gst_registration_id)).eq("organization_id", company.organization_id).eq("company_id", company.id).eq("status", "active").maybeSingle(),
      billingId ? admin.from("company_billing_addresses").select("id,organization_id,company_id,gst_registration_id,label,address_line1,address_line2,city,state,pincode,gstin,contact_name,mobile,email").eq("id", billingId).eq("organization_id", company.organization_id).eq("company_id", company.id).eq("status", "active").maybeSingle() : Promise.resolve({ data: null, error: null }),
      deliveryId ? admin.from("site_delivery_locations").select("id,organization_id,company_id,site_id,billing_address_id,billing_address:company_billing_addresses!inner(id,gst_registration_id),location_name,address,address_line1,address_line2,city,state,pincode,gstin,contact_name,mobile,email").eq("id", deliveryId).eq("organization_id", company.organization_id).eq("site_id", site.id).eq("status", "active").eq("billing_address.gst_registration_id", text(masterSelection.gst_registration_id)).maybeSingle() : Promise.resolve({ data: null, error: null }),
      admin.from("site_contacts").select("id,organization_id,site_id,contact_name,designation,mobile,email,contact_type").in("id", [billingContactId, deliveryContactId]).eq("organization_id", company.organization_id).eq("site_id", site.id).eq("status", "active"),
      admin.from("procurement_company_letterheads").select("id,organization_id,company_id,letterhead_name,status").eq("id", letterheadId).eq("organization_id", company.organization_id).eq("company_id", company.id).eq("status", "active").maybeSingle(),
      admin.from("company_po_terms_templates").select("id,organization_id,company_id,template_name,status,sections:company_po_terms_sections(id,heading,clause_body,sort_order,status)").eq("id", termsTemplateId).eq("organization_id", company.organization_id).eq("company_id", company.id).eq("status", "active").maybeSingle(),
    ]);
    if (gstResult.error || billingResult.error || deliveryResult.error || contactResult.error || letterheadResult.error || termsResult.error) throw gstResult.error || billingResult.error || deliveryResult.error || contactResult.error || letterheadResult.error || termsResult.error;
    const contacts = contactResult.data || [], billingContact = contacts.find((row: any) => row.id === billingContactId), deliveryContact = contacts.find((row: any) => row.id === deliveryContactId);
    if (!gstResult.data) return NextResponse.json({ error: "Selected GST/Billing Master is missing, inactive, or outside the selected company." }, { status: 400 });
    if (!billingResult.data) return NextResponse.json({ error: "Selected Billing Address is missing, inactive, or outside the selected company." }, { status: 400 });
    if (billingResult.data.gst_registration_id !== gstResult.data.id) return NextResponse.json({ error: "Selected Billing Address is not linked to the selected GST/Billing Master." }, { status: 400 });
    if (!deliveryResult.data) return NextResponse.json({ error: "Selected Delivery Location is missing, inactive, outside the selected site, or not linked to the selected GST/Billing Master." }, { status: 400 });
    if (!billingContact) return NextResponse.json({ error: "Selected Billing Contact is missing, inactive, or outside the selected site." }, { status: 400 });
    if (!deliveryContact) return NextResponse.json({ error: "Selected Delivery Contact is missing, inactive, or outside the selected site." }, { status: 400 });
    if (!letterheadResult.data) return NextResponse.json({ error: "Selected Letterhead is missing or inactive for the selected company." }, { status: 400 });
    if (!termsResult.data) return NextResponse.json({ error: "Selected Terms & Conditions master is missing or inactive for the selected company." }, { status: 400 });
    const vendorSnapshot = { vendor_id: vendor.id, vendor_name: vendor.vendor_name, vendor_role: text(body.vendor_role) || "Main Contractor", address: vendor.address || null, gstin: vendor.gstin || null, pan: vendor.pan || null, contacts: vendorContacts || [] };
    const deliverySnapshot = { vendor_snapshot: vendorSnapshot, master_selection: { gst_registration_id: gstResult.data.id, billing_address_id: billingResult.data.id, delivery_location_id: deliveryResult.data.id, billing_contact_id: billingContact.id, delivery_contact_id: deliveryContact.id }, gst_billing: gstResult.data, billing_address: billingResult.data, delivery_location: deliveryResult.data, billing_contact: billingContact, delivery_contact: deliveryContact };
    const ids = Array.from(new Set(lines.map((line: any) => text(line.item_master_id)).filter(Boolean)));
    if (!ids.length || ids.length !== lines.length) return NextResponse.json({ error: "Each line must use a canonical Work Order Item Master item." }, { status: 400 });
    const { data: masters, error: masterError } = await admin.from("work_order_item_masters").select("id,organization_id,item_header,description,unit,mode_of_measurement,status").in("id", ids).eq("organization_id", company.organization_id).eq("status", "active");
    if (masterError) throw masterError;
    const masterMap = new Map((masters || []).map((item) => [item.id, item]));
    if (masterMap.size !== ids.length) return NextResponse.json({ error: "One or more Work Order Item Master items are unavailable." }, { status: 400 });
    const normalizedLines = lines.map((line: any, index: number) => {
      const master = masterMap.get(text(line.item_master_id))!;
      const quantity = n(line.quantity), rate = n(line.unit_rate), gstPercent = n(line.gst_percent);
      if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(rate) || rate < 0 || !Number.isFinite(gstPercent) || gstPercent < 0) throw new Error(`Invalid values on item line ${index + 1}.`);
      const basicAmount = Number((quantity * rate).toFixed(2));
      const gstAmount = Number((basicAmount * gstPercent / 100).toFixed(2));
      return { organization_id: company.organization_id, item_master_id: master.id, item_header_snapshot: master.item_header, description_snapshot: master.description, additional_description_snapshot: text(line.additional_description) || null, unit_snapshot: master.unit, mode_of_measurement_snapshot: master.mode_of_measurement, quantity, unit_rate: rate, gst_percent: gstPercent, basic_amount: basicAmount, gst_amount: gstAmount, line_total: Number((basicAmount + gstAmount).toFixed(2)), sort_order: index + 1, created_by: auth.user.id, created_by_name: auth.user.user_metadata?.full_name || auth.user.email, created_by_email: auth.user.email || null };
    });
    const totalBasic = normalizedLines.reduce((sum: number, line: any) => sum + line.basic_amount, 0);
    const totalGst = normalizedLines.reduce((sum: number, line: any) => sum + line.gst_amount, 0);
    const total = Number((totalBasic + totalGst).toFixed(2));
    const keyTerms = body.work_order_key_terms || {};
    const inclusions = Array.isArray(keyTerms.inclusions) ? keyTerms.inclusions.map((value: unknown) => text(value)).filter(Boolean) : [];
    const exclusions = Array.isArray(keyTerms.exclusions) ? keyTerms.exclusions.map((value: unknown) => text(value)).filter(Boolean) : [];
    const additional = Array.isArray(keyTerms.additional) ? keyTerms.additional.map((entry: any) => ({ label: text(entry?.label), value: text(entry?.value) })).filter((entry: any) => entry.label || entry.value) : [];
    if (inclusions.length < 1 || exclusions.length < 1) return NextResponse.json({ error: "At least one Mandatory Inclusion and one Mandatory Exclusion are required." }, { status: 400 });
    const { data: workOrder, error: workOrderError } = await admin.from("work_orders").insert({ organization_id: company.organization_id, company_id: companyId, site_id: siteId, wo_number: woNumber, wo_date: text(body.wo_date), wo_type: woType, description: text(body.description) || null, status: "active", approval_status: "draft", wo_value: Number(totalBasic.toFixed(2)), gst_percent: n(body.gst_percent) >= 0 ? n(body.gst_percent) : 0, total_basic_amount: Number(totalBasic.toFixed(2)), total_gst_amount: Number(totalGst.toFixed(2)), total_amount: total, standard_terms_snapshot: text(body.standard_terms_snapshot), delivery_snapshot: deliverySnapshot, work_order_key_terms: { inclusions, exclusions, additional }, letterhead_snapshot: body.letterhead_snapshot || null, creation_request_id: creationRequestId || null, created_by: auth.user.id, created_by_name: auth.user.user_metadata?.full_name || auth.user.email, created_by_email: auth.user.email || null }).select("id,organization_id,wo_number,approval_status,total_basic_amount,total_gst_amount,total_amount").single();
    if (workOrderError) { if (workOrderError.code === "23505") return NextResponse.json({ error: "Work Order number or creation request already exists." }, { status: 409 }); throw workOrderError; }
    const { error: vendorError } = await admin.from("work_order_vendors").insert({ organization_id: company.organization_id, work_order_id: workOrder.id, vendor_id: vendor.id, vendor_role: text(body.vendor_role) || "Main Contractor", is_primary: true });
    if (vendorError) throw vendorError;
    const { error: lineError } = await admin.from("work_order_items").insert(normalizedLines.map((line: any) => ({ ...line, work_order_id: workOrder.id })));
    if (lineError) throw lineError;
    for (const [index, file] of supportingFiles.entries()) {
      const filePath = supportingDocumentPath(workOrder.id, index, file.name);
      const bytes = Buffer.from(await file.arrayBuffer());
      const { error: uploadError } = await admin.storage.from(SUPPORTING_DOCUMENT_BUCKET).upload(filePath, bytes, { contentType: "application/pdf", upsert: false });
      if (uploadError) throw uploadError;
      uploadedSupportingPaths.push(filePath);
      const fileUrl = admin.storage.from(SUPPORTING_DOCUMENT_BUCKET).getPublicUrl(filePath).data.publicUrl;
      const { error: documentError } = await admin.from("work_order_documents").insert({ organization_id: workOrder.organization_id, work_order_id: workOrder.id, file_name: file.name, file_url: fileUrl, file_path: filePath, uploaded_at: new Date(Date.now() + index).toISOString() });
      if (documentError) throw documentError;
    }
    return NextResponse.json({ workOrder }, { status: 201 });
  } catch (error: any) {
    if (uploadedSupportingPaths.length) {
      try { await adminClient().storage.from(SUPPORTING_DOCUMENT_BUCKET).remove(uploadedSupportingPaths); } catch { /* best-effort cleanup */ }
    }
    return NextResponse.json({ error: error.message || "Could not create Work Order." }, { status: 500 });
  }
}
