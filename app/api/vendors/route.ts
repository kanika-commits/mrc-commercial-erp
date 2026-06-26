import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createDriveSubfolder, uploadDriveFile } from "@/src/lib/googleDrive";
import {
  applyOrganizationScope,
  loadOrganizationScopeForUser,
  resolveWriteOrganizationId,
} from "@/lib/serverOrganizationScope";

const ORGANIZATION_ID = "3b65abde-9f9f-4f1b-bd40-fa261a76920b";
const VENDOR_MASTER_DRIVE_ROOT_FOLDER_ID =
  process.env.GOOGLE_DRIVE_VENDOR_MASTER_FOLDER_ID ||
  "1_3FCygGl8wOMS8IBEInhIkEFt-C93I-5";
const VENDOR_AUDIT_FIELDS = [
  "organization_id",
  "vendor_name",
  "contractor_type",
  "status",
  "pan",
  "aadhaar_cin",
  "gstin",
  "pan_aadhaar_link_status",
  "msme_registered",
  "msme_number",
  "msme_category",
  "is_deleted",
] as const;

type VendorPayload = {
  vendor_name: string;
  contractor_type: string;
  status: string;
  pan: string;
  aadhaar_cin: string;
  aadhaar_number?: string;
  cin_number?: string;
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

  if (roleCodes.includes("platform_owner")) {
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

function isProprietorship(value: string | undefined) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "proprietor" || normalized === "proprietorship";
}

function isIndividual(value: string | undefined) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "individual";
}

function isPartnershipOrLlp(value: string | undefined) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "partnership" || normalized === "llp";
}

function allowsAadhaar(value: string | undefined) {
  return isIndividual(value) || isProprietorship(value) || isPartnershipOrLlp(value);
}

function requiresAadhaar(value: string | undefined) {
  return isIndividual(value) || isProprietorship(value);
}

function isCinContractorType(value: string | undefined) {
  const normalized = String(value || "").trim().toLowerCase();
  return [
    "company",
    "private limited",
    "private limited company",
    "pvt ltd",
    "pvt. ltd.",
    "public limited",
    "public limited company",
    "limited",
  ].includes(normalized);
}

function requiresGstin(value: string | undefined) {
  return isProprietorship(value) || isCinContractorType(value);
}

function requiresPanAadhaarProof(value: string | undefined) {
  return isIndividual(value) || isProprietorship(value);
}

function normalizeVendorIdentity(vendor: VendorPayload) {
  const aadhaarNumber = String(
    vendor.aadhaar_number ||
      (!isCinContractorType(vendor.contractor_type) ? vendor.aadhaar_cin : "") ||
      ""
  ).trim();
  const cinNumber = String(
    vendor.cin_number ||
      (isCinContractorType(vendor.contractor_type) ? vendor.aadhaar_cin : "") ||
      ""
  )
    .trim()
    .toUpperCase();

  return {
    aadhaarNumber,
    cinNumber,
    identityValue: isCinContractorType(vendor.contractor_type)
      ? cinNumber
      : aadhaarNumber,
  };
}

function vendorDriveFolderName(vendorName: string, vendorId: string) {
  return `${vendorName.trim()} - ${vendorId.slice(0, 8)}`;
}

function vendorSnapshot(row: any) {
  return Object.fromEntries(
    VENDOR_AUDIT_FIELDS.map((field) => [field, row?.[field] ?? null])
  );
}

function actorName(user: any) {
  return (
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email ||
    null
  );
}

async function insertVendorAuditLog(
  supabase: ReturnType<typeof adminClient>,
  params: {
    vendorId: string;
    organizationId: string | null;
    action: "created" | "updated" | "restored";
    user: any;
    changedFields: string[];
    oldValues?: Record<string, any> | null;
    newValues?: Record<string, any> | null;
    restoreSnapshot?: Record<string, any> | null;
    note?: string | null;
  }
) {
  const { error } = await supabase.from("vendor_audit_logs").insert({
    vendor_id: params.vendorId,
    organization_id: params.organizationId,
    action: params.action,
    changed_by_user_id: params.user?.id || null,
    changed_by_email: params.user?.email || null,
    changed_by_name: actorName(params.user),
    changed_fields: params.changedFields,
    old_values: params.oldValues || null,
    new_values: params.newValues || null,
    restore_snapshot: params.restoreSnapshot || null,
    note: params.note || null,
  });

  if (error) throw error;
}

