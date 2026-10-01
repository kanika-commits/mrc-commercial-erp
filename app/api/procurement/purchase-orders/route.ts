import { NextResponse } from "next/server";
import { adminClient, applyCompanySiteAccess, applyOrganizationAccess, jsonError, requireProcurementPermission, text, validateOrganizationSiteAccess } from "@/lib/serverProcurementAccess";
import { createPrivateStorageAdapter } from "@/lib/storage/privateStorage";

const MODULE = "procurement_purchase_orders";
function actor(auth: any) { return { user_id: auth.user.id, name: text(auth.user.user_metadata?.full_name || auth.user.user_metadata?.name || auth.user.email), email: auth.user.email || null }; }
function normalizeAdditionalCharges(value: unknown) {
  if (!Array.isArray(value)) return { charges: [], error: null };
  const charges = value.map((charge: any) => {
    const name = text(charge?.name);
    const amount = Number(charge?.amount);
    return { name, amount };
  });
  if (charges.some((charge) => !charge.name || !Number.isFinite(charge.amount) || charge.amount < 0)) return { charges: [], error: "Each additional charge needs a name and a valid non-negative amount." };
  return { charges, error: null };
}

export async function GET(request: Request) {
  try {
    const auth = await requireProcurementPermission(request, MODULE, "view"); if ("response" in auth) return auth.response;
    const params = new URL(request.url).searchParams;
    const admin = adminClient(); let query: any = applyOrganizationAccess(admin.from("procurement_purchase_orders").select("*, company:companies!procurement_purchase_orders_company_id_fkey(id,company_name,company_code), site:sites(id,site_name,site_code), items:procurement_purchase_order_items(*)").order("created_at", { ascending: false }), auth);
    query = query && applyCompanySiteAccess(query, auth); if (!query) return NextResponse.json({ purchase_orders: [] });
    if (text(params.get("source_type"))) query = query.eq("source_type", text(params.get("source_type")));
    if (text(params.get("status"))) query = query.eq("status", text(params.get("status")));
    if (text(params.get("company_id"))) query = query.eq("company_id", text(params.get("company_id")));
    if (text(params.get("site_id"))) query = query.eq("site_id", text(params.get("site_id")));
    if (text(params.get("vendor_id"))) query = query.eq("vendor_id", text(params.get("vendor_id")));
    if (text(params.get("from_date"))) query = query.gte("po_date", text(params.get("from_date")));
    if (text(params.get("to_date"))) query = query.lte("po_date", text(params.get("to_date")));
    const { data, error } = await query; if (error) throw error;
    const purchaseOrders = data || [];
    const approvedIds = purchaseOrders.filter((row: any) => ["approved", "issued"].includes(row.status)).map((row: any) => row.id);
    if (approvedIds.length) {
      const signedDocumentOrganizationIds = [...new Set(purchaseOrders.filter((row: any) => approvedIds.includes(row.id)).map((row: any) => row.organization_id).filter(Boolean))];
      const signedDocuments = await admin.from("procurement_purchase_order_documents")
        .select("id,purchase_order_id,original_file_name,mime_type,size_bytes,storage_bucket,storage_key,created_at")
        .in("purchase_order_id", approvedIds).in("organization_id", signedDocumentOrganizationIds).eq("document_type", "signed_po").eq("status", "active")
        .order("created_at", { ascending: false });
      if (signedDocuments.error) throw signedDocuments.error;
      const storage = createPrivateStorageAdapter(admin);
      const latestByPo = new Map<string, any>();
      for (const document of signedDocuments.data || []) {
        if (latestByPo.has(document.purchase_order_id)) continue;
        latestByPo.set(document.purchase_order_id, {
          id: document.id,
          original_file_name: document.original_file_name,
          mime_type: document.mime_type,
          size_bytes: document.size_bytes,
          created_at: document.created_at,
          signed_url: document.storage_bucket && document.storage_key
            ? await storage.createSignedReadUrl({ bucket: document.storage_bucket, key: document.storage_key })
            : null,
        });
      }
      for (const row of purchaseOrders) row.signed_po_document = latestByPo.get(row.id) || null;
    }
    return NextResponse.json({ purchase_orders: purchaseOrders });
  } catch (error: any) { return jsonError(error.message || "Failed to load Purchase Orders.", 500); }
}

