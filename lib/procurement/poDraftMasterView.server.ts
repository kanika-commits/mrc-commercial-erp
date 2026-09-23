import "server-only";

export async function resolvePoMasterProjection(admin: any, row: any, options: { strict?: boolean } = {}) {
  const strict = options.strict === true;
  if (Number(row?.revision_no || 0) !== 0 || row?.previous_revision_id) return row;
  const selection = row?.delivery_snapshot?.master_selection || {};
  try {
    const [company, site, gstRegistration, billing, billingContact, delivery, contact, vendor, vendorContact, vendorGstin, items] = await Promise.all([
      admin.from("companies").select("id,company_name,company_code").eq("id", row.company_id).eq("organization_id", row.organization_id).maybeSingle(),
      admin.from("sites").select("id,site_name,site_code").eq("id", row.site_id).eq("organization_id", row.organization_id).maybeSingle(),
      selection.gst_registration_id ? admin.from("company_gst_registrations").select("*").eq("id", selection.gst_registration_id).eq("organization_id", row.organization_id).eq("company_id", row.company_id).maybeSingle() : { data: null, error: null },
      selection.billing_address_id ? admin.from("company_billing_addresses").select("*").eq("id", selection.billing_address_id).eq("organization_id", row.organization_id).maybeSingle() : { data: null, error: null },
      selection.billing_contact_id ? admin.from("site_contacts").select("*").eq("id", selection.billing_contact_id).eq("organization_id", row.organization_id).maybeSingle() : { data: null, error: null },
      selection.delivery_location_id ? admin.from("site_delivery_locations").select("*").eq("id", selection.delivery_location_id).eq("organization_id", row.organization_id).maybeSingle() : { data: null, error: null },
      (selection.delivery_contact_id || selection.site_contact_id) ? admin.from("site_contacts").select("*").eq("id", selection.delivery_contact_id || selection.site_contact_id).eq("organization_id", row.organization_id).maybeSingle() : { data: null, error: null },
      row.vendor_id ? admin.from("vendors").select("vendor_name,address,gstin,pan").eq("id", row.vendor_id).eq("organization_id", row.organization_id).maybeSingle() : { data: null, error: null },
      row.vendor_id ? admin.from("vendor_contacts").select("contact_name,contact_number,email,designation").eq("vendor_id", row.vendor_id).order("is_primary", { ascending: false }).limit(1).maybeSingle() : { data: null, error: null },
      row.vendor_id ? admin.from("vendor_gstins").select("gstin").eq("vendor_id", row.vendor_id).eq("is_primary", true).maybeSingle() : { data: null, error: null },
      admin.from("procurement_purchase_order_items").select("id,item_id").eq("purchase_order_id", row.id),
    ]);
    for (const result of [company, site, gstRegistration, billing, billingContact, delivery, contact, vendor, vendorContact, vendorGstin, items]) if (result.error) throw result.error;
    const required = (value: any, label: string) => { if (strict && !value) throw new Error(`Selected ${label} could not be resolved.`); return value; };
    required(company.data, "Company"); required(site.data, "Site");
    if (row.vendor_id) required(vendor.data, "Vendor");
    if (selection.billing_address_id) required(billing.data, "billing address");
    if (selection.gst_registration_id) required(gstRegistration.data, "GST registration");
    if (selection.delivery_location_id) required(delivery.data, "delivery location");
    if (selection.delivery_contact_id || selection.site_contact_id) required(contact.data, "site contact");
    if (selection.billing_contact_id) required(billingContact.data, "billing contact");
    const linkedItemIds = (items.data || []).map((item: any) => item.item_id).filter(Boolean);
    const itemResult = linkedItemIds.length ? await admin.from("procurement_items").select("id,item_code,item_name,default_uom:procurement_uoms(uom_code)").in("id", linkedItemIds).eq("organization_id", row.organization_id).eq("status", "active") : { data: [], error: null };
    if (itemResult.error) throw itemResult.error;
    const itemById = new Map<string, any>((itemResult.data || []).map((item: any) => [item.id, item] as [string, any]));
    if (strict && itemById.size !== new Set(linkedItemIds).size) throw new Error("A linked Item Master could not be resolved.");
    const next = structuredClone(row); next.company = company.data || row.company; next.site = site.data || row.site;
    if (vendor.data) next.vendor_name_snapshot = vendor.data.vendor_name, next.vendor_snapshot = { ...(row.vendor_snapshot || {}), vendor_name: vendor.data.vendor_name, address: vendor.data.address, gstin: vendorGstin.data?.gstin || vendor.data.gstin, pan: vendor.data.pan, contact_person: vendorContact.data?.contact_name || null, phone: vendorContact.data?.contact_number || null, email: vendorContact.data?.email || null, designation: vendorContact.data?.designation || null };
    const snapshot = row.delivery_snapshot || {};
    next.delivery_snapshot = { ...snapshot, gst_billing: gstRegistration.data ? { ...(snapshot.gst_billing || {}), ...gstRegistration.data } : snapshot.gst_billing, billing_address: billing.data ? { ...(snapshot.billing_address || {}), ...billing.data, ...(gstRegistration.data ? { gstin: gstRegistration.data.gstin, legal_name: gstRegistration.data.legal_name, trade_name: gstRegistration.data.trade_name, state: gstRegistration.data.state, state_code: gstRegistration.data.state_code } : {}) } : snapshot.billing_address, billing_contact: billingContact.data ? { ...(snapshot.billing_contact || {}), ...billingContact.data } : snapshot.billing_contact, delivery_location: delivery.data ? { ...(snapshot.delivery_location || {}), ...delivery.data } : snapshot.delivery_location, site_contact: contact.data ? { ...(snapshot.site_contact || {}), ...contact.data } : snapshot.site_contact, delivery_contact: contact.data ? { ...(snapshot.delivery_contact || {}), ...contact.data } : snapshot.delivery_contact };
    next.items = (row.items || []).map((item: any) => {
      const current = item.item_id ? itemById.get(item.item_id) : null;
      return current ? { ...item, item_name_snapshot: current.item_name, item_code_snapshot: current.item_code, uom_snapshot: current.default_uom?.uom_code || item.uom_snapshot } : item;
    });
    return next;
  } catch (error) {
    if (strict) throw error;
    console.warn("Draft PO master refresh failed; using stored snapshot", { purchaseOrderId: row?.id, reason: error instanceof Error ? error.message : String(error) });
    try {
      const itemRows = await admin.from("procurement_purchase_order_items").select("id,item_id").eq("purchase_order_id", row.id);
      if (itemRows.error) throw itemRows.error;
      const linkedIds = (itemRows.data || []).map((item: any) => item.item_id).filter(Boolean);
      if (!linkedIds.length) return row;
      const currentItems = await admin.from("procurement_items").select("id,item_code,item_name,default_uom:procurement_uoms(uom_code)").in("id", linkedIds).eq("organization_id", row.organization_id).eq("status", "active");
      if (currentItems.error) throw currentItems.error;
      const byId = new Map<string, any>((currentItems.data || []).map((item: any) => [item.id, item]));
      const next = structuredClone(row);
      next.items = (row.items || []).map((item: any) => {
        const current = item.item_id ? byId.get(item.item_id) : null;
        return current ? { ...item, item_name_snapshot: current.item_name, item_code_snapshot: current.item_code, uom_snapshot: current.default_uom?.uom_code || item.uom_snapshot } : item;
      });
      return next;
    } catch (itemError) {
      console.warn("Draft PO Item Master refresh failed; using stored item snapshots", { purchaseOrderId: row?.id, reason: itemError instanceof Error ? itemError.message : String(itemError) });
      return row;
    }
  }
}

export async function resolveDraftPoMasterView(admin: any, row: any) {
  if (!(["draft", "sent_back"] as string[]).includes(String(row?.status || "").toLowerCase())) return row;
  return resolvePoMasterProjection(admin, row);
}
