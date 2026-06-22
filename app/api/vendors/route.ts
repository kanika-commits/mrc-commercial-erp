import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { optimizeUploadFile } from "@/lib/fileOptimization";

const ORGANIZATION_ID = "3b65abde-9f9f-4f1b-bd40-fa261a76920b";
const DOCUMENT_BUCKET = "Vendor-Documents";

type VendorPayload = {
  vendor_name: string;
  vendor_type: string;
  contractor_type: string;
  status: string;
  pan: string;
  aadhaar_cin: string;
  gstin?: string;
  pan_aadhaar_link_status: string;
  msme_registered: string;
  msme_number?: string;
  msme_category?: string;
};

type ContactPayload = {
  contact_name: string;
  contact_number: string;
  email?: string;
  designation?: string;
  is_primary: boolean;
};

type BankPayload = {
  account_holder_name: string;
  account_number: string;
  ifsc_code: string;
  bank_name: string;
  branch_name?: string;
  is_primary?: boolean;
};

function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

async function assertPermission(request: Request, actionCode: "view" | "add" | "edit") {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const token = request.headers.get("authorization")?.replace("Bearer ", "");

  if (!token) {
    return { error: "Missing auth token.", status: 401 };
  }

  const authClient = createClient(supabaseUrl, anonKey);
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const {
    data: { user },
    error: userError,
  } = await authClient.auth.getUser(token);

  if (userError) throw userError;

  if (!user) {
    return { error: "User not found.", status: 401 };
  }

  const { data: userRoles, error: userRolesError } = await admin
    .from("user_roles")
    .select("role_id")
    .eq("user_id", user.id);

  if (userRolesError) throw userRolesError;

  const roleIds = (userRoles || []).map((row) => row.role_id).filter(Boolean);

  if (roleIds.length === 0) {
    return { error: "You do not have permission to save vendors.", status: 403 };
  }

  const { data: roles, error: rolesError } = await admin
    .from("roles")
    .select("id, role_code")
    .in("id", roleIds);

  if (rolesError) throw rolesError;

  const roleCodes = (roles || []).map((role) => role.role_code).filter(Boolean);

  if (roleCodes.includes("platform_owner") || roleCodes.includes("super_admin")) {
    return { user };
  }

  const [{ data: rolePermissions, error: rolePermissionError }, { data: userPermissions, error: userPermissionError }] =
    await Promise.all([
      admin
        .from("role_permissions")
        .select("module_code, action_code, allowed")
        .in("role_id", roleIds),
      admin
        .from("user_permissions")
        .select("module_code, action_code, allowed")
        .eq("user_id", user.id),
    ]);

  if (rolePermissionError) throw rolePermissionError;
  if (userPermissionError) throw userPermissionError;

  const permissionMap = new Map<string, boolean>();

  [...(rolePermissions || []), ...(userPermissions || [])].forEach((permission) => {
    permissionMap.set(
      `${permission.module_code}:${permission.action_code}`,
      permission.allowed === true
    );
  });

  const allowed =
    permissionMap.get("*:*") === true ||
    permissionMap.get(`vendors:${actionCode}`) === true;

  if (!allowed) {
    return { error: "You do not have permission to save vendors.", status: 403 };
  }

  return { user };
}

function parseJson<T>(formData: FormData, key: string, fallback: T): T {
  const value = formData.get(key);

  if (typeof value !== "string" || !value) {
    return fallback;
  }

  return JSON.parse(value) as T;
}

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9.]/g, "_");
}

