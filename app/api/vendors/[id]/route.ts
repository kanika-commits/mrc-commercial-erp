import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { optimizeUploadFile } from "@/lib/fileOptimization";
import { createDriveSubfolder, uploadDriveFile } from "@/src/lib/googleDrive";
import {
  isInOrganizationScope,
  loadOrganizationScopeForUser,
} from "@/lib/serverOrganizationScope";

const ORGANIZATION_ID = "3b65abde-9f9f-4f1b-bd40-fa261a76920b";
const DOCUMENT_BUCKET = "Vendor-Documents";
const VENDOR_MASTER_DRIVE_ROOT_FOLDER_ID = "1_3FCygGl8wOMS8IBEInhIkEFt-C93I-5";

type VendorPayload = {
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

function isProprietorship(value: string | undefined) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "proprietor" || normalized === "proprietorship";
}

function isAadhaarContractorType(value: string | undefined) {
  const normalized = String(value || "").trim().toLowerCase();
  return isProprietorship(value) || normalized === "individual";
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

function vendorDriveFolderName(vendorName: string, vendorId: string) {
  return `${vendorName.trim()} - ${vendorId.slice(0, 8)}`;
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

function addAmount(map: Map<string, number>, workOrderId: string | null, amount: number) {
  if (!workOrderId || !Number.isFinite(amount)) return;
  map.set(workOrderId, (map.get(workOrderId) || 0) + amount);
}

async function createDocumentSignedUrl(
  supabase: ReturnType<typeof adminClient>,
  document: any
) {
  const fileUrl = String(document.file_url || "").trim();

  if (
    fileUrl.startsWith("https://drive.google.com/") ||
    fileUrl.startsWith("https://docs.google.com/")
  ) {
    return { signedUrl: document.file_url, path: document.file_url };
  }

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
    const organizationScope = await loadOrganizationScopeForUser(supabase, access.user.id);

    const [vendor, contacts, bankAccounts, documents, gstins] = await Promise.all([
      supabase
        .from("vendors")
        .select(`
          id,
          organization_id,
          vendor_name,
          pan,
          gstin,
          aadhaar_cin,
          status,
          created_at,
          pan_aadhaar_link_status,
          contractor_type,
          msme_registered,
          msme_number,
          msme_category,
          vendor_drive_folder_id,
          vendor_drive_folder_name,
          updated_at,
          is_deleted
        `)
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("vendor_contacts")
        .select(`
          id,
          organization_id,
          vendor_id,
          contact_name,
          contact_number,
          email,
          designation,
          is_primary,
          created_at
        `)
        .eq("vendor_id", id)
        .order("is_primary", { ascending: false }),
      supabase
        .from("vendor_bank_accounts")
        .select(`
          id,
          organization_id,
          vendor_id,
          account_holder_name,
          account_number,
          ifsc_code,
          bank_name,
          branch_name,
          is_primary,
          created_at
        `)
        .eq("vendor_id", id)
        .order("is_primary", { ascending: false }),
      supabase
        .from("vendor_documents")
        .select(`
          id,
          organization_id,
          vendor_id,
          document_type,
          file_name,
          file_url,
          uploaded_at,
          document_number,
          expiry_date,
          remarks,
          is_verified,
          verified_at
        `)
        .eq("vendor_id", id)
        .order("uploaded_at", { ascending: false }),
      supabase
        .from("vendor_gstins")
        .select(`
          id,
          organization_id,
          vendor_id,
          gstin,
          state_code,
          state_name,
          is_primary,
          created_at
        `)
        .eq("vendor_id", id)
        .order("is_primary", { ascending: false }),
    ]);

    for (const result of [vendor, contacts, bankAccounts, documents, gstins]) {
      if (result.error) throw result.error;
    }

    if (!vendor.data) {
      return NextResponse.json({ error: "Vendor was not found." }, { status: 404 });
    }

    if (!isInOrganizationScope(organizationScope, vendor.data.organization_id)) {
      return NextResponse.json({ error: "Vendor was not found." }, { status: 404 });
    }

    const { data: vendorWorkOrderLinks, error: vendorWorkOrderLinksError } =
      await supabase
        .from("work_order_vendors")
        .select("work_order_id")
        .eq("vendor_id", id);

    if (vendorWorkOrderLinksError) throw vendorWorkOrderLinksError;

    const workOrderIds = new Set(
      (vendorWorkOrderLinks || [])
        .map((link) => link.work_order_id)
        .filter(Boolean)
    );

    const { data: raBillWorkOrders, error: raBillWorkOrdersError } = await supabase
      .from("ra_bills")
      .select("work_order_id")
      .eq("vendor_id", id);

    if (raBillWorkOrdersError) throw raBillWorkOrdersError;

    (raBillWorkOrders || []).forEach((bill) => {
      if (bill.work_order_id) workOrderIds.add(bill.work_order_id);
    });

    const linkedWorkOrderIds = Array.from(workOrderIds);
    const { data: workOrders, error: workOrdersError } = linkedWorkOrderIds.length
      ? await supabase
          .from("work_orders")
          .select("id, company_id, site_id, wo_number, wo_date, wo_value, gst_percent")
          .in("id", linkedWorkOrderIds)
          .eq("organization_id", vendor.data.organization_id)
          .order("wo_number", { ascending: true })
      : { data: [], error: null };

    if (workOrdersError) throw workOrdersError;

    const amountDueByWorkOrder = new Map<string, number>();

    if (linkedWorkOrderIds.length > 0) {
      const [
        raBillsResult,
        invoicesResult,
        paymentsResult,
        debitNotesResult,
      ] = await Promise.all([
        supabase
          .from("ra_bills")
          .select("id, work_order_id, gross_amount, recovery_amount, approval_status")
          .in("work_order_id", linkedWorkOrderIds),
        supabase
          .from("invoices")
          .select("id, work_order_id, gst_amount, itc_status, approval_status")
          .in("work_order_id", linkedWorkOrderIds),
        supabase
          .from("payments")
          .select("id, work_order_id, total_payment, is_deleted")
          .in("work_order_id", linkedWorkOrderIds),
        supabase
          .from("debit_notes")
          .select("id, work_order_id, total_amount, debit_note_type, approval_status")
          .in("work_order_id", linkedWorkOrderIds),
      ]);

      for (const result of [raBillsResult, invoicesResult, paymentsResult, debitNotesResult]) {
        if (result.error) throw result.error;
      }

      (raBillsResult.data || []).forEach((bill: any) => {
        if (String(bill.approval_status || "").trim().toLowerCase() !== "approved") {
          return;
        }
        addAmount(
          amountDueByWorkOrder,
          bill.work_order_id,
          Number(bill.gross_amount || 0) - Number(bill.recovery_amount || 0)
        );
      });

      (invoicesResult.data || []).forEach((invoice: any) => {
        const itcStatus = String(invoice.itc_status || "").trim().toLowerCase();
        const approvalStatus = String(invoice.approval_status || "").trim().toLowerCase();
        if (itcStatus !== "claimed" || approvalStatus === "rejected") {
          return;
        }
        addAmount(amountDueByWorkOrder, invoice.work_order_id, Number(invoice.gst_amount || 0));
      });

      (paymentsResult.data || []).forEach((payment: any) => {
        if (payment.is_deleted === true) return;
        addAmount(amountDueByWorkOrder, payment.work_order_id, -Number(payment.total_payment || 0));
      });

      (debitNotesResult.data || []).forEach((note: any) => {
        if (String(note.approval_status || "").trim().toLowerCase() !== "approved") {
          return;
        }
        const debitNoteType = String(note.debit_note_type || "").trim().toLowerCase();
        if (debitNoteType !== "withheld" && debitNoteType !== "deduction") {
          return;
        }
        addAmount(amountDueByWorkOrder, note.work_order_id, -Number(note.total_amount || 0));
      });
    }

    const workOrdersWithAmountDue = (workOrders || []).map((workOrder: any) => ({
      ...workOrder,
      amount_due: amountDueByWorkOrder.get(workOrder.id) || 0,
    }));

    return NextResponse.json({
      vendor: vendor.data,
      contacts: contacts.data || [],
      bankAccounts: bankAccounts.data || [],
      documents: documents.data || [],
      gstins: gstins.data || [],
      workOrders: workOrdersWithAmountDue,
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
    const organizationScope = await loadOrganizationScopeForUser(supabase, access.user.id);
    const formData = await request.formData();
    const vendor = parseJson<VendorPayload>(formData, "vendor", {} as VendorPayload);
    const contacts = parseJson<ContactPayload[]>(formData, "contacts", []);
    const bankAccounts = parseJson<BankPayload[]>(formData, "bank_accounts", []);
    const gstins = parseJson<GstinPayload[]>(formData, "gstins", []);
    const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
    const aadhaarRegex = /^[2-9][0-9]{11}$/;
    const cinRegex = /^[A-Z][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/;
    const gstRegex =
      /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
    const mobileRegex = /^[6-9][0-9]{9}$/;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;

    const { data: existingVendor, error: existingError } = await supabase
      .from("vendors")
      .select("id, organization_id, vendor_name, vendor_drive_folder_id, vendor_drive_folder_name")
      .eq("id", id)
      .maybeSingle();

    if (existingError) throw existingError;

    if (!existingVendor) {
      return NextResponse.json({ error: "Vendor was not found." }, { status: 404 });
    }

    if (!isInOrganizationScope(organizationScope, existingVendor.organization_id)) {
      return NextResponse.json({ error: "Vendor was not found." }, { status: 404 });
    }

    const organizationId = existingVendor.organization_id || ORGANIZATION_ID;
    const validationErrors: string[] = [];

    if (!vendor.contractor_type?.trim()) {
      validationErrors.push("Contractor Type is required.");
    }

    if (!vendor.pan?.trim()) {
      validationErrors.push("PAN is required.");
    } else if (!panRegex.test(vendor.pan.trim().toUpperCase())) {
      validationErrors.push("Invalid PAN format.");
    }

    if (!vendor.aadhaar_cin?.trim()) {
      validationErrors.push("Aadhaar / CIN is required.");
    } else if (
      isAadhaarContractorType(vendor.contractor_type) &&
      !aadhaarRegex.test(vendor.aadhaar_cin.trim())
    ) {
      validationErrors.push("Invalid Aadhaar format.");
    } else if (
      isCinContractorType(vendor.contractor_type) &&
      !cinRegex.test(vendor.aadhaar_cin.trim().toUpperCase())
    ) {
      validationErrors.push("Invalid CIN format.");
    }

    const normalizedGstins = gstins
      .map((gstin) => gstin.gstin?.trim().toUpperCase() || "")
      .filter(Boolean);
    const duplicateGstins = new Set<string>();
    const seenGstins = new Set<string>();

    normalizedGstins.forEach((gstin) => {
      if (seenGstins.has(gstin)) duplicateGstins.add(gstin);
      seenGstins.add(gstin);
    });

    if (duplicateGstins.size > 0) {
      validationErrors.push("Duplicate GSTIN rows are not allowed.");
    }

    normalizedGstins.forEach((gstin) => {
      if (!gstRegex.test(gstin)) {
        validationErrors.push(`Invalid GSTIN format: ${gstin}.`);
      } else if (
        vendor.pan &&
        gstin.substring(2, 12) !== vendor.pan.trim().toUpperCase()
      ) {
        validationErrors.push(`GSTIN PAN does not match entered PAN: ${gstin}.`);
      }
    });

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

    const seenBankAccounts = new Set<string>();
    const duplicateBankAccounts = new Set<string>();
    bankAccounts
      .map((bank) => bank.account_number?.trim())
      .filter(Boolean)
      .forEach((accountNumber) => {
        if (seenBankAccounts.has(accountNumber)) duplicateBankAccounts.add(accountNumber);
        seenBankAccounts.add(accountNumber);
      });

    if (duplicateBankAccounts.size > 0) {
      validationErrors.push("Duplicate bank account numbers are not allowed.");
    }

    if (vendor.msme_registered === "Yes") {
      if (!vendor.msme_number?.trim()) validationErrors.push("MSME number is required.");
      if (!vendor.msme_category?.trim()) validationErrors.push("MSME category is required.");
    }

    if (validationErrors.length > 0) {
      return NextResponse.json(
        { error: Array.from(new Set(validationErrors)).join("\n") },
        { status: 400 }
      );
    }

    const duplicateChecks = [
      { field: "pan", label: "PAN", value: vendor.pan?.trim().toUpperCase() },
      {
        field: "aadhaar_cin",
        label: "Aadhaar/CIN",
        value: vendor.aadhaar_cin?.trim().toUpperCase(),
      },
    ].filter((check) => check.value);

    for (const check of duplicateChecks) {
      const { data: duplicateVendor, error: duplicateError } = await supabase
        .from("vendors")
        .select("id, vendor_name")
        .eq("organization_id", organizationId)
        .neq("status", "deleted")
        .neq("id", id)
        .eq(check.field, check.value)
        .limit(1)
        .maybeSingle();

      if (duplicateError) throw duplicateError;

      if (duplicateVendor) {
        validationErrors.push(
          `Vendor already exists with same ${check.label}: ${duplicateVendor.vendor_name}`
        );
      }
    }

    const gstinValues = Array.from(
      new Set(
        [
          ...normalizedGstins,
          vendor.gstin?.trim().toUpperCase() || "",
        ].filter(Boolean)
      )
    );

    for (const gstin of gstinValues) {
      const { data: duplicateVendor, error: duplicateVendorError } = await supabase
        .from("vendors")
        .select("id, vendor_name")
        .eq("organization_id", organizationId)
        .neq("status", "deleted")
        .neq("id", id)
        .eq("gstin", gstin)
        .limit(1)
        .maybeSingle();

      if (duplicateVendorError) throw duplicateVendorError;

      if (duplicateVendor) {
        validationErrors.push(
          `Vendor already exists with same GSTIN: ${duplicateVendor.vendor_name}`
        );
        continue;
      }

      const { data: duplicateGstin, error: duplicateGstinError } = await supabase
        .from("vendor_gstins")
        .select("vendor_id, vendors!inner(vendor_name, status)")
        .eq("organization_id", organizationId)
        .neq("vendor_id", id)
        .eq("gstin", gstin)
        .limit(1)
        .maybeSingle();

      if (duplicateGstinError) throw duplicateGstinError;

      const linkedVendor = Array.isArray(duplicateGstin?.vendors)
        ? duplicateGstin?.vendors[0]
        : duplicateGstin?.vendors;

      if (duplicateGstin && linkedVendor?.status !== "deleted") {
        validationErrors.push(
          `Vendor already exists with same GSTIN: ${linkedVendor?.vendor_name || duplicateGstin.vendor_id}`
        );
      }
    }

    if (validationErrors.length > 0) {
      return NextResponse.json(
        { error: Array.from(new Set(validationErrors)).join("\n") },
        { status: 400 }
      );
    }

    const hasNewPanAadhaarProof = formData.get("document:PAN_AADHAAR_ATTACHMENT") instanceof File &&
      (formData.get("document:PAN_AADHAAR_ATTACHMENT") as File).size > 0;

    if (
      isProprietorship(vendor.contractor_type) &&
      vendor.pan_aadhaar_link_status === "Yes" &&
      !hasNewPanAadhaarProof
    ) {
      const { count: existingProofCount, error: existingProofError } = await supabase
        .from("vendor_documents")
        .select("id", { count: "exact", head: true })
        .eq("vendor_id", id)
        .eq("document_type", "PAN_AADHAAR_ATTACHMENT");

      if (existingProofError) throw existingProofError;

      if (!existingProofCount) {
        return NextResponse.json(
          { error: "PAN-Aadhaar Linked Proof is required." },
          { status: 400 }
        );
      }
    }

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
    const hasNewDocuments = Array.from(formData.entries()).some(
      ([key, value]) => key.startsWith("document:") && value instanceof File && value.size > 0
    );
    const vendorFolder = hasNewDocuments
      ? await ensureVendorDriveFolder(
          supabase,
          id,
          existingVendor.vendor_name || id,
          existingVendor.vendor_drive_folder_id,
          existingVendor.vendor_drive_folder_name
        )
      : null;

    for (const [key, value] of formData.entries()) {
      if (key.startsWith("document:") && value instanceof File && value.size > 0) {
        documentRows.push(
          await uploadDocument(
            organizationId,
            id,
            vendorFolder!.folderId,
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
    const organizationScope = await loadOrganizationScopeForUser(supabase, access.user.id);
    const { data: document, error: documentError } = await supabase
      .from("vendor_documents")
      .select("id, organization_id, vendor_id, file_name, file_url")
      .eq("id", document_id)
      .eq("vendor_id", id)
      .maybeSingle();

    if (documentError) throw documentError;

    if (!document) {
      return NextResponse.json({ error: "Document was not found." }, { status: 404 });
    }

    if (!isInOrganizationScope(organizationScope, document.organization_id)) {
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
    const organizationScope = await loadOrganizationScopeForUser(supabase, access.user.id);
    const { data: vendor, error: vendorError } = await supabase
      .from("vendors")
      .select("id, organization_id, status")
      .eq("id", id)
      .maybeSingle();

    if (vendorError) throw vendorError;

    if (!vendor) {
      return NextResponse.json({ error: "Vendor was not found." }, { status: 404 });
    }

    if (!isInOrganizationScope(organizationScope, vendor.organization_id)) {
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