export async function POST(request: Request) {
  try {
    const auth = await requireProcurementPermission(request, MODULE, "add"); if ("response" in auth) return auth.response;
    const body = await request.json().catch(() => ({}));
    const sourceType = text(body.source_type) || "direct";
    const admin = adminClient();
    if (sourceType !== "direct" && sourceType !== "indent") return jsonError("Purchase Order source is invalid.", 400);
    const companyId = text(body.company_id), siteId = text(body.site_id), vendorId = text(body.vendor_id);
    if (!companyId || !siteId || !vendorId) return jsonError("Company, site and Vendor are required.", 400);
    const selectedCompanyId: string = String(companyId);
    const selectedSiteId: string = String(siteId);
    const selectedVendorId: string = String(vendorId);
    const scope = await validateOrganizationSiteAccess(admin, auth, selectedCompanyId, selectedSiteId); if ("error" in scope) return jsonError(String(scope.error), Number(scope.status || 400));
    const organizationId = "organizationId" in scope ? scope.organizationId : null;
    if (!organizationId) return jsonError("Selected company/site organization is invalid.", 400);
    const vendor = await admin.from("vendors").select("id,organization_id,vendor_name,address,pan,gstin,status,is_deleted").eq("id", selectedVendorId).eq("organization_id", organizationId).maybeSingle();
    if (vendor.error) throw vendor.error; if (!vendor.data || vendor.data.status === "deleted" || vendor.data.is_deleted) return jsonError("Vendor is invalid for the selected organization.", 400);
    if (!text(vendor.data.address)) return jsonError("Vendor Address is required before creating the Purchase Order.", 400);
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return jsonError("At least one Purchase Order item is required.", 400);
    if (items.some((item: any) => !text(item.item_name) || Number(item.quantity) <= 0 || !Number.isFinite(Number(item.quantity)) || Number(item.unit_rate || 0) < 0 || Number(item.gst_rate || 0) < 0)) return jsonError("Each item needs a name, positive quantity, non-negative rate and valid GST.", 400);
    const additional = normalizeAdditionalCharges(body.commercial?.additional_charges);
    if (additional.error) return jsonError(additional.error, 400);
    const keyTerms = Array.isArray(body.key_terms) ? body.key_terms : [];
    if (keyTerms.length < 4 || keyTerms.slice(0, 4).some((term: any) => !text(term?.terms)) || keyTerms.slice(4).some((term: any) => !text(term?.description) || !text(term?.terms))) return jsonError("All default Key Terms and any additional terms must have meaningful values.", 400);
    const itemIds = [...new Set(items.map((item: any) => text(item.item_id || item.procurement_item_id)).filter(Boolean))];
    if (itemIds.length) {
      const itemResult = await admin.from("procurement_items").select("id").in("id", itemIds).eq("organization_id", organizationId).eq("status", "active");
      if (itemResult.error) throw itemResult.error;
      if ((itemResult.data || []).length !== itemIds.length) return jsonError("One or more Purchase Order items are invalid for the selected organization.", 400);
    }
    let requisitionId: string | null = null; let requisitionNumber = "";
    if (sourceType === "indent") {
      requisitionId = text(body.source_requisition_id); if (!requisitionId) return jsonError("Material Indent is required for this source.", 400);
      const requisition = await admin.from("purchase_requisitions").select("id,requisition_number,organization_id,company_id,site_id").eq("id", requisitionId).maybeSingle();
      if (requisition.error) throw requisition.error; if (!requisition.data || requisition.data.organization_id !== organizationId || requisition.data.company_id !== selectedCompanyId || requisition.data.site_id !== selectedSiteId) return jsonError("Material Indent is outside the selected scope.", 403);
      requisitionNumber = requisition.data.requisition_number;
      if (items.some((item: any) => !text(item.source_requisition_line_key))) return jsonError("Every Indent item must include its source line.", 400);
    }
    const [contact, primaryGstin] = await Promise.all([
      admin.from("vendor_contacts").select("contact_name,contact_number,email,designation").eq("vendor_id", selectedVendorId).order("is_primary", { ascending: false }).limit(1).maybeSingle(),
      admin.from("vendor_gstins").select("gstin").eq("vendor_id", selectedVendorId).eq("is_primary", true).maybeSingle(),
    ]);
    if (contact.error) throw contact.error;
    if (primaryGstin.error) throw primaryGstin.error;
    const vendorSnapshot = { vendor_name: vendor.data.vendor_name, address: vendor.data.address || null, gstin: primaryGstin.data?.gstin || vendor.data.gstin || null, pan: vendor.data.pan || null, contact_person: contact.data?.contact_name || null, phone: contact.data?.contact_number || null, email: contact.data?.email || null, designation: contact.data?.designation || null };
    const creationRequestId = text(body.creation_request_id) || null;
    if (creationRequestId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(creationRequestId)) return jsonError("Creation request ID is invalid.", 400);
    const rpcArgs: any = { p_source_type: sourceType, p_organization_id: organizationId, p_company_id: selectedCompanyId, p_site_id: selectedSiteId, p_vendor_id: selectedVendorId, p_vendor_snapshot: vendorSnapshot, p_source_requisition_id: requisitionId, p_source_requisition_number: requisitionNumber, p_items: items, p_fields: { po_date: text(body.po_date), delivery: body.delivery || {}, master_selection: body.master_selection || {}, commercial: { ...(body.commercial || {}), additional_charges: additional.charges, key_terms: keyTerms }, standard_terms: text(body.standard_terms), standard_terms_template_id: text(body.standard_terms_template_id), standard_terms_sections: Array.isArray(body.standard_terms_sections) ? body.standard_terms_sections : [] }, p_actor: actor(auth) };
    const rpcName = creationRequestId ? "create_procurement_purchase_order_draft_idempotent_atomic" : "create_procurement_purchase_order_draft_atomic";
    if (creationRequestId) rpcArgs.p_creation_request_id = creationRequestId;
    const result = await admin.rpc(rpcName, rpcArgs);
    if (result.error) {
      const message = String(result.error.message || "");
      if (/approved Indent line/i.test(message)) return jsonError("One or more Indent lines are not approved for Purchase.", 400);
      if (/remaining approved Indent quantity/i.test(message)) return jsonError("Requested quantity exceeds the remaining Indent quantity.", 400);
      throw result.error;
    }
    const createdId = result.data?.purchase_order_id;
    return NextResponse.json({ result: result.data }, { status: 201 });
  } catch (error: any) { return jsonError(error.message || "Failed to create Purchase Order.", 500); }
}