async function uploadDocument(
  supabase: ReturnType<typeof adminClient>,
  vendorId: string,
  documentType: string,
  file: File
) {
  const path = `${ORGANIZATION_ID}/${vendorId}/${documentType}_${Date.now()}_${safeFileName(
    file.name
  )}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  const optimizedFile = await optimizeUploadFile(
    bytes,
    file.type || "application/octet-stream",
    file.name,
  );

  const { error: uploadError } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .upload(path, optimizedFile.buffer, {
      contentType: optimizedFile.mimeType || "application/octet-stream",
      upsert: false,
    });

  if (uploadError) throw uploadError;

  return {
    organization_id: ORGANIZATION_ID,
    vendor_id: vendorId,
    document_type: documentType,
    file_name: file.name,
    file_url: path,
  };
}

export async function GET(request: Request) {
  try {
    const access = await assertPermission(request, "view");

    if ("error" in access) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const supabase = adminClient();
    const { searchParams } = new URL(request.url);
    const includeChildren = searchParams.get("include_children");
    const search = String(searchParams.get("search") || "").trim();
    const page = Math.max(1, Number(searchParams.get("page") || 1) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number(searchParams.get("page_size") || 50) || 50)
    );
    const typeFilter = String(searchParams.get("type_filter") || "").trim();

    if (includeChildren === "summary") {
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      const normalizedType = typeFilter.toLowerCase();
      let matchedVendorIds: string[] | null = null;

      if (search) {
        const pattern = `%${search.replace(/[%_]/g, "\\$&")}%`;
        const [vendorMatches, contactMatches] = await Promise.all([
          supabase
            .from("vendors")
            .select("id")
            .neq("status", "deleted")
            .or(
              [
                `vendor_name.ilike.${pattern}`,
                `pan.ilike.${pattern}`,
                `gstin.ilike.${pattern}`,
                `aadhaar_cin.ilike.${pattern}`,
              ].join(",")
            ),
          supabase
            .from("vendor_contacts")
            .select("vendor_id")
            .or(
              [
                `contact_name.ilike.${pattern}`,
                `contact_number.ilike.${pattern}`,
                `email.ilike.${pattern}`,
              ].join(",")
            ),
        ]);

        if (vendorMatches.error) throw vendorMatches.error;
        if (contactMatches.error) throw contactMatches.error;

        matchedVendorIds = Array.from(
          new Set(
            [
              ...(vendorMatches.data || []).map((vendor) => vendor.id),
              ...(contactMatches.data || []).map((contact) => contact.vendor_id),
            ].filter(Boolean)
          )
        );
      }

      let vendorQuery = supabase
        .from("vendors")
        .select(
          "id, vendor_name, vendor_type, gstin, pan, aadhaar_cin, created_at",
          { count: "exact" }
        )
        .neq("status", "deleted")
        .order("created_at", { ascending: false });

      if (normalizedType && normalizedType !== "all") {
        vendorQuery = vendorQuery.ilike("vendor_type", normalizedType);
      }

      if (matchedVendorIds) {
        if (matchedVendorIds.length === 0) {
          const { data: vendorTypeRows, error: vendorTypeError, count: totalAll } = await supabase
            .from("vendors")
            .select("vendor_type", { count: "exact" })
            .neq("status", "deleted");

          if (vendorTypeError) throw vendorTypeError;

          return NextResponse.json({
            vendors: [],
            total: 0,
            total_all: totalAll || 0,
            page,
            page_size: pageSize,
            vendor_types: Array.from(
              new Set((vendorTypeRows || []).map((row) => row.vendor_type).filter(Boolean))
            ).sort(),
          });
        }

        vendorQuery = vendorQuery.in("id", matchedVendorIds);
      }

      const vendorsResult = await vendorQuery.range(from, to);

      if (vendorsResult.error) throw vendorsResult.error;

      const vendors = vendorsResult.data || [];
      const vendorIds = vendors.map((vendor) => vendor.id).filter(Boolean);

      const [contactsResult, vendorTypeRows] = await Promise.all([
        vendorIds.length
          ? supabase
              .from("vendor_contacts")
              .select("id, vendor_id, contact_name, contact_number, email, designation, is_primary")
              .in("vendor_id", vendorIds)
              .order("is_primary", { ascending: false })
          : Promise.resolve({ data: [], error: null }),
        supabase
          .from("vendors")
          .select("vendor_type", { count: "exact" })
          .neq("status", "deleted"),
      ]);

      if (contactsResult.error) throw contactsResult.error;
      if (vendorTypeRows.error) throw vendorTypeRows.error;

      const contactsByVendor = new Map<string, any[]>();
      (contactsResult.data || []).forEach((contact) => {
        if (!contact.vendor_id) return;
        const rows = contactsByVendor.get(contact.vendor_id) || [];
        rows.push(contact);
        contactsByVendor.set(contact.vendor_id, rows);
      });

      return NextResponse.json({
        vendors: vendors.map((vendor) => ({
          ...vendor,
          contacts: contactsByVendor.get(vendor.id) || [],
          bank_accounts: [],
        })),
        total: vendorsResult.count || 0,
        total_all: vendorTypeRows.count || 0,
        page,
        page_size: pageSize,
        vendor_types: Array.from(
          new Set((vendorTypeRows.data || []).map((row) => row.vendor_type).filter(Boolean))
        ).sort(),
      });
    }

    const [vendorsResult, contactsResult, bankAccountsResult] = await Promise.all([
      supabase
        .from("vendors")
        .select(
          "id, vendor_name, vendor_type, gstin, pan, aadhaar_cin, created_at"
        )
        .neq("status", "deleted")
        .order("created_at", { ascending: false }),
      supabase
        .from("vendor_contacts")
        .select("id, vendor_id, contact_name, contact_number, email, designation, is_primary")
        .order("is_primary", { ascending: false }),
      supabase
        .from("vendor_bank_accounts")
        .select("id, vendor_id, account_number, ifsc_code, bank_name, branch_name, is_primary")
        .order("is_primary", { ascending: false }),
    ]);

    for (const result of [vendorsResult, contactsResult, bankAccountsResult]) {
      if (result.error) throw result.error;
    }

    const contactsByVendor = new Map<string, any[]>();
    (contactsResult.data || []).forEach((contact) => {
      if (!contact.vendor_id) return;
      contactsByVendor.set(contact.vendor_id, [
        ...(contactsByVendor.get(contact.vendor_id) || []),
        contact,
      ]);
    });

    const bankAccountsByVendor = new Map<string, any[]>();
    (bankAccountsResult.data || []).forEach((account) => {
      if (!account.vendor_id) return;
      bankAccountsByVendor.set(account.vendor_id, [
        ...(bankAccountsByVendor.get(account.vendor_id) || []),
        account,
      ]);
    });

    const vendors = (vendorsResult.data || []).map((vendor) => ({
      ...vendor,
      contacts: contactsByVendor.get(vendor.id) || [],
      bank_accounts: bankAccountsByVendor.get(vendor.id) || [],
    }));

    return NextResponse.json({ vendors });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load vendors." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const access = await assertPermission(request, "add");

    if ("error" in access) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const supabase = adminClient();
    const formData = await request.formData();
    const vendor = parseJson<VendorPayload>(formData, "vendor", {} as VendorPayload);
    const contacts = parseJson<ContactPayload[]>(formData, "contacts", []);
    const bankAccounts = parseJson<BankPayload[]>(formData, "bank_accounts", []);
    const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
    const aadhaarRegex = /^[2-9][0-9]{11}$/;
    const cinRegex = /^[A-Z][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/;
    const gstRegex =
      /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
    const mobileRegex = /^[6-9][0-9]{9}$/;
    const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
    const hasDocument = (documentType: string) => {
      const file = formData.get(`document:${documentType}`);
      return file instanceof File && file.size > 0;
    };

    if (!vendor.vendor_name?.trim()) {
      return NextResponse.json({ error: "Vendor Name is required." }, { status: 400 });
    }

    if (!vendor.pan?.trim()) {
      return NextResponse.json({ error: "PAN is required." }, { status: 400 });
    }

    if (!panRegex.test(vendor.pan)) {
      return NextResponse.json({ error: "Invalid PAN format." }, { status: 400 });
    }

    if (!vendor.aadhaar_cin?.trim()) {
      return NextResponse.json(
        { error: "Aadhaar / CIN is required." },
        { status: 400 }
      );
    }

    if (
      vendor.contractor_type === "Proprietor" &&
      !aadhaarRegex.test(vendor.aadhaar_cin)
    ) {
      return NextResponse.json(
        { error: "Invalid Aadhaar format." },
        { status: 400 }
      );
    }

    if (
      vendor.contractor_type === "Company" &&
      !cinRegex.test(vendor.aadhaar_cin)
    ) {
      return NextResponse.json({ error: "Invalid CIN format." }, { status: 400 });
    }

    if (!vendor.pan_aadhaar_link_status?.trim()) {
      return NextResponse.json(
        { error: "PAN-Aadhaar link status is required." },
        { status: 400 }
      );
    }

    if (vendor.gstin) {
      if (!gstRegex.test(vendor.gstin)) {
        return NextResponse.json(
          { error: "Invalid GSTIN format." },
          { status: 400 }
        );
      }

      if (vendor.gstin.substring(2, 12) !== vendor.pan) {
        return NextResponse.json(
          { error: "GSTIN PAN does not match entered PAN." },
          { status: 400 }
        );
      }
    }

    const firstContact = contacts[0];

    if (!firstContact?.contact_name?.trim()) {
      return NextResponse.json(
        { error: "Primary contact name is required." },
        { status: 400 }
      );
    }

    if (!firstContact?.contact_number?.trim()) {
      return NextResponse.json(
        { error: "Primary contact number is required." },
        { status: 400 }
      );
    }

    if (!mobileRegex.test(firstContact.contact_number)) {
      return NextResponse.json(
        { error: "Primary contact number is invalid." },
        { status: 400 }
      );
    }

    const firstBank = bankAccounts[0];

    if (!firstBank?.account_holder_name?.trim()) {
      return NextResponse.json(
        { error: "Bank account holder name is required." },
        { status: 400 }
      );
    }

    if (!firstBank?.bank_name?.trim()) {
      return NextResponse.json({ error: "Bank name is required." }, { status: 400 });
    }

    if (!firstBank?.account_number?.trim()) {
      return NextResponse.json(
        { error: "Bank account number is required." },
        { status: 400 }
      );
    }

    if (!firstBank?.ifsc_code?.trim()) {
      return NextResponse.json({ error: "IFSC is required." }, { status: 400 });
    }

    if (!ifscRegex.test(firstBank.ifsc_code)) {
      return NextResponse.json(
        { error: "Invalid IFSC format." },
        { status: 400 }
      );
    }

    if (!hasDocument("PAN")) {
      return NextResponse.json({ error: "PAN copy is required." }, { status: 400 });
    }

    if (!hasDocument("AADHAAR_CIN")) {
      return NextResponse.json(
        { error: "Aadhaar / CIN copy is required." },
        { status: 400 }
      );
    }

    if (!hasDocument("BANK_PROOF")) {
      return NextResponse.json(
        { error: "Cancelled cheque / bank proof is required." },
        { status: 400 }
      );
    }

    if (vendor.gstin && !hasDocument("GST_CERTIFICATE")) {
      return NextResponse.json(
        { error: "GST certificate is required when GSTIN is entered." },
        { status: 400 }
      );
    }

    if (
      vendor.pan_aadhaar_link_status === "Yes" &&
      !hasDocument("PAN_AADHAAR_ATTACHMENT")
    ) {
      return NextResponse.json(
        { error: "PAN-Aadhaar Link Proof is required." },
        { status: 400 }
      );
    }

    if (vendor.msme_registered === "Yes") {
      if (!vendor.msme_number?.trim()) {
        return NextResponse.json(
          { error: "MSME number is required." },
          { status: 400 }
        );
      }

      if (!hasDocument("MSME_CERTIFICATE")) {
        return NextResponse.json(
          { error: "MSME certificate is required." },
          { status: 400 }
        );
      }
    }

    const duplicateConditions = [
      `pan.eq.${vendor.pan}`,
      `aadhaar_cin.eq.${vendor.aadhaar_cin}`,
    ];

    if (vendor.gstin) {
      duplicateConditions.push(`gstin.eq.${vendor.gstin}`);
    }

    const { data: duplicateVendor, error: duplicateError } = await supabase
      .from("vendors")
      .select("id, vendor_name")
      .eq("organization_id", ORGANIZATION_ID)
      .or(duplicateConditions.join(","))
      .limit(1)
      .maybeSingle();

    if (duplicateError) throw duplicateError;

    if (duplicateVendor) {
      return NextResponse.json(
        {
          error: `Vendor already exists with same PAN / Aadhaar-CIN / GSTIN: ${duplicateVendor.vendor_name}`,
          duplicate_vendor_id: duplicateVendor.id,
          duplicate_vendor_name: duplicateVendor.vendor_name,
        },
        { status: 409 }
      );
    }

    const { data: createdVendor, error: vendorError } = await supabase
      .from("vendors")
      .insert({
        organization_id: ORGANIZATION_ID,
        vendor_name: vendor.vendor_name.trim(),
        vendor_type: vendor.vendor_type,
        contractor_type: vendor.contractor_type,
        status: vendor.status,
        pan: vendor.pan,
        aadhaar_cin: vendor.aadhaar_cin,
        gstin: vendor.gstin || null,
        pan_aadhaar_link_status: vendor.pan_aadhaar_link_status,
        msme_registered: vendor.msme_registered === "Yes",
        msme_number:
          vendor.msme_registered === "Yes" ? vendor.msme_number?.trim() || null : null,
        msme_category:
          vendor.msme_registered === "Yes" ? vendor.msme_category || null : null,
      })
      .select("id")
      .single();

    if (vendorError) throw vendorError;

    const vendorId = createdVendor.id;

    if (contacts.length > 0) {
      const { error: contactError } = await supabase
        .from("vendor_contacts")
        .insert(
          contacts.map((contact) => ({
            organization_id: ORGANIZATION_ID,
            vendor_id: vendorId,
            contact_name: contact.contact_name.trim(),
            contact_number: contact.contact_number.trim(),
            email: contact.email?.trim() || null,
            designation: contact.designation?.trim() || null,
            is_primary: contact.is_primary === true,
          }))
        );

      if (contactError) throw contactError;
    }

    if (bankAccounts.length > 0) {
      const { error: bankError } = await supabase
        .from("vendor_bank_accounts")
        .insert(
          bankAccounts.map((bank, index) => ({
            organization_id: ORGANIZATION_ID,
            vendor_id: vendorId,
            account_holder_name: bank.account_holder_name.trim(),
            account_number: bank.account_number.trim(),
            ifsc_code: bank.ifsc_code.trim(),
            bank_name: bank.bank_name.trim(),
            branch_name: bank.branch_name?.trim() || null,
            is_primary: bank.is_primary === true || index === 0,
          }))
        );

      if (bankError) throw bankError;
    }

    if (vendor.gstin) {
      const { error: gstinError } = await supabase.from("vendor_gstins").insert({
        organization_id: ORGANIZATION_ID,
        vendor_id: vendorId,
        gstin: vendor.gstin,
        state_code: vendor.gstin.slice(0, 2),
        state_name: null,
        is_primary: true,
      });

      if (gstinError) throw gstinError;
    }

    const documentRows = [];

    for (const [key, value] of formData.entries()) {
      if (key.startsWith("document:") && value instanceof File && value.size > 0) {
        documentRows.push(
          await uploadDocument(supabase, vendorId, key.replace("document:", ""), value)
        );
      }
    }

    if (documentRows.length > 0) {
      const { error: documentError } = await supabase
        .from("vendor_documents")
        .insert(documentRows);

      if (documentError) throw documentError;
    }

    return NextResponse.json({ vendor_id: vendorId });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to save vendor." },
      { status: 500 }
    );
  }
}
