import "server-only";

export async function resolveDraftPoMasterView(admin: any, row: any) {
  if (String(row?.status || "").toLowerCase() !== "draft" || Number(row?.revision_no || 0) !== 0 || row?.previous_revision_id) return row;
  const selection = row?.delivery_snapshot?.master_selection || {};
  try {
    const [company, site, billing, delivery, contact, vendor, vendorContact, vendorGstin] = await Promise.all([
      admin.from("companies").select("id,company_name,company_code").eq("id", row.company_id).eq("organization_id", row.organization_id).maybeSingle(),
      admin.from("sites").select("id,site_name,site_code").eq("id", row.site_id).eq("organization_id", row.organization_id).maybeSingle(),
      selection.billing_address_id ? admin.from("company_billing_addresses").select("*").eq("id", selection.billing_address_id).eq("organization_id", row.organization_id).maybeSingle() : { data: null, error: null },
      selection.delivery_location_id ? admin.from("site_delivery_locations").select("*").eq("id", selection.delivery_location_id).eq("organization_id", row.organization_id).maybeSingle() : { data: null, error: null },
      (selection.delivery_contact_id || selection.site_contact_id) ? admin.from("site_contacts").select("*").eq("id", selection.delivery_contact_id || selection.site_contact_id).eq("organization_id", row.organization_id).maybeSingle() : { data: null, error: null },
      row.vendor_id ? admin.from("vendors").select("vendor_name,address,gstin,pan").eq("id", row.vendor_id).eq("organization_id", row.organization_id).maybeSingle() : { data: null, error: null },
      row.vendor_id ? admin.from("vendor_contacts").select("contact_name,contact_number,email,designation").eq("vendor_id", row.vendor_id).order("is_primary", { ascending: false }).limit(1).maybeSingle() : { data: null, error: null },
      row.vendor_id ? admin.from("vendor_gstins").select("gstin").eq("vendor_id", row.vendor_id).eq("is_primary", true).maybeSingle() : { data: null, error: null },
    ]);
    for (const result of [company, site, billing, delivery, contact, vendor, vendorContact, vendorGstin]) if (result.error) throw result.error;
    const next = structuredClone(row); next.company = company.data || row.company; next.site = site.data || row.site;
    if (vendor.data) next.vendor_name_snapshot = vendor.data.vendor_name, next.vendor_snapshot = { ...(row.vendor_snapshot || {}), vendor_name: vendor.data.vendor_name, address: vendor.data.address, gstin: vendorGstin.data?.gstin || vendor.data.gstin, pan: vendor.data.pan, contact_person: vendorContact.data?.contact_name || null, phone: vendorContact.data?.contact_number || null, email: vendorContact.data?.email || null, designation: vendorContact.data?.designation || null };
    const snapshot = row.delivery_snapshot || {};
    next.delivery_snapshot = { ...snapshot, billing_address: billing.data ? { ...(snapshot.billing_address || {}), ...billing.data } : snapshot.billing_address, delivery_location: delivery.data ? { ...(snapshot.delivery_location || {}), ...delivery.data } : snapshot.delivery_location, site_contact: contact.data ? { ...(snapshot.site_contact || {}), ...contact.data } : snapshot.site_contact, delivery_contact: contact.data ? { ...(snapshot.delivery_contact || {}), ...contact.data } : snapshot.delivery_contact };
    return next;
  } catch (error) { console.warn("Draft PO master refresh failed; using stored snapshot", { purchaseOrderId: row?.id, reason: error instanceof Error ? error.message : String(error) }); return row; }
}
