import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const ORGANIZATION_ID = "3b65abde-9f9f-4f1b-bd40-fa261a76920b";
const DOCUMENT_BUCKET = "Vendor-Documents";

type VendorPayload = {
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

type GstinPayload = {
  gstin: string;
  state_code?: string;
  state_name?: string;
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

async function assertPermission(
  request: Request,
  actionCode: "view" | "edit" | "delete"
) {
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
    return { error: "You do not have permission to access vendors.", status: 403 };
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
    return { error: "You do not have permission to access vendors.", status: 403 };
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

function normalizeStoragePath(value: string | null) {
  if (!value) return "";

  let path = value.trim();

  try {
    if (path.startsWith("http://") || path.startsWith("https://")) {
      const url = new URL(path);
      const marker = `/${DOCUMENT_BUCKET}/`;
      const markerIndex = url.pathname.indexOf(marker);

      if (markerIndex >= 0) {
        path = url.pathname.slice(markerIndex + marker.length);
      }
    }
  } catch {
    path = value.trim();
  }

  path = path.split("?")[0].replace(/^\/+/, "");

  if (path.startsWith(`${DOCUMENT_BUCKET}/`)) {
    path = path.slice(DOCUMENT_BUCKET.length + 1);
  }

  return decodeURIComponent(path);
}

async function createDocumentSignedUrl(
  supabase: ReturnType<typeof adminClient>,
  document: any
) {
  const basePath = normalizeStoragePath(document.file_url);
  const candidates = new Set<string>();

  if (basePath) {
    candidates.add(basePath);

    if (!basePath.includes("/")) {
      candidates.add(
        `${document.organization_id || ORGANIZATION_ID}/${document.vendor_id}/${basePath}`
      );
    }
  }

  for (const path of candidates) {
    const { data, error } = await supabase.storage
      .from(DOCUMENT_BUCKET)
      .createSignedUrl(path, 60 * 10);

    if (!error && data?.signedUrl) {
      return { signedUrl: data.signedUrl, path };
    }
  }

  const folder = `${document.organization_id || ORGANIZATION_ID}/${document.vendor_id}`;
  const safeName = document.file_name ? safeFileName(document.file_name) : "";
  const { data: files, error: listError } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .list(folder, { limit: 1000 });

  if (listError) throw listError;

  const matchedFile = (files || []).find((file) => {
    if (!safeName) return false;
    return file.name === safeName || file.name.endsWith(`_${safeName}`);
  });

  if (matchedFile) {
    const path = `${folder}/${matchedFile.name}`;
    const { data, error } = await supabase.storage
      .from(DOCUMENT_BUCKET)
      .createSignedUrl(path, 60 * 10);

    if (!error && data?.signedUrl) {
      return { signedUrl: data.signedUrl, path };
    }
  }

  throw new Error(
    `Storage object not found for ${document.file_name || document.document_type}. Saved path: ${
      document.file_url || "-"
    }`
  );
}

async function uploadDocument(
  supabase: ReturnType<typeof adminClient>,
  organizationId: string,
  vendorId: string,
  documentType: string,
  file: File
) {
  const path = `${organizationId}/${vendorId}/${documentType}_${Date.now()}_${safeFileName(
    file.name
  )}`;
  const bytes = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .upload(path, bytes, {
      contentType: file.type || "application/octet-stream",
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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const access = await assertPermission(request, "view");

    if ("error" in access) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { id } = await params;
    const supabase = adminClient();

    const [vendor, contacts, bankAccounts, documents, gstins] = await Promise.all([
      supabase.from("vendors").select("*").eq("id", id).maybeSingle(),
      supabase
        .from("vendor_contacts")
        .select("*")
        .eq("vendor_id", id)
        .order("is_primary", { ascending: false }),
      supabase
        .from("vendor_bank_accounts")
        .select("*")
        .eq("vendor_id", id)
        .order("is_primary", { ascending: false }),
      supabase
        .from("vendor_documents")
        .select("*")
        .eq("vendor_id", id)
        .order("uploaded_at", { ascending: false }),
      supabase
        .from("vendor_gstins")
        .select("*")
        .eq("vendor_id", id)
        .order("is_primary", { ascending: false }),
    ]);

    for (const result of [vendor, contacts, bankAccounts, documents, gstins]) {
      if (result.error) throw result.error;
    }

    if (!vendor.data) {
      return NextResponse.json({ error: "Vendor was not found." }, { status: 404 });
    }

    return NextResponse.json({
      vendor: vendor.data,
      contacts: contacts.data || [],
      bankAccounts: bankAccounts.data || [],
      documents: documents.data || [],
      gstins: gstins.data || [],
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load vendor." },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const access = await assertPermission(request, "edit");

    if ("error" in access) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { id } = await params;
    const supabase = adminClient();
    const formData = await request.formData();
    const vendor = parseJson<VendorPayload>(formData, "vendor", {} as VendorPayload);
    const contacts = parseJson<ContactPayload[]>(formData, "contacts", []);
    const bankAccounts = parseJson<BankPayload[]>(formData, "bank_accounts", []);
    const gstins = parseJson<GstinPayload[]>(formData, "gstins", []);

    const { data: existingVendor, error: existingError } = await supabase
      .from("vendors")
      .select("id, organization_id")
      .eq("id", id)
      .maybeSingle();

    if (existingError) throw existingError;

    if (!existingVendor) {
      return NextResponse.json({ error: "Vendor was not found." }, { status: 404 });
    }

    const organizationId = existingVendor.organization_id || ORGANIZATION_ID;
    const gstinRows = gstins
      .map((gstin) => ({
        gstin: gstin.gstin?.trim().toUpperCase() || "",
        state_code: gstin.state_code?.trim() || gstin.gstin?.slice(0, 2) || null,
        state_name: gstin.state_name?.trim() || null,
        is_primary: gstin.is_primary === true,
      }))
      .filter((gstin) => gstin.gstin);
    const primaryGstin =
      gstinRows.find((gstin) => gstin.is_primary)?.gstin ||
      gstinRows[0]?.gstin ||
      vendor.gstin ||
      null;

    const { error: vendorError } = await supabase
      .from("vendors")
      .update({
        vendor_type: vendor.vendor_type,
        contractor_type: vendor.contractor_type,
        status: vendor.status,
        pan: vendor.pan,
        aadhaar_cin: vendor.aadhaar_cin,
        gstin: primaryGstin,
        pan_aadhaar_link_status: vendor.pan_aadhaar_link_status,
        msme_registered: vendor.msme_registered === "Yes",
        msme_number:
          vendor.msme_registered === "Yes" ? vendor.msme_number?.trim() || null : null,
        msme_category:
          vendor.msme_registered === "Yes" ? vendor.msme_category || null : null,
      })
      .eq("id", id);

    if (vendorError) throw vendorError;

    const { error: deleteContactsError } = await supabase
      .from("vendor_contacts")
      .delete()
      .eq("vendor_id", id);

    if (deleteContactsError) throw deleteContactsError;

    if (contacts.length > 0) {
      const { error: contactError } = await supabase
        .from("vendor_contacts")
        .insert(
          contacts.map((contact) => ({
            organization_id: organizationId,
            vendor_id: id,
            contact_name: contact.contact_name.trim(),
            contact_number: contact.contact_number.trim(),
            email: contact.email?.trim() || null,
            designation: contact.designation?.trim() || null,
            is_primary: contact.is_primary === true,
          }))
        );

      if (contactError) throw contactError;
    }

    const { error: deleteBanksError } = await supabase
      .from("vendor_bank_accounts")
      .delete()
      .eq("vendor_id", id);

    if (deleteBanksError) throw deleteBanksError;

    if (bankAccounts.length > 0) {
      const { error: bankError } = await supabase
        .from("vendor_bank_accounts")
        .insert(
          bankAccounts.map((bank, index) => ({
            organization_id: organizationId,
            vendor_id: id,
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

    const { error: deleteGstinsError } = await supabase
      .from("vendor_gstins")
      .delete()
      .eq("vendor_id", id);

    if (deleteGstinsError) throw deleteGstinsError;

    if (gstinRows.length > 0) {
      const hasPrimary = gstinRows.some((gstin) => gstin.is_primary);
      const { error: gstinError } = await supabase.from("vendor_gstins").insert(
        gstinRows.map((gstin, index) => ({
          organization_id: organizationId,
          vendor_id: id,
          gstin: gstin.gstin,
          state_code: gstin.state_code || gstin.gstin.slice(0, 2),
          state_name: gstin.state_name,
          is_primary: hasPrimary ? gstin.is_primary : index === 0,
        }))
      );

      if (gstinError) throw gstinError;
    }

    const documentRows = [];

    for (const [key, value] of formData.entries()) {
      if (key.startsWith("document:") && value instanceof File && value.size > 0) {
        documentRows.push(
          await uploadDocument(
            supabase,
            organizationId,
            id,
            key.replace("document:", ""),
            value
          )
        );
      }
    }

    if (documentRows.length > 0) {
      const { error: documentError } = await supabase
        .from("vendor_documents")
        .insert(
          documentRows.map((row) => ({
            ...row,
            organization_id: organizationId,
          }))
        );

      if (documentError) throw documentError;
    }

    return NextResponse.json({ vendor_id: id });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to update vendor." },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const access = await assertPermission(request, "view");

    if ("error" in access) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { id } = await params;
    const { document_id } = await request.json();

    if (!document_id) {
      return NextResponse.json({ error: "Document id is required." }, { status: 400 });
    }

    const supabase = adminClient();
    const { data: document, error: documentError } = await supabase
      .from("vendor_documents")
      .select("*")
      .eq("id", document_id)
      .eq("vendor_id", id)
      .maybeSingle();

    if (documentError) throw documentError;

    if (!document) {
      return NextResponse.json({ error: "Document was not found." }, { status: 404 });
    }

    const signed = await createDocumentSignedUrl(supabase, document);

    return NextResponse.json(signed);
  } catch (error: any) {
    console.error("Vendor document signed URL failed:", error);

    return NextResponse.json(
      { error: error.message || "Unable to open this document." },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const access = await assertPermission(request, "delete");

    if ("error" in access) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { id } = await params;
    const supabase = adminClient();
    const { data: vendor, error: vendorError } = await supabase
      .from("vendors")
      .select("id, status")
      .eq("id", id)
      .maybeSingle();

    if (vendorError) throw vendorError;

    if (!vendor) {
      return NextResponse.json({ error: "Vendor was not found." }, { status: 404 });
    }

    const { error: updateError } = await supabase
      .from("vendors")
      .update({ status: "deleted" })
      .eq("id", id);

    if (updateError) throw updateError;

    return NextResponse.json({ success: true, status: "deleted" });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to delete vendor." },
      { status: 500 }
    );
  }
}