async function findDuplicateVendor(
  supabase: ReturnType<typeof adminClient>,
  vendor: VendorPayload,
  organizationId: string
) {
  const checks = [
    { field: "pan", label: "PAN", value: vendor.pan },
    { field: "aadhaar_cin", label: "Aadhaar/CIN", value: vendor.aadhaar_cin },
    { field: "gstin", label: "GSTIN", value: vendor.gstin },
  ].filter((check) => String(check.value || "").trim());

  for (const check of checks) {
    const { data, error } = await supabase
      .from("vendors")
      .select("id, vendor_name")
      .eq("organization_id", organizationId)
      .neq("status", "deleted")
      .eq(check.field, String(check.value).trim())
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    if (data) {
      return {
        ...data,
        duplicate_field: check.label,
      };
    }
  }

  return null;
}

async function ensureVendorDriveFolder(
  supabase: ReturnType<typeof adminClient>,
  vendorId: string,
  vendorName: string,
  existingFolderId?: string | null,
  existingFolderName?: string | null
) {
  if (existingFolderId) {
    return {
      folderId: existingFolderId,
      folderName: existingFolderName || vendorDriveFolderName(vendorName, vendorId),
    };
  }

  const folderName = vendorDriveFolderName(vendorName, vendorId);
  const folder = await createDriveSubfolder({
    parentFolderId: VENDOR_MASTER_DRIVE_ROOT_FOLDER_ID,
    folderName,
  });

  if (!folder.folder_id) {
    throw new Error("Google Drive Vendor folder was not created.");
  }

  const { error } = await supabase
    .from("vendors")
    .update({
      vendor_drive_folder_id: folder.folder_id,
      vendor_drive_folder_name: folder.folder_name || folderName,
    })
    .eq("id", vendorId);

  if (error) throw error;

  return {
    folderId: folder.folder_id,
    folderName: folder.folder_name || folderName,
  };
}

async function uploadDocument(
  organizationId: string,
  vendorId: string,
  driveFolderId: string,
  documentType: string,
  file: File
) {
  const { optimizeUploadFile } = await import("@/lib/fileOptimization");
  const bytes = Buffer.from(await file.arrayBuffer());
  const optimizedFile = await optimizeUploadFile(
    bytes,
    file.type || "application/octet-stream",
    file.name,
  );

  const driveFile = await uploadDriveFile({
    targetFolderId: driveFolderId,
    fileName: `${documentType}_${Date.now()}_${safeFileName(file.name)}`,
    mimeType: optimizedFile.mimeType || "application/octet-stream",
    base64: optimizedFile.buffer.toString("base64"),
  });

  return {
    organization_id: organizationId,
    vendor_id: vendorId,
    document_type: documentType,
    file_name: file.name,
    file_url: driveFile.file_url,
  };
}

