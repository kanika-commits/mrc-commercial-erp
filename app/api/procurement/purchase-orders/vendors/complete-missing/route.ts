import { NextResponse } from "next/server";
import { adminClient, jsonError, requireProcurementPermission, text } from "@/lib/serverProcurementAccess";

const normalizePhone = (value: unknown) => text(value).replace(/\D/g, "");
const normalizeEmail = (value: unknown) => text(value).trim().toLowerCase();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const gstPattern = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const namesOnly = (rows: any[]) => rows.map((row) => ({ vendor_name: Array.isArray(row.vendors) ? row.vendors[0]?.vendor_name : row.vendors?.vendor_name })).filter((row) => row.vendor_name);

export async function POST(request: Request) {
  try {
    const auth = await requireProcurementPermission(request, "vendors", "edit");
    if ("response" in auth) return auth.response;
    const body = await request.json().catch(() => ({}));
    const vendorId = text(body.vendor_id);
    const admin = adminClient();
    const vendorResult = await admin.from("vendors").select("id,organization_id,vendor_name,address,contractor_type,pan,gstin,status,is_deleted").eq("id", vendorId).maybeSingle();
    if (vendorResult.error) throw vendorResult.error;
    const vendor = vendorResult.data;
    if (!vendor || vendor.is_deleted || vendor.status !== "active") return jsonError("Vendor was not found or is inactive.", 404);
    if (!auth.isGlobalAccess && !(auth.roleCodes || []).includes("platform_owner") && !(auth.organizations || []).includes(vendor.organization_id)) return jsonError("Vendor is outside your organization access.", 403);
    const fields = { address: text(body.address), gstin: text(body.gstin).trim().toUpperCase(), phone: normalizePhone(body.phone), email: normalizeEmail(body.email), contact_name: text(body.contact_name) };
    if (fields.phone && !/^[6-9][0-9]{9}$/.test(fields.phone)) return jsonError("Enter a valid 10 digit phone number.", 400);
    if (fields.email && !emailPattern.test(fields.email)) return jsonError("Enter a valid email address.", 400);
    if (fields.gstin && (!gstPattern.test(fields.gstin) || (vendor.pan && fields.gstin.substring(2, 12) !== String(vendor.pan).trim().toUpperCase()))) return jsonError("Invalid GSTIN or GSTIN PAN mismatch.", 400);
    if (fields.address && fields.address.length > 500) return jsonError("Address is too long.", 400);
    const existingContacts = await admin.from("vendor_contacts").select("contact_name,contact_number,email,is_primary").eq("organization_id", vendor.organization_id).eq("vendor_id", vendor.id).order("is_primary", { ascending: false });
    if (existingContacts.error) throw existingContacts.error;
    const contacts = existingContacts.data || [];
    const target = contacts.length === 1 || contacts.some((row: any) => row.is_primary) ? contacts.find((row: any) => row.is_primary) || contacts[0] : null;
    const warnings: any = {};
    if (fields.phone && (!target || !text(target.contact_number))) { const result = await admin.from("vendor_contacts").select("vendors(vendor_name)").eq("organization_id", vendor.organization_id).eq("contact_number", fields.phone).neq("vendor_id", vendor.id).limit(20); if (result.error) throw result.error; warnings.mobile_matches = namesOnly(result.data || []); }
    if (fields.email && (!target || !text(target.email))) { const result = await admin.from("vendor_contacts").select("vendors(vendor_name)").ilike("email", fields.email).eq("organization_id", vendor.organization_id).neq("vendor_id", vendor.id).limit(20); if (result.error) throw result.error; warnings.email_matches = namesOnly(result.data || []); }
    const rpc = await admin.rpc("complete_procurement_vendor_missing_fields_atomic", { p_organization_id: vendor.organization_id, p_vendor_id: vendor.id, p_fields: fields });
    if (rpc.error) return jsonError(rpc.error.message, rpc.error.code === "23505" ? 409 : 400);
    const refreshed = await admin.from("vendors").select("vendor_name,address,contractor_type,pan,gstin,status,profile_status").eq("id", vendor.id).single();
    if (refreshed.error) throw refreshed.error;
    const contactsAfter = await admin.from("vendor_contacts").select("contact_name,contact_number,email,designation,is_primary").eq("vendor_id", vendor.id).order("is_primary", { ascending: false });
    if (contactsAfter.error) throw contactsAfter.error;
    return NextResponse.json({ vendor: { ...refreshed.data, contact: (contactsAfter.data || [])[0] || null }, warnings });
  } catch (error: any) { return jsonError(error.message || "Failed to complete missing Vendor details.", 500); }
}
