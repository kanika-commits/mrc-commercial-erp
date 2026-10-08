import { text } from "@/lib/serverProcurementAccess";

export async function loadAuthorizedPurchaseOrderVendorSnapshot(admin: any, organizationId: string, vendorId: string) {
  const vendorResult = await admin
    .from("vendors")
    .select("id,organization_id,vendor_name,address,pan,gstin,status,is_deleted")
    .eq("id", vendorId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (vendorResult.error) throw vendorResult.error;
  if (!vendorResult.data || vendorResult.data.status === "deleted" || vendorResult.data.is_deleted) {
    return { error: "Vendor is invalid for the selected organization." } as const;
  }

  const [contactResult, gstinResult] = await Promise.all([
    admin.from("vendor_contacts").select("contact_name,contact_number,email,designation").eq("vendor_id", vendorId).order("is_primary", { ascending: false }).limit(1).maybeSingle(),
    admin.from("vendor_gstins").select("gstin").eq("vendor_id", vendorId).eq("is_primary", true).maybeSingle(),
  ]);
  if (contactResult.error) throw contactResult.error;
  if (gstinResult.error) throw gstinResult.error;

  return {
    vendor: vendorResult.data,
    snapshot: {
      vendor_name: vendorResult.data.vendor_name,
      address: vendorResult.data.address || null,
      gstin: gstinResult.data?.gstin || vendorResult.data.gstin || null,
      pan: vendorResult.data.pan || null,
      contact_person: contactResult.data?.contact_name || null,
      phone: contactResult.data?.contact_number || null,
      email: contactResult.data?.email || null,
      designation: contactResult.data?.designation || null,
    },
  } as const;
}

export function purchaseOrderVendorSnapshotUpdate(vendorId: string, snapshot: any) {
  return {
    vendor_id: vendorId,
    vendor_name_snapshot: text(snapshot?.vendor_name) || null,
    vendor_snapshot: snapshot || {},
  };
}