export async function GET(request: Request) {
  try {
    const access = await assertPermission(request, "view");

    if ("error" in access) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const supabase = adminClient();
    const organizationScope = await loadOrganizationScopeForUser(supabase, access.user.id);
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
        const vendorSearchQuery = applyOrganizationScope(
          supabase
            .from("vendors")
            .select("id")
            .neq("status", "deleted")
            .or(
              [
                `vendor_name.ilike.${pattern}`,
                `contractor_type.ilike.${pattern}`,
                `pan.ilike.${pattern}`,
                `gstin.ilike.${pattern}`,
                `aadhaar_cin.ilike.${pattern}`,
              ].join(",")
            ),
          organizationScope,
        );
        const [vendorMatches, contactMatches] = await Promise.all([
          vendorSearchQuery || Promise.resolve({ data: [], error: null }),
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
              ...(vendorMatches.data || []).map((vendor: any) => vendor.id),
              ...(contactMatches.data || []).map((contact: any) => contact.vendor_id),
            ].filter(Boolean)
          )
        );
      }

      let vendorQuery = applyOrganizationScope(
        supabase
          .from("vendors")
          .select(
            "id, organization_id, vendor_name, contractor_type, gstin, pan, aadhaar_cin, created_at",
            { count: "exact" }
          )
          .neq("status", "deleted"),
        organizationScope,
      );

      if (!vendorQuery) {
        return NextResponse.json({
          vendors: [],
          total: 0,
          total_all: 0,
          page,
          page_size: pageSize,
          contractor_types: [],
        });
      }

      vendorQuery = vendorQuery.order("created_at", { ascending: false });

      if (normalizedType && normalizedType !== "all") {
        vendorQuery = vendorQuery.ilike("contractor_type", normalizedType);
      }

      if (matchedVendorIds) {
        if (matchedVendorIds.length === 0) {
          const contractorTypeQuery = applyOrganizationScope(
            supabase
              .from("vendors")
              .select("contractor_type", { count: "exact" })
              .neq("status", "deleted"),
            organizationScope,
          );
          const { data: contractorTypeRows, error: contractorTypeError, count: totalAll } =
            contractorTypeQuery
              ? await contractorTypeQuery
              : { data: [], error: null, count: 0 };

          if (contractorTypeError) throw contractorTypeError;

          return NextResponse.json({
            vendors: [],
            total: 0,
            total_all: totalAll || 0,
            page,
            page_size: pageSize,
            contractor_types: Array.from(
              new Set((contractorTypeRows || []).map((row: any) => row.contractor_type).filter(Boolean))
            ).sort(),
          });
        }

        vendorQuery = vendorQuery.in("id", matchedVendorIds);
      }

      const vendorsResult = await vendorQuery.range(from, to);

      if (vendorsResult.error) throw vendorsResult.error;

      const vendors = vendorsResult.data || [];
      const vendorIds = vendors.map((vendor: any) => vendor.id).filter(Boolean);

      const contactsPromise = vendorIds.length
        ? supabase
            .from("vendor_contacts")
            .select("id, vendor_id, contact_name, contact_number, email, designation, is_primary")
            .in("vendor_id", vendorIds)
            .order("is_primary", { ascending: false })
        : Promise.resolve({ data: [], error: null });
      const contractorTypesQuery = applyOrganizationScope(
        supabase
          .from("vendors")
          .select("contractor_type", { count: "exact" })
          .neq("status", "deleted"),
        organizationScope,
      );
      const contractorTypesPromise =
        contractorTypesQuery || Promise.resolve({ data: [], error: null, count: 0 });

      const [contactsResult, contractorTypeRows] = await Promise.all([
        contactsPromise,
        contractorTypesPromise,
      ]);

      if (contactsResult.error) throw contactsResult.error;
      if (contractorTypeRows.error) throw contractorTypeRows.error;

      const contactsByVendor = new Map<string, any[]>();
      (contactsResult.data || []).forEach((contact: any) => {
        if (!contact.vendor_id) return;
        const rows = contactsByVendor.get(contact.vendor_id) || [];
        rows.push(contact);
        contactsByVendor.set(contact.vendor_id, rows);
      });

      const responseBody = {
        vendors: vendors.map((vendor: any) => ({
          ...vendor,
          contacts: contactsByVendor.get(vendor.id) || [],
          bank_accounts: [],
        })),
        total: vendorsResult.count || 0,
        total_all: contractorTypeRows.count || 0,
        page,
        page_size: pageSize,
        contractor_types: Array.from(
          new Set((contractorTypeRows.data || []).map((row: any) => row.contractor_type).filter(Boolean))
        ).sort(),
      };
      return NextResponse.json(responseBody);
    }

    const vendorsQuery = applyOrganizationScope(
      supabase
        .from("vendors")
        .select(
          "id, organization_id, vendor_name, contractor_type, gstin, pan, aadhaar_cin, created_at"
        )
        .neq("status", "deleted"),
      organizationScope,
    );

    if (!vendorsQuery) {
      return NextResponse.json({ vendors: [] });
    }

    const [vendorsResult, contactsResult, bankAccountsResult] = await Promise.all([
      vendorsQuery.order("created_at", { ascending: false }),
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
    (contactsResult.data || []).forEach((contact: any) => {
      if (!contact.vendor_id) return;
      contactsByVendor.set(contact.vendor_id, [
        ...(contactsByVendor.get(contact.vendor_id) || []),
        contact,
      ]);
    });

    const bankAccountsByVendor = new Map<string, any[]>();
    (bankAccountsResult.data || []).forEach((account: any) => {
      if (!account.vendor_id) return;
      bankAccountsByVendor.set(account.vendor_id, [
        ...(bankAccountsByVendor.get(account.vendor_id) || []),
        account,
      ]);
    });

    const vendors = (vendorsResult.data || []).map((vendor: any) => ({
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
    const organizationScope = await loadOrganizationScopeForUser(supabase, access.user.id);
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
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
    const normalizedIdentity = normalizeVendorIdentity(vendor);
    const normalizedGstin = isIndividual(vendor.contractor_type)
      ? ""
      : String(vendor.gstin || "").trim().toUpperCase();
    const normalizedVendor = {
      ...vendor,
      pan: String(vendor.pan || "").trim().toUpperCase(),
      aadhaar_cin: normalizedIdentity.identityValue,
      gstin: normalizedGstin,
      pan_aadhaar_link_status: requiresPanAadhaarProof(vendor.contractor_type)
        ? "Yes"
        : "",
    };
    const hasDocument = (documentType: string) => {
      const file = formData.get(`document:${documentType}`);
      return file instanceof File && file.size > 0;
    };

    if (!vendor.vendor_name?.trim()) {
      return NextResponse.json({ error: "Vendor Name is required." }, { status: 400 });
    }

    if (!vendor.contractor_type?.trim()) {
      return NextResponse.json({ error: "Contractor Type is required." }, { status: 400 });
    }

    if (!normalizedVendor.pan) {
      return NextResponse.json({ error: "PAN is required." }, { status: 400 });
    }

    if (!panRegex.test(normalizedVendor.pan)) {
      return NextResponse.json({ error: "Invalid PAN format." }, { status: 400 });
    }

    if (requiresAadhaar(vendor.contractor_type) && !normalizedIdentity.aadhaarNumber) {
      return NextResponse.json(
        { error: "Aadhaar Number is required." },
        { status: 400 }
      );
    }

    if (
      allowsAadhaar(vendor.contractor_type) &&
      normalizedIdentity.aadhaarNumber &&
      !aadhaarRegex.test(normalizedIdentity.aadhaarNumber)
    ) {
      return NextResponse.json(
        { error: "Invalid Aadhaar format." },
        { status: 400 }
      );
    }

    if (isCinContractorType(vendor.contractor_type) && !normalizedIdentity.cinNumber) {
      return NextResponse.json(
        { error: "CIN Number is required." },
        { status: 400 }
      );
    }

    if (
      isCinContractorType(vendor.contractor_type) &&
      !cinRegex.test(normalizedIdentity.cinNumber)
    ) {
      return NextResponse.json({ error: "Invalid CIN format." }, { status: 400 });
    }

    if (
      requiresPanAadhaarProof(vendor.contractor_type) &&
      normalizedVendor.pan_aadhaar_link_status !== "Yes"
    ) {
      return NextResponse.json(
        { error: "PAN-Aadhaar link status must be Yes." },
        { status: 400 }
      );
    }

    if (requiresGstin(vendor.contractor_type) && !normalizedGstin) {
      return NextResponse.json({ error: "GSTIN is required." }, { status: 400 });
    }

    if (normalizedGstin) {
      if (!gstRegex.test(normalizedGstin)) {
        return NextResponse.json(
          { error: "Invalid GSTIN format." },
          { status: 400 }
        );
      }

      if (normalizedGstin.substring(2, 12) !== normalizedVendor.pan) {
        return NextResponse.json(
          { error: "GSTIN PAN does not match entered PAN." },
          { status: 400 }
        );
      }
    }

    const validationErrors: string[] = [];

    if (contacts.length === 0) {
      validationErrors.push("At least one contact is required.");
    }

    contacts.forEach((contact) => {
      if (!contact.contact_name?.trim()) validationErrors.push("Contact name is required.");
      if (!contact.contact_number?.trim()) {
        validationErrors.push("Contact number is required.");
      } else if (!mobileRegex.test(contact.contact_number.trim())) {
        validationErrors.push("Enter valid 10 digit contact mobile number.");
      }
      if (contact.email?.trim() && !emailRegex.test(contact.email.trim())) {
        validationErrors.push("Invalid contact email format.");
      }
    });

    if (bankAccounts.length === 0) {
      validationErrors.push("At least one bank account is required.");
    }

    bankAccounts.forEach((bank) => {
      if (!bank.account_holder_name?.trim()) validationErrors.push("Account holder name is required.");
      if (!bank.bank_name?.trim()) validationErrors.push("Bank name is required.");
      if (!bank.account_number?.trim()) validationErrors.push("Account number is required.");
      if (!bank.ifsc_code?.trim()) {
        validationErrors.push("IFSC code is required.");
      } else if (!ifscRegex.test(bank.ifsc_code.trim().toUpperCase())) {
        validationErrors.push("Invalid IFSC format.");
      }
    });

    if (validationErrors.length > 0) {
      return NextResponse.json(
        { error: Array.from(new Set(validationErrors)).join("\n") },
        { status: 400 }
      );
    }

    if (!hasDocument("PAN")) {
      return NextResponse.json({ error: "PAN copy is required." }, { status: 400 });
    }

    const needsIdentityDocument =
      requiresAadhaar(vendor.contractor_type) ||
      isCinContractorType(vendor.contractor_type) ||
      (isPartnershipOrLlp(vendor.contractor_type) && !!normalizedIdentity.aadhaarNumber);

    if (needsIdentityDocument && !hasDocument("AADHAAR_CIN")) {
      return NextResponse.json(
        {
          error: isCinContractorType(vendor.contractor_type)
            ? "CIN attachment is required."
            : "Aadhaar attachment is required.",
        },
        { status: 400 }
      );
    }

    if (!hasDocument("BANK_PROOF")) {
      return NextResponse.json(
        { error: "Cancelled cheque / bank proof is required." },
        { status: 400 }
      );
    }

    if ((requiresGstin(vendor.contractor_type) || normalizedGstin) && !hasDocument("GST_CERTIFICATE")) {
      return NextResponse.json(
        { error: "GST certificate is required when GSTIN is entered." },
        { status: 400 }
      );
    }

    if (
      requiresPanAadhaarProof(vendor.contractor_type) &&
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

      if (!vendor.msme_category?.trim()) {
        return NextResponse.json(
          { error: "MSME category is required." },
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

    const organizationId = resolveWriteOrganizationId(
      organizationScope,
      (vendor as any).organization_id
    );

    if (!organizationId) {
      return NextResponse.json(
        { error: "You cannot create vendors outside your organization." },
        { status: 403 }
      );
    }

    const duplicateVendor = await findDuplicateVendor(supabase, normalizedVendor, organizationId);

    if (duplicateVendor) {
      return NextResponse.json(
        {
          error: `Vendor already exists with same ${duplicateVendor.duplicate_field}: ${duplicateVendor.vendor_name}`,
          duplicate_vendor_id: duplicateVendor.id,
          duplicate_vendor_name: duplicateVendor.vendor_name,
          duplicate_field: duplicateVendor.duplicate_field,
        },
        { status: 409 }
      );
    }

    const { data: createdVendor, error: vendorError } = await supabase
      .from("vendors")
      .insert({
        organization_id: organizationId,
        vendor_name: vendor.vendor_name.trim(),
        contractor_type: vendor.contractor_type,
        status: vendor.status,
        pan: normalizedVendor.pan,
        aadhaar_cin: normalizedVendor.aadhaar_cin,
        gstin: normalizedVendor.gstin || null,
        pan_aadhaar_link_status: normalizedVendor.pan_aadhaar_link_status,
        msme_registered: vendor.msme_registered === "Yes",
        msme_number:
          vendor.msme_registered === "Yes" ? vendor.msme_number?.trim() || null : null,
        msme_category:
          vendor.msme_registered === "Yes" ? vendor.msme_category || null : null,
      })
      .select("*")
      .single();

    if (vendorError) throw vendorError;

    const vendorId = createdVendor.id;
    const createdSnapshot = vendorSnapshot(createdVendor);

    await insertVendorAuditLog(supabase, {
      vendorId,
      organizationId,
      action: "created",
      user: access.user,
      changedFields: ["vendor_created"],
      newValues: createdSnapshot,
      restoreSnapshot: createdSnapshot,
    });

    const vendorFolder = await ensureVendorDriveFolder(
      supabase,
      vendorId,
      vendor.vendor_name.trim()
    );

    if (contacts.length > 0) {
      const { error: contactError } = await supabase
        .from("vendor_contacts")
        .insert(
          contacts.map((contact) => ({
            organization_id: organizationId,
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
            organization_id: organizationId,
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

    if (normalizedGstin) {
      const { error: gstinError } = await supabase.from("vendor_gstins").insert({
        organization_id: organizationId,
        vendor_id: vendorId,
        gstin: normalizedGstin,
        state_code: normalizedGstin.slice(0, 2),
        state_name: null,
        is_primary: true,
      });

      if (gstinError) throw gstinError;
    }

    const documentRows = [];

    for (const [key, value] of formData.entries()) {
      if (key.startsWith("document:") && value instanceof File && value.size > 0) {
        documentRows.push(
          await uploadDocument(
            organizationId,
            vendorId,
            vendorFolder.folderId,
            key.replace("document:", ""),
            value
          )
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
