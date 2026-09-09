import { NextResponse } from "next/server";
import { adminClient, applyCompanySiteAccess, applyOrganizationAccess, jsonError, requireProcurementPermission } from "@/lib/serverProcurementAccess";

const MODULE = "procurement_purchase_orders";

function hasGlobalAccess(auth: any) {
  return auth.isGlobalAccess || (auth.roleCodes || []).includes("platform_owner");
}

export async function GET(request: Request) {
  try {
    const auth = await requireProcurementPermission(request, MODULE, "add");
    if ("response" in auth) return auth.response;
    const admin = adminClient();
    let companies: any = applyOrganizationAccess(admin.from("companies").select("id,organization_id,company_name,company_code,status").eq("status", "active").order("company_name"), auth);
    let sites: any = applyOrganizationAccess(admin.from("sites").select("id,organization_id,company_id,site_name,site_code,location,state,status").eq("status", "active").order("site_name"), auth);
    let vendors: any = applyOrganizationAccess(admin.from("vendors").select("id,organization_id,vendor_name,contractor_type,pan,address,gstin,profile_status,status,is_deleted").eq("status", "active").eq("is_deleted", false).order("vendor_name"), auth);
    let items: any = applyOrganizationAccess(admin.from("procurement_items").select("id,organization_id,item_code,item_name,description,hsn_sac,default_uom_id,default_uom:procurement_uoms(id,uom_code,uom_name)").eq("status", "active").order("item_name"), auth);
    if (!companies || !sites || !vendors || !items) return NextResponse.json({ companies: [], sites: [], vendors: [], items: [], indents: [] });
    if (!auth.isGlobalAccess && !(auth.roleCodes || []).includes("platform_owner")) {
      if ((auth.sites || []).length > 0) sites = sites.in("id", auth.sites);
      if ((auth.companies || []).length > 0) companies = companies.in("id", auth.companies);
    }
    const [companyResult, siteResult, vendorResult, itemResult] = await Promise.all([
      companies,
      sites,
      vendors,
      items,
    ]);
    for (const result of [companyResult, siteResult, vendorResult, itemResult]) if (result.error) throw result.error;

    const vendorIds = (vendorResult.data || []).map((vendor: any) => vendor.id);
    const vendorIdBatches = Array.from({ length: Math.ceil(vendorIds.length / 100) }, (_, index) => vendorIds.slice(index * 100, (index + 1) * 100));
    const [contactResults, gstinResults] = vendorIds.length ? await Promise.all([
      Promise.all(vendorIdBatches.map((batch) => admin.from("vendor_contacts").select("vendor_id,contact_name,contact_number,email,designation,is_primary").in("vendor_id", batch).order("is_primary", { ascending: false }))),
      Promise.all(vendorIdBatches.map((batch) => admin.from("vendor_gstins").select("vendor_id,gstin,state_code,state_name,is_primary").in("vendor_id", batch).order("is_primary", { ascending: false }))),
    ]) : [[], []];
    const contactResult = { data: contactResults.flatMap((result: any) => result.data || []), error: contactResults.find((result: any) => result.error)?.error || null };
    const gstinResult = { data: gstinResults.flatMap((result: any) => result.data || []), error: gstinResults.find((result: any) => result.error)?.error || null };
    if (contactResult.error) throw contactResult.error;
    if (gstinResult.error) throw gstinResult.error;
    const contactsByVendor = new Map<string, any>();
    for (const contact of contactResult.data || []) if (!contactsByVendor.has(contact.vendor_id)) contactsByVendor.set(contact.vendor_id, contact);
    const gstinsByVendor = new Map<string, any>();
    for (const gstin of gstinResult.data || []) if (!gstinsByVendor.has(gstin.vendor_id)) gstinsByVendor.set(gstin.vendor_id, gstin);
    const vendorOptions = (vendorResult.data || []).map((vendor: any) => ({ ...vendor, contacts: (contactResult.data || []).filter((contact: any) => contact.vendor_id === vendor.id), contact: contactsByVendor.get(vendor.id) || null, primary_gstin: gstinsByVendor.get(vendor.id)?.gstin || vendor.gstin || null }));
    const gstQuery = applyOrganizationAccess(admin.from("company_gst_registrations").select("id,organization_id,company_id,gstin,legal_name,trade_name,state,state_code,registration_type,is_default,status").eq("status", "active"), auth);
    const billingQuery = applyOrganizationAccess(admin.from("company_billing_addresses").select("id,organization_id,company_id,gst_registration_id,label,address_line1,address_line2,city,state,pincode,gstin,contact_name,mobile,email,is_default,status").eq("status", "active"), auth);
    const termsQuery = applyOrganizationAccess(admin.from("company_po_terms_templates").select("id,organization_id,company_id,template_name,is_default,status,sections:company_po_terms_sections(id,heading,clause_body,sort_order,status)").eq("status", "active"), auth);
    const siteContactQuery = applyOrganizationAccess(admin.from("site_contacts").select("id,organization_id,site_id,contact_name,designation,mobile,email,contact_type,is_default,status").eq("status", "active").order("contact_name"), auth);
    const addressContactsQuery = applyOrganizationAccess(admin.from("procurement_address_contacts").select("*").eq("status", "active").order("sort_order"), auth);
    const letterheadQuery = applyOrganizationAccess(admin.from("procurement_company_letterheads").select("id,organization_id,company_id,letterhead_name,is_default,status,versions:procurement_company_letterhead_versions(id,version_number,version_status,header_content_hash,footer_content_hash)").eq("status", "active").eq("is_default", true), auth);
    const [gstResult, billingResult, termsResult, siteContactResult, addressContactsResult, letterheadResult] = await Promise.all([
      gstQuery ? gstQuery : Promise.resolve({ data: [], error: null }),
      billingQuery ? billingQuery : Promise.resolve({ data: [], error: null }),
      termsQuery ? termsQuery : Promise.resolve({ data: [], error: null }),
      siteContactQuery ? siteContactQuery : Promise.resolve({ data: [], error: null }),
      addressContactsQuery ? addressContactsQuery : Promise.resolve({ data: [], error: null }),
      letterheadQuery ? letterheadQuery : Promise.resolve({ data: [], error: null }),
    ]);
    const masterRows = (result: any) => result.error ? [] : result.data || [];
    const gstRows = masterRows(gstResult);
    const billingAddresses = masterRows(billingResult);
    const termsTemplates = masterRows(termsResult);
    const accessibleSiteIds = new Set<string>((siteResult.data || []).map((site: any) => site.id));
    const authCompanyIds = new Set<string>(auth.companies || []);
    const accessibleBillingIds = new Set<string>(billingAddresses.filter((row: any) => hasGlobalAccess(auth) || !authCompanyIds.size || authCompanyIds.has(row.company_id)).map((row: any) => row.id));
    let deliveryLocationQuery: any = applyOrganizationAccess(admin.from("site_delivery_locations").select("id,organization_id,company_id,company:companies(company_name),site_id,billing_address_id,location_name,address,address_line1,address_line2,city,state,pincode,gstin,contact_name,mobile,email,is_default,status").eq("status", "active"), auth);
    if (deliveryLocationQuery && !hasGlobalAccess(auth)) {
      if ((auth.sites || []).length > 0) deliveryLocationQuery = deliveryLocationQuery.in("site_id", auth.sites);
      else if (accessibleBillingIds.size > 0) deliveryLocationQuery = deliveryLocationQuery.in("billing_address_id", Array.from(accessibleBillingIds));
      else deliveryLocationQuery = null;
    }
    const deliveryLocationResult = deliveryLocationQuery ? await deliveryLocationQuery : { data: [], error: null };
    if (deliveryLocationResult.error) throw deliveryLocationResult.error;
    const deliveryLocations = masterRows(deliveryLocationResult)
      .filter((row: any) => accessibleSiteIds.has(row.site_id) || !row.billing_address_id || accessibleBillingIds.has(row.billing_address_id))
      .sort((a: any, b: any) => Number(b.is_default) - Number(a.is_default) || String(a.location_name || "").localeCompare(String(b.location_name || "")));
    const siteContacts = masterRows(siteContactResult).filter((row: any) => accessibleSiteIds.has(row.site_id));
    const addressContacts = masterRows(addressContactsResult);
    const gstBillingMasters = gstRows.map((gst: any) => {
      const linked = billingAddresses.filter((row: any) => row.company_id === gst.company_id && row.gst_registration_id === gst.id);
      const legacy = billingAddresses.filter((row: any) => row.company_id === gst.company_id && !row.gst_registration_id);
      const billing = linked.find((row: any) => row.is_default) || linked[0] || (legacy.length === 1 ? legacy[0] : null);
      return { ...gst, billing_address: billing ? { id: billing.id, label: billing.label, address_line1: billing.address_line1, address_line2: billing.address_line2, city: billing.city, state: billing.state, pincode: billing.pincode, address: [billing.address_line1, billing.address_line2, billing.city, billing.state, billing.pincode].filter(Boolean).join(", ") } : null };
    });
    const gstKeys = new Set(gstRows.map((row: any) => `${row.company_id}:${String(row.gstin || "").toUpperCase()}`));
    for (const billing of billingAddresses) {
      if (billing.gst_registration_id || !billing.gstin || gstKeys.has(`${billing.company_id}:${String(billing.gstin || "").toUpperCase()}`)) continue;
      gstBillingMasters.push({
        id: `legacy-${billing.id}`,
        organization_id: billing.organization_id,
        company_id: billing.company_id,
        gstin: billing.gstin,
        legal_name: billing.label,
        trade_name: billing.label,
        state: billing.state,
        state_code: null,
        registration_type: null,
        is_default: billing.is_default,
        status: billing.status,
        billing_address: {
          id: billing.id,
          label: billing.label,
          address_line1: billing.address_line1,
          address_line2: billing.address_line2,
          city: billing.city,
          state: billing.state,
          pincode: billing.pincode,
          address: [billing.address_line1, billing.address_line2, billing.city, billing.state, billing.pincode].filter(Boolean).join(", "),
        },
      });
    }
    const letterheads = masterRows(letterheadResult).flatMap((row: any) => {
      const ready = (row.versions || []).filter((version: any) => version.version_status === "ready" && version.header_content_hash && version.footer_content_hash).sort((a: any, b: any) => Number(b.version_number || 0) - Number(a.version_number || 0))[0];
      return ready ? [{ id: row.id, company_id: row.company_id, letterhead_name: row.letterhead_name, version_id: ready.id, version_number: ready.version_number }] : [];
    });
    let requisitions: any = applyOrganizationAccess(admin.from("purchase_requisitions").select("id,requisition_number,requisition_date,organization_id,company_id,site_id,items:purchase_requisition_items(line_key,item_code_snapshot,item_name_snapshot,specification,uom_snapshot,quantity,required_by_date,sort_order)").eq("procurement_flow", "billing_engineer").in("status", ["approved", "pending_approval"]), auth);
    requisitions = requisitions && applyCompanySiteAccess(requisitions, auth);
    if (!requisitions) return NextResponse.json({ companies: companyResult.data || [], sites: siteResult.data || [], vendors: vendorOptions, items: itemResult.data || [], indents: [], gst_billing_masters: gstBillingMasters, billing_addresses: billingAddresses, terms_templates: termsTemplates, delivery_locations: deliveryLocations, site_contacts: siteContacts, address_contacts: addressContacts, letterheads });
    const requisitionResult = await requisitions; if (requisitionResult.error) throw requisitionResult.error;
    const rows = requisitionResult.data || [];
    const ids = rows.map((row: any) => row.id);
    if (!ids.length) return NextResponse.json({ companies: companyResult.data || [], sites: siteResult.data || [], vendors: vendorOptions, items: itemResult.data || [], indents: [], gst_billing_masters: gstBillingMasters, billing_addresses: billingAddresses, terms_templates: termsTemplates, delivery_locations: deliveryLocations, site_contacts: siteContacts, address_contacts: addressContacts, letterheads });
    const [stateResult, orderedResult] = await Promise.all([
      admin.from("purchase_requisition_line_approval_state").select("requisition_id,requisition_item_line_key,approval_status,current_approval_layer").in("requisition_id", ids),
      admin.from("procurement_purchase_order_items").select("source_requisition_id,source_requisition_line_key,quantity,purchase_order:procurement_purchase_orders!inner(status)").in("source_requisition_id", ids),
    ]);
    if (stateResult.error) throw stateResult.error; if (orderedResult.error) throw orderedResult.error;
    const eligible = new Set((stateResult.data || []).filter((state: any) => state.approval_status === "approved" && state.current_approval_layer === null).map((state: any) => `${state.requisition_id}:${state.requisition_item_line_key}`));
    const consumed = new Map<string, number>();
    for (const row of orderedResult.data || []) if (!['rejected', 'cancelled'].includes(row.purchase_order?.[0]?.status)) consumed.set(`${row.source_requisition_id}:${row.source_requisition_line_key}`, (consumed.get(`${row.source_requisition_id}:${row.source_requisition_line_key}`) || 0) + Number(row.quantity || 0));
    const indents = rows.flatMap((row: any) => (row.items || []).filter((item: any) => eligible.has(`${row.id}:${item.line_key}`)).map((item: any) => ({ requisition_id: row.id, requisition_number: row.requisition_number, requisition_date: row.requisition_date, company_id: row.company_id, site_id: row.site_id, ...item, ordered_quantity: consumed.get(`${row.id}:${item.line_key}`) || 0, remaining_quantity: Math.max(0, Number(item.quantity || 0) - (consumed.get(`${row.id}:${item.line_key}`) || 0)) })).filter((item: any) => item.remaining_quantity > 0));
    return NextResponse.json({ companies: companyResult.data || [], sites: siteResult.data || [], vendors: vendorOptions, items: itemResult.data || [], indents, gst_billing_masters: gstBillingMasters, billing_addresses: billingAddresses, terms_templates: termsTemplates, delivery_locations: deliveryLocations, site_contacts: siteContacts, address_contacts: addressContacts, letterheads });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load Purchase Order lookups.", 500);
  }
}
