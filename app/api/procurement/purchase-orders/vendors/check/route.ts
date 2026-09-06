import { NextResponse } from "next/server";
import { loadActorOrganizationScope, resolveWriteOrganizationId } from "@/lib/serverOrganizationScope";
import { adminClient, jsonError, requireProcurementPermission, text } from "@/lib/serverProcurementAccess";

const normalizeMobile = (value: unknown) => text(value).replace(/\D/g, "");
const vendorName = (row: any) => Array.isArray(row?.vendors) ? row.vendors[0]?.vendor_name : row?.vendors?.vendor_name;

export async function POST(request: Request) {
  try {
    const auth = await requireProcurementPermission(request, "vendors", "add");
    if ("response" in auth) return auth.response;
    const body = await request.json().catch(() => ({}));
    const admin = adminClient();
    const scope = await loadActorOrganizationScope(admin, auth);
    const organizationId = resolveWriteOrganizationId(scope, body.organization_id);
    if (!organizationId) return jsonError("You cannot check Vendors outside your organization.", 403);
    const gstin = text(body.gstin).toUpperCase();
    const mobile = normalizeMobile(body.mobile);
    const email = text(body.email).toLowerCase();
    const name = text(body.vendor_name);
    const [headerGstin, childGstin, mobileMatches, emailMatches, nameMatches] = await Promise.all([
      gstin ? admin.from("vendors").select("id,vendor_name").eq("organization_id", organizationId).ilike("gstin", gstin).eq("is_deleted", false).limit(1).maybeSingle() : Promise.resolve({ data: null, error: null }),
      gstin ? admin.from("vendor_gstins").select("vendor_id,vendors(vendor_name)").eq("organization_id", organizationId).ilike("gstin", gstin).limit(1).maybeSingle() : Promise.resolve({ data: null, error: null }),
      mobile ? admin.from("vendor_contacts").select("vendor_id,vendors(vendor_name)").eq("organization_id", organizationId).eq("contact_number", mobile).limit(20) : Promise.resolve({ data: [], error: null }),
      email ? admin.from("vendor_contacts").select("vendor_id,vendors(vendor_name)").eq("organization_id", organizationId).ilike("email", email).limit(20) : Promise.resolve({ data: [], error: null }),
      name ? admin.from("vendors").select("id,vendor_name").eq("organization_id", organizationId).ilike("vendor_name", name).eq("is_deleted", false).limit(20) : Promise.resolve({ data: [], error: null }),
    ]);
    for (const result of [headerGstin, childGstin, mobileMatches, emailMatches, nameMatches]) if (result.error) throw result.error;
    const gstinVendorId = headerGstin.data?.id || childGstin.data?.vendor_id || null;
    const gstinVendorName = headerGstin.data?.vendor_name || vendorName(childGstin.data) || null;
    const compact = (rows: any[]) => Array.from(new Map((rows || []).map((row) => { const id = row.vendor_id || row.id; return [id, { vendor_id: id, vendor_name: vendorName(row) || row.vendor_name }]; })).values());
    return NextResponse.json({ gstin_duplicate: gstinVendorId ? { vendor_id: gstinVendorId, vendor_name: gstinVendorName } : null, mobile_matches: compact(mobileMatches.data || []), email_matches: compact(emailMatches.data || []), name_matches: compact(nameMatches.data || []) });
  } catch (error: any) { return jsonError(error.message || "Failed to check Vendor duplicates.", 500); }
}
