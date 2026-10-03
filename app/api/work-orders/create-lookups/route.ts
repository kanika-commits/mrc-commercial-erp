import { NextResponse } from "next/server";
import { adminClient, applyOrganizationAccess, hasGlobalProcurementAccess } from "@/lib/serverProcurementAccess";
import { requirePermission } from "@/lib/serverPermissions";

const VENDOR_CONTACT_BATCH_SIZE = 100;

async function loadVendorContacts(admin: any, vendorIds: string[]) {
  const contacts: any[] = [];
  let error: any = null;

  for (let start = 0; start < vendorIds.length; start += VENDOR_CONTACT_BATCH_SIZE) {
    const batch = vendorIds.slice(start, start + VENDOR_CONTACT_BATCH_SIZE);
    try {
      const result = await admin
        .from("vendor_contacts")
        .select("vendor_id,contact_name,contact_number,email,designation,is_primary")
        .in("vendor_id", batch)
        .order("is_primary", { ascending: false });
      if (result.error) {
        error = result.error;
        break;
      }
      contacts.push(...(result.data || []));
    } catch (caught) {
      error = caught;
      break;
    }
  }

  return { data: contacts, error };
}

export async function GET(request: Request) {
  try {
    const auth = await requirePermission(request, "work_orders", "add");
    if ("response" in auth) return auth.response;
    const admin = adminClient();
    const scoped = (query: any) => applyOrganizationAccess(query, auth);
    let companies: any = scoped(admin.from("companies").select("id,organization_id,company_name,company_code,status").eq("status", "active").order("company_name"));
    let sites: any = scoped(admin.from("sites").select("id,organization_id,company_id,site_name,site_code,status").eq("status", "active").order("site_name"));
    const vendors: any = scoped(admin.from("vendors").select("id,organization_id,vendor_name,address,gstin,pan,status").eq("status", "active").order("vendor_name"));
    const items: any = scoped(admin.from("work_order_item_masters").select("id,organization_id,item_header,description,unit,mode_of_measurement,status").eq("status", "active").order("item_header"));
    const letterheadQuery: any = scoped(admin.from("procurement_company_letterheads").select("id,organization_id,company_id,letterhead_name,is_default,status,versions:procurement_company_letterhead_versions(id,version_number,version_status,header_content_hash,footer_content_hash,header_storage_provider,header_storage_bucket,header_storage_key,footer_storage_provider,footer_storage_bucket,footer_storage_key,header_height_points,footer_height_points)").eq("status", "active").eq("is_default", true));
    const terms: any = scoped(admin.from("company_po_terms_templates").select("id,organization_id,company_id,template_name,is_default,status,sections:company_po_terms_sections(id,heading,clause_body,sort_order,status)").eq("status", "active").order("is_default", { ascending: false }).order("template_name"));
    const gst_billing_masters: any = scoped(admin.from("company_gst_registrations").select("id,organization_id,company_id,gstin,legal_name,trade_name,state,state_code,registration_type,is_default,status").eq("status", "active").order("is_default", { ascending: false }));
    const billing_addresses: any = scoped(admin.from("company_billing_addresses").select("id,organization_id,company_id,gst_registration_id,label,address_line1,address_line2,city,state,pincode,gstin,contact_name,mobile,email,is_default,status").eq("status", "active"));
    const delivery_locations: any = scoped(admin.from("site_delivery_locations").select("id,organization_id,company_id,company:companies(company_name),site_id,billing_address_id,billing_address:company_billing_addresses!inner(id,gst_registration_id),location_name,address,address_line1,address_line2,city,state,pincode,gstin,contact_name,mobile,email,is_default,status").eq("status", "active"));
    const site_contacts: any = scoped(admin.from("site_contacts").select("id,organization_id,site_id,contact_name,designation,mobile,email,contact_type,is_default,status").eq("status", "active").order("contact_name"));
    if (!hasGlobalProcurementAccess(auth)) {
      if ((auth.companies || []).length > 0 && companies) companies = companies.in("id", auth.companies);
      if (sites) {
        if ((auth.sites || []).length > 0) sites = sites.in("id", auth.sites);
        else if ((auth.companies || []).length > 0) sites = sites.in("company_id", auth.companies);
      }
    }
    const [companyResult, siteResult, vendorResult] = await Promise.all([companies, sites, vendors]);
    for (const [name, result] of [["Company", companyResult], ["Site", siteResult], ["Vendor", vendorResult]] as const) {
      if (result?.error) throw new Error(`${name} lookup failed: ${result.error.message}`);
    }
    const vendorIds = (vendorResult.data || []).map((vendor: any) => vendor.id).filter(Boolean);
    const vendorContactsResult = await loadVendorContacts(admin, vendorIds);
    // Keep contact enrichment scoped to the same authorized vendor records so
    // the Work Order preview receives the selected vendor's canonical contact data.
    const contactsByVendor = new Map<string, any[]>();
    for (const contact of vendorContactsResult.data || []) contactsByVendor.set(contact.vendor_id, [...(contactsByVendor.get(contact.vendor_id) || []), contact]);
    const resolvedVendors = (vendorResult.data || []).map((vendor: any) => ({ ...vendor, contacts: contactsByVendor.get(vendor.id) || [] }));

    const dependentQueries = [
      ["Work Order Item Master", items],
      ["Letterhead Master", letterheadQuery],
      ["Terms & Conditions Master", terms],
      ["GST/Billing Master", gst_billing_masters],
      ["Billing Address Master", billing_addresses],
      ["Delivery Location Master", delivery_locations],
      ["Site Contact Master", site_contacts],
    ] as const;
    const dependentResults = await Promise.all(dependentQueries.map(async ([name, query]) => {
      if (!query) return { name, data: [], error: `${name} lookup is outside the authorized scope.` };
      const result = await query;
      return result?.error
        ? { name, data: [], error: `${name} lookup failed: ${result.error.message}` }
        : { name, data: result?.data || [], error: null };
    }));
    const dependentData = Object.fromEntries(dependentResults.map((result) => [result.name, result.data]));
    const billingRows = dependentData["Billing Address Master"] || [];
    const accessibleSiteIds = new Set((siteResult.data || []).map((site: any) => site.id));
    const accessibleBillingIds = new Set(billingRows.map((row: any) => row.id));
    const gstBillingMasters = (dependentData["GST/Billing Master"] || [])
      .map((gst: any) => {
        const linked = billingRows.filter((row: any) => row.company_id === gst.company_id && row.gst_registration_id === gst.id);
        const billing = linked.find((row: any) => row.is_default) || (linked.length === 1 ? linked[0] : null);
        return {
          ...gst,
          billing_addresses: linked,
          billing_address: billing ? {
            id: billing.id,
            label: billing.label,
            address_line1: billing.address_line1,
            address_line2: billing.address_line2,
            city: billing.city,
            state: billing.state,
            pincode: billing.pincode,
            address: [billing.address_line1, billing.address_line2, billing.city, billing.state, billing.pincode].filter(Boolean).join(", "),
          } : null,
        };
      })
      .filter(Boolean);
    const letterheads = (dependentData["Letterhead Master"] || []).flatMap((row: any) => {
      const ready = (row.versions || [])
        .filter((version: any) => version.version_status === "ready" && version.header_content_hash && version.footer_content_hash)
        .sort((a: any, b: any) => Number(b.version_number || 0) - Number(a.version_number || 0))[0];
      return ready ? [{ id: row.id, company_id: row.company_id, letterhead_name: row.letterhead_name, is_default: row.is_default, version_id: ready.id, version_number: ready.version_number, header_storage_provider: ready.header_storage_provider, header_storage_bucket: ready.header_storage_bucket, header_storage_key: ready.header_storage_key, footer_storage_provider: ready.footer_storage_provider, footer_storage_bucket: ready.footer_storage_bucket, footer_storage_key: ready.footer_storage_key, header_height_points: ready.header_height_points, footer_height_points: ready.footer_height_points }] : [];
    });
    const deliveryLocations = (dependentData["Delivery Location Master"] || [])
      .filter((row: any) => accessibleSiteIds.has(row.site_id) && row.billing_address?.gst_registration_id && accessibleBillingIds.has(row.billing_address_id));
    dependentData["GST/Billing Master"] = gstBillingMasters;
    dependentData["Letterhead Master"] = letterheads;
    dependentData["Delivery Location Master"] = deliveryLocations;
    const lookupErrors = [
      ...(vendorContactsResult.error
        ? [{ master: "Vendor Contact", message: `Vendor contact lookup failed: ${vendorContactsResult.error.message || "Request failed."}`, retryable: true }]
        : []),
      ...dependentResults.filter((result) => result.error).map((result) => ({ master: result.name, message: result.error, retryable: true })),
    ];
    return NextResponse.json({
      companies: companyResult?.data || [],
      sites: siteResult?.data || [],
      vendors: resolvedVendors,
      items: dependentData["Work Order Item Master"],
      letterheads: dependentData["Letterhead Master"],
      terms_templates: dependentData["Terms & Conditions Master"],
      gst_billing_masters: dependentData["GST/Billing Master"],
      billing_addresses: dependentData["Billing Address Master"],
      delivery_locations: dependentData["Delivery Location Master"],
      site_contacts: dependentData["Site Contact Master"],
      lookup_errors: lookupErrors,
    });
  } catch (error: any) { return NextResponse.json({ error: error.message || "Could not load Work Order options." }, { status: 500 }); }
}
