import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { optimizeUploadFile } from "@/lib/fileOptimization";
import { requirePermission } from "@/lib/serverPermissions";
import { insertDeleteAudit } from "@/lib/serverDeleteAudit";
import {
  isInOrganizationScope,
  loadOrganizationScopeForUser,
} from "@/lib/serverOrganizationScope";
import {
  createWorkOrderDriveFolder,
  uploadDriveFile,
} from "@/src/lib/googleDrive";

const MODULE_CODE = "work_orders";
const DOCUMENT_BUCKET = "work-order-documents";
const ALLOWED_STATUSES = new Set([
  "yet_to_start",
  "active",
  "completed",
  "suspended",
  "terminated",
]);

function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

async function loadActorAssignments(admin: ReturnType<typeof adminClient>, userId: string) {
  const { data, error } = await admin
    .from("user_access_assignments")
    .select("company_id, site_id")
    .eq("user_id", userId);

  if (error) throw error;

  return {
    companyIds: Array.from(
      new Set((data || []).map((row) => row.company_id).filter(Boolean)),
    ) as string[],
    siteIds: Array.from(
      new Set((data || []).map((row) => row.site_id).filter(Boolean)),
    ) as string[],
  };
}

function isWorkOrderInActorScope(
  workOrder: any,
  organizationScope: string[] | null,
  assignments: { companyIds: string[]; siteIds: string[] },
) {
  if (!isInOrganizationScope(organizationScope, workOrder?.organization_id)) {
    return false;
  }

  if (assignments.siteIds.length > 0) {
    return assignments.siteIds.includes(workOrder.site_id);
  }

  if (assignments.companyIds.length > 0) {
    return assignments.companyIds.includes(workOrder.company_id);
  }

  return true;
}

function isGoogleDriveUrl(value: string | null | undefined) {
  const url = String(value || "").trim();
  return (
    url.startsWith("https://drive.google.com/") ||
    url.startsWith("https://docs.google.com/")
  );
}

function isPendingApproval(value: string | null | undefined) {
  const status = String(value || "").trim().toLowerCase();
  return !status || status === "pending" || status === "draft";
}

function isApprovedApproval(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase() === "approved";
}

function readFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  if (typeof value !== "string") return undefined;
  return value.trim();
}

function readJsonString(payload: any, key: string) {
  if (!Object.prototype.hasOwnProperty.call(payload, key)) return undefined;
  return String(payload[key] ?? "").trim();
}

function isMissingTextValue(value: unknown) {
  return String(value ?? "").trim() === "";
}

function isMissingNumericValue(value: unknown, allowZero = false) {
  if (value === null || value === undefined || value === "") return true;
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return false;
  return allowZero ? numericValue === 0 : false;
}

function normalizeStoragePath(document: any) {
  const explicitPath = String(document?.file_path || "").trim();
  if (explicitPath && !isGoogleDriveUrl(explicitPath)) {
    return explicitPath.replace(/^\/+/, "");
  }

  const raw = String(document?.file_url || "").trim();
  if (!raw || isGoogleDriveUrl(raw)) return "";
  if (!raw.startsWith("http")) return raw.replace(/^\/+/, "");

  const markers = [
    `/storage/v1/object/public/${DOCUMENT_BUCKET}/`,
    `/storage/v1/object/sign/${DOCUMENT_BUCKET}/`,
  ];

  for (const marker of markers) {
    const markerIndex = raw.indexOf(marker);
    if (markerIndex >= 0) {
      return decodeURIComponent(raw.slice(markerIndex + marker.length));
    }
  }

  return raw;
}

function requireDriveFolderValue(value: unknown, label: string) {
  const text = String(value || "").trim();

  if (!text) {
    throw new Error(`Google Drive Work Order folder response missing ${label}.`);
  }

  return text;
}

function validateWorkOrderDriveFolder(driveFolder: any) {
  return {
    drive_folder_id: requireDriveFolderValue(driveFolder?.folder_id, "folder_id"),
    drive_folder_name: requireDriveFolderValue(
      driveFolder?.folder_name,
      "folder_name"
    ),
    ra_bills_folder_id: requireDriveFolderValue(
      driveFolder?.ra_bills_folder_id,
      "ra_bills_folder_id"
    ),
    invoices_folder_id: requireDriveFolderValue(
      driveFolder?.invoices_folder_id,
      "invoices_folder_id"
    ),
    debit_notes_folder_id: requireDriveFolderValue(
      driveFolder?.debit_notes_folder_id,
      "debit_notes_folder_id"
    ),
    contractor_docs_folder_id: requireDriveFolderValue(
      driveFolder?.contractor_docs_folder_id,
      "contractor_docs_folder_id"
    ),
    work_order_file_id: requireDriveFolderValue(
      driveFolder?.work_order_file_id,
      "work_order_file_id"
    ),
    work_order_file_url: requireDriveFolderValue(
      driveFolder?.work_order_file_url,
      "work_order_file_url"
    ),
    work_order_file_name:
      String(driveFolder?.work_order_file_name || "").trim() || null,
  };
}

async function fileToOptimizedDrivePayload(
  buffer: Buffer,
  mimeType: string,
  fileName: string
) {
  const optimized = await optimizeUploadFile(buffer, mimeType, fileName);
  return {
    fileName: optimized.fileName,
    mimeType: optimized.mimeType,
    base64: optimized.buffer.toString("base64"),
  };
}

async function promoteWorkOrderFileToDrive(
  admin: ReturnType<typeof adminClient>,
  workOrder: any
) {
  const { data: existingFolder, error: existingFolderError } = await admin
    .from("work_order_drive_folders")
    .select(
      "drive_folder_id, drive_folder_name, ra_bills_folder_id, invoices_folder_id, debit_notes_folder_id, contractor_docs_folder_id"
    )
    .eq("work_order_id", workOrder.id)
    .maybeSingle();

  if (existingFolderError) throw existingFolderError;

  const { data: document, error: documentError } = await admin
    .from("work_order_documents")
    .select("id, file_name, file_url, file_path")
    .eq("work_order_id", workOrder.id)
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (documentError) throw documentError;

  if (!document) {
    throw new Error("Pending Work Order file was not found.");
  }

  if (isGoogleDriveUrl(document.file_url)) {
    if (!existingFolder?.drive_folder_id) {
      throw new Error(
        "Work Order file is already on Google Drive, but Drive folder metadata is missing."
      );
    }

    return;
  }

  const storagePath = normalizeStoragePath(document);
  if (!storagePath) {
    throw new Error("Pending Work Order file storage path was not found.");
  }

  const { data: downloadedFile, error: downloadError } = await admin.storage
    .from(DOCUMENT_BUCKET)
    .download(storagePath);

  if (downloadError) throw downloadError;
  if (!downloadedFile) {
    throw new Error("Pending Work Order file could not be downloaded.");
  }

  const fileBuffer = Buffer.from(await downloadedFile.arrayBuffer());
  const mimeType =
    downloadedFile.type || "application/octet-stream";
  const fileName = document.file_name || "Work Order File";
  const optimizedFile = await fileToOptimizedDrivePayload(
    fileBuffer,
    mimeType,
    fileName
  );

  let driveFile: {
    file_id: string;
    file_url: string;
    file_name: string;
  };
  let driveFolderValues:
    | ReturnType<typeof validateWorkOrderDriveFolder>
    | null = null;

  if (existingFolder?.drive_folder_id) {
    driveFile = await uploadDriveFile({
      targetFolderId: existingFolder.drive_folder_id,
      fileName: optimizedFile.fileName,
      mimeType: optimizedFile.mimeType,
      base64: optimizedFile.base64,
    });

    if (!driveFile.file_id || !driveFile.file_url) {
      throw new Error("Google Drive Work Order file was not uploaded.");
    }
  } else {
    const driveFolder = await createWorkOrderDriveFolder(
      workOrder.wo_number,
      optimizedFile
    );
    driveFolderValues = validateWorkOrderDriveFolder(driveFolder);
    driveFile = {
      file_id: driveFolderValues.work_order_file_id,
      file_url: driveFolderValues.work_order_file_url,
      file_name: driveFolderValues.work_order_file_name || fileName,
    };
  }

  if (driveFolderValues) {
    const { error: driveFolderError } = await admin
      .from("work_order_drive_folders")
      .upsert(
        {
          organization_id: workOrder.organization_id,
          work_order_id: workOrder.id,
          drive_folder_id: driveFolderValues.drive_folder_id,
          drive_folder_name: driveFolderValues.drive_folder_name,
          ra_bills_folder_id: driveFolderValues.ra_bills_folder_id,
          invoices_folder_id: driveFolderValues.invoices_folder_id,
          debit_notes_folder_id: driveFolderValues.debit_notes_folder_id,
          contractor_docs_folder_id:
            driveFolderValues.contractor_docs_folder_id,
        },
        { onConflict: "work_order_id" }
      );

    if (driveFolderError) {
      throw new Error(
        `Google Drive folder was created but ERP folder metadata could not be saved: ${driveFolderError.message}`
      );
    }
  }

  const { error: documentUpdateError } = await admin
    .from("work_order_documents")
    .update({
      file_name: driveFile.file_name || fileName,
      file_url: driveFile.file_url,
      file_path: driveFile.file_id,
      uploaded_at: new Date().toISOString(),
    })
    .eq("id", document.id);

  if (documentUpdateError) {
    throw new Error(
      `Google Drive file was uploaded but ERP file metadata could not be saved: ${documentUpdateError.message}`
    );
  }

  const { error: removeError } = await admin.storage
    .from(DOCUMENT_BUCKET)
    .remove([storagePath]);

  if (removeError) {
    console.error("Failed to remove pending Work Order temp file", {
      workOrderId: workOrder.id,
      storagePath,
      error: removeError.message,
    });
  }
}

async function replacePendingWorkOrderPdf(
  admin: ReturnType<typeof adminClient>,
  workOrder: any,
  file: File,
  user: any
) {
  const { data: existingFolder, error: existingFolderError } = await admin
    .from("work_order_drive_folders")
    .select("drive_folder_id, drive_folder_name")
    .eq("work_order_id", workOrder.id)
    .maybeSingle();

  if (existingFolderError) throw existingFolderError;

  if (!existingFolder?.drive_folder_id) {
    throw new Error("Work Order Drive folder was not found for PDF replacement.");
  }

  const { data: currentDocument, error: documentError } = await admin
    .from("work_order_documents")
    .select("id, file_name, file_url, file_path, uploaded_at")
    .eq("work_order_id", workOrder.id)
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (documentError) throw documentError;

  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const optimizedFile = await fileToOptimizedDrivePayload(
    fileBuffer,
    file.type || "application/octet-stream",
    file.name || "Work Order File"
  );

  const driveFile = await uploadDriveFile({
    targetFolderId: existingFolder.drive_folder_id,
    fileName: optimizedFile.fileName,
    mimeType: optimizedFile.mimeType,
    base64: optimizedFile.base64,
  });

  if (!driveFile.file_id || !driveFile.file_url) {
    throw new Error("Replacement Work Order PDF was not uploaded to Google Drive.");
  }

  const nextDocument = {
    organization_id: workOrder.organization_id,
    work_order_id: workOrder.id,
    file_name: driveFile.file_name || optimizedFile.fileName,
    file_url: driveFile.file_url,
    file_path: driveFile.file_id,
    uploaded_at: new Date().toISOString(),
  };

  if (currentDocument?.id) {
    const { error: updateError } = await admin
      .from("work_order_documents")
      .update({
        file_name: nextDocument.file_name,
        file_url: nextDocument.file_url,
        file_path: nextDocument.file_path,
        uploaded_at: nextDocument.uploaded_at,
      })
      .eq("id", currentDocument.id);

    if (updateError) {
      throw new Error(
        `Replacement PDF was uploaded but ERP file metadata could not be updated: ${updateError.message}`
      );
    }
  } else {
    const { error: insertError } = await admin
      .from("work_order_documents")
      .insert(nextDocument);

    if (insertError) {
      throw new Error(
        `Replacement PDF was uploaded but ERP file metadata could not be saved: ${insertError.message}`
      );
    }
  }

  await insertDeleteAudit(admin, user, {
    organizationId: workOrder.organization_id,
    moduleCode: MODULE_CODE,
    documentType: "Work Order PDF Replacement",
    documentId: workOrder.id,
    documentNumber: workOrder.wo_number,
    deletionReason: "Pending Work Order original PDF replaced before approval.",
    recordSnapshot: {
      action: "pending_pdf_replaced",
      previous_file: currentDocument || null,
      replacement_file: {
        file_name: nextDocument.file_name,
        file_url: nextDocument.file_url,
        file_path: nextDocument.file_path,
        uploaded_at: nextDocument.uploaded_at,
      },
    },
  });
}

async function loadScopedWorkOrder(
  admin: ReturnType<typeof adminClient>,
  userId: string,
  workOrderId: string,
) {
  const { data: workOrder, error } = await admin
    .from("work_orders")
    .select("id, organization_id, company_id, site_id, wo_number, status, approval_status")
    .eq("id", workOrderId)
    .maybeSingle();

  if (error) throw error;

  if (!workOrder) {
    return { error: "Work Order was not found.", status: 404 } as const;
  }

  const [organizationScope, assignments] = await Promise.all([
    loadOrganizationScopeForUser(admin, userId),
    loadActorAssignments(admin, userId),
  ]);

  if (!isWorkOrderInActorScope(workOrder, organizationScope, assignments)) {
    return { error: "You do not have access to this Work Order.", status: 403 } as const;
  }

  return { workOrder } as const;
}

async function requireEditPermission(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const token = request.headers.get("authorization")?.replace("Bearer ", "");

  if (!token) {
    return { error: "Missing auth token.", status: 401 } as const;
  }

  const authClient = createClient(supabaseUrl, anonKey);
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const {
    data: { user },
    error: userError,
  } = await authClient.auth.getUser(token);

  if (userError) throw userError;

  if (!user) {
    return { error: "User not found.", status: 401 } as const;
  }

  const { data: userRoles, error: userRolesError } = await admin
    .from("user_roles")
    .select("role_id")
    .eq("user_id", user.id);

  if (userRolesError) throw userRolesError;

  const roleIds = (userRoles || []).map((row) => row.role_id).filter(Boolean);

  const { data: userPermissions, error: userPermissionError } = await admin
    .from("user_permissions")
    .select("module_code, action_code, allowed")
    .eq("user_id", user.id);

  if (userPermissionError) throw userPermissionError;

  let roleCodes: string[] = [];
  let rolePermissions: any[] = [];

  if (roleIds.length > 0) {
    const [{ data: roles, error: rolesError }, { data: permissions, error: permissionsError }] =
      await Promise.all([
        admin.from("roles").select("role_code").in("id", roleIds),
        admin
          .from("role_permissions")
          .select("module_code, action_code, allowed")
          .in("role_id", roleIds),
      ]);

    if (rolesError) throw rolesError;
    if (permissionsError) throw permissionsError;

    roleCodes = (roles || []).map((role) => role.role_code).filter(Boolean);
    rolePermissions = permissions || [];
  }

  if (roleCodes.includes("platform_owner")) {
    return { user } as const;
  }

  const allowed = [...rolePermissions, ...(userPermissions || [])].some(
    (permission) =>
      permission.allowed === true &&
      ((permission.module_code === "*" && permission.action_code === "*") ||
        (permission.module_code === MODULE_CODE && permission.action_code === "edit"))
  );

  if (!allowed) {
    return {
      error: "You do not have permission to edit Work Orders.",
      status: 403,
    } as const;
  }

  return { user } as const;
}

async function requirePlatformOwner(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const token = request.headers.get("authorization")?.replace("Bearer ", "");

  if (!token) {
    return { error: "Missing auth token.", status: 401 } as const;
  }

  const authClient = createClient(supabaseUrl, anonKey);
  const {
    data: { user },
    error: userError,
  } = await authClient.auth.getUser(token);

  if (userError) throw userError;

  if (!user) {
    return { error: "User not found.", status: 401 } as const;
  }

  const admin = adminClient();
  const [
    { data: userRoles, error: userRolesError },
    { data: userPermissions, error: userPermissionsError },
  ] = await Promise.all([
    admin.from("user_roles").select("role_id").eq("user_id", user.id),
    admin
      .from("user_permissions")
      .select("module_code, action_code, allowed")
      .eq("user_id", user.id),
  ]);

  if (userRolesError) throw userRolesError;
  if (userPermissionsError) throw userPermissionsError;

  const roleIds = (userRoles || []).map((row) => row.role_id).filter(Boolean);
  let roleCodes: string[] = [];
  let rolePermissions: any[] = [];

  if (roleIds.length > 0) {
    const [
      { data: roles, error: rolesError },
      { data: permissions, error: permissionsError },
    ] = await Promise.all([
      admin.from("roles").select("role_code").in("id", roleIds),
      admin
        .from("role_permissions")
        .select("module_code, action_code, allowed")
        .in("role_id", roleIds),
    ]);

    if (rolesError) throw rolesError;
    if (permissionsError) throw permissionsError;
    roleCodes = (roles || []).map((role) => role.role_code).filter(Boolean);
    rolePermissions = permissions || [];
  }

  const hasWildcard = [...rolePermissions, ...(userPermissions || [])].some(
    (permission) =>
      permission.allowed === true &&
      permission.module_code === "*" &&
      permission.action_code === "*"
  );

  if (!roleCodes.includes("platform_owner") && !hasWildcard) {
    return {
      error: "Only Platform Owner can undo Work Order suspension.",
      status: 403,
    } as const;
  }

  return { user } as const;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const contentType = request.headers.get("content-type") || "";
    let payload: any = {};
    let formData: FormData | null = null;

    if (contentType.includes("multipart/form-data")) {
      formData = await request.formData();
      payload = Object.fromEntries(formData.entries());
    } else {
      payload = await request.json().catch(() => ({}));
    }

    const action = String(payload.action || "").trim().toLowerCase();

    if (["undo_suspension", "undo_suspend", "reactivate", "reactivated"].includes(action)) {
      const platformOwner = await requirePlatformOwner(request);

      if ("error" in platformOwner) {
        return NextResponse.json(
          { error: platformOwner.error },
          { status: platformOwner.status },
        );
      }

      const reason = String(payload.reactivation_reason || payload.reason || "").trim();

      if (reason.length < 10) {
        return NextResponse.json(
          { error: "Reason must be at least 10 characters." },
          { status: 400 },
        );
      }

      const admin = adminClient();
      const { data: workOrder, error: workOrderError } = await admin
        .from("work_orders")
        .select(
          "id, organization_id, wo_number, status, approval_status, approved_at"
        )
        .eq("id", id)
        .maybeSingle();

      if (workOrderError) throw workOrderError;

      if (!workOrder) {
        return NextResponse.json(
          { error: "Work Order was not found." },
          { status: 404 },
        );
      }

      const currentStatus = String(workOrder.status || "").trim().toLowerCase();
      const currentApprovalStatus = String(workOrder.approval_status || "")
        .trim()
        .toLowerCase();

      if (
        !["suspended", "cancelled"].includes(currentStatus) &&
        !["suspended", "cancelled", "rejected"].includes(currentApprovalStatus)
      ) {
        return NextResponse.json(
          { error: "Only suspended Work Orders can have suspension undone." },
          { status: 400 },
        );
      }

      const { data: suspensionAudit, error: suspensionAuditError } = await admin
        .from("deleted_records_audit")
        .select("record_snapshot")
        .eq("module_code", MODULE_CODE)
        .eq("document_id", id)
        .eq("document_type", "Work Order Suspension")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (suspensionAuditError) throw suspensionAuditError;

      const previousApprovalStatus = String(
        suspensionAudit?.record_snapshot?.previous_approval_status || ""
      )
        .trim()
        .toLowerCase();
      const restoredApprovalStatus =
        previousApprovalStatus === "approved"
          ? "approved"
          : previousApprovalStatus === "pending"
            ? "pending"
            : workOrder.approved_at
              ? "approved"
              : "pending";

      const { error: updateError } = await admin
        .from("work_orders")
        .update({
          status: "active",
          approval_status: restoredApprovalStatus,
        })
        .eq("id", id);

      if (updateError) throw updateError;

      await insertDeleteAudit(admin, platformOwner.user, {
        organizationId: workOrder.organization_id,
        moduleCode: MODULE_CODE,
        documentType: "Work Order Suspension Undo",
        documentId: workOrder.id,
        documentNumber: workOrder.wo_number,
        deletionReason: reason,
        recordSnapshot: {
          action: "suspension_undone",
          suspended_status: workOrder.status,
          suspended_approval_status: workOrder.approval_status,
          restored_status: "active",
          restored_approval_status: restoredApprovalStatus,
          undone_at: new Date().toISOString(),
          reason,
        },
      });

      return NextResponse.json({
        work_order_id: id,
        suspension_undone: true,
        status: "active",
        approval_status: restoredApprovalStatus,
      });
    }

    if (["update_details", "update", "save_corrections"].includes(action)) {
      const admin = adminClient();
      const { data: workOrder, error: workOrderError } = await admin
        .from("work_orders")
        .select(
          "id, organization_id, company_id, site_id, wo_number, wo_type, description, wo_date, wo_value, gst_percent, status, approval_status, approved_at"
        )
        .eq("id", id)
        .maybeSingle();

      if (workOrderError) throw workOrderError;

      if (!workOrder) {
        return NextResponse.json(
          { error: "Work Order was not found." },
          { status: 404 },
        );
      }

      const approvalStatus = String(workOrder.approval_status || "")
        .trim()
        .toLowerCase();
      const lifecycleStatus = String(workOrder.status || "").trim().toLowerCase();
      const pending = isPendingApproval(approvalStatus);
      const approved = isApprovedApproval(approvalStatus);

      if (lifecycleStatus === "suspended" || ["suspended", "rejected"].includes(approvalStatus)) {
        return NextResponse.json(
          { error: "Suspended Work Orders are read-only. Undo suspension before editing." },
          { status: 409 },
        );
      }

      if (!pending && !approved) {
        return NextResponse.json(
          { error: "This Work Order cannot be edited in its current approval state." },
          { status: 409 },
        );
      }

      const permission = pending
        ? await requirePermission(request, "wo_approval", "approve")
        : await requirePermission(request, MODULE_CODE, "edit");

      if ("response" in permission) {
        return permission.response;
      }

      const scopedWorkOrder = await loadScopedWorkOrder(admin, permission.user.id, id);

      if ("error" in scopedWorkOrder) {
        return NextResponse.json(
          { error: scopedWorkOrder.error },
          { status: scopedWorkOrder.status },
        );
      }

      const updatePayload: Record<string, any> = {};
      const textValue = (key: string) =>
        formData ? readFormString(formData, key) : readJsonString(payload, key);
      const neverEditableFields = ["wo_number", "approval_status"];
      for (const forbiddenField of neverEditableFields) {
        if (textValue(forbiddenField) !== undefined) {
          return NextResponse.json(
            { error: "Work Order number and approval status cannot be edited here." },
            { status: 403 },
          );
        }
      }

      const allowedTextFields = pending
        ? ["description", "wo_type", "wo_date", "wo_value", "gst_percent"]
        : ["description", "wo_type", "status", "wo_date", "wo_value", "gst_percent"];

      for (const field of allowedTextFields) {
        const value = textValue(field);
        if (value === undefined) continue;

        if (field === "wo_value" || field === "gst_percent") {
          const numericValue = Number(value);
          if (!Number.isFinite(numericValue) || numericValue < 0) {
            return NextResponse.json(
              { error: `${field === "wo_value" ? "Work Order value" : "GST percent"} must be a valid number.` },
              { status: 400 },
            );
          }
          updatePayload[field] = numericValue;
        } else if (field === "status") {
          const statusValue = value.toLowerCase();
          if (!ALLOWED_STATUSES.has(statusValue)) {
            return NextResponse.json(
              { error: "Invalid Work Order status." },
              { status: 400 },
            );
          }
          updatePayload.status = statusValue;
        } else if (field === "wo_date") {
          updatePayload.wo_date = value || null;
        } else {
          updatePayload[field] = value || null;
        }
      }

      if (!pending) {
        for (const forbiddenField of [
          "company_id",
          "site_id",
          "vendor_id",
          "primary_vendor_id",
          "retention",
          "retention_percent",
          "security_deposit",
          "security_amount",
        ]) {
          if (textValue(forbiddenField) !== undefined) {
            return NextResponse.json(
              { error: "Approved Work Orders cannot change company, site, vendor or locked commercial fields." },
              { status: 403 },
            );
          }
        }

        if (
          textValue("wo_date") !== undefined &&
          !isMissingTextValue(workOrder.wo_date)
        ) {
          return NextResponse.json(
            { error: "Approved Work Order date is already set and cannot be changed here." },
            { status: 403 },
          );
        }

        if (
          textValue("wo_value") !== undefined &&
          !isMissingNumericValue(workOrder.wo_value, true)
        ) {
          return NextResponse.json(
            { error: "Approved Work Order value is already set and cannot be changed here." },
            { status: 403 },
          );
        }

        if (
          textValue("gst_percent") !== undefined &&
          !isMissingNumericValue(workOrder.gst_percent, false)
        ) {
          return NextResponse.json(
            { error: "Approved Work Order GST percent is already set and cannot be changed here." },
            { status: 403 },
          );
        }
      }

      const replacementFile =
        formData?.get("work_order_file") instanceof File
          ? (formData.get("work_order_file") as File)
          : null;

      if (replacementFile && replacementFile.size > 0) {
        if (!pending) {
          return NextResponse.json(
            { error: "Original Work Order PDF cannot be replaced after approval." },
            { status: 403 },
          );
        }

        await replacePendingWorkOrderPdf(admin, workOrder, replacementFile, permission.user);
      }

      if (Object.keys(updatePayload).length > 0) {
        const { error: updateError } = await admin
          .from("work_orders")
          .update(updatePayload)
          .eq("id", id);

        if (updateError) throw updateError;

        await insertDeleteAudit(admin, permission.user, {
          organizationId: workOrder.organization_id,
          moduleCode: MODULE_CODE,
          documentType: "Work Order Correction",
          documentId: workOrder.id,
          documentNumber: workOrder.wo_number,
          deletionReason: pending
            ? "Pending Work Order details corrected before approval."
            : "Approved Work Order allowed fields updated.",
          recordSnapshot: {
            action: pending ? "pending_correction" : "approved_allowed_edit",
            previous: {
              description: workOrder.description,
              wo_type: workOrder.wo_type,
              wo_date: workOrder.wo_date,
              wo_value: workOrder.wo_value,
              gst_percent: workOrder.gst_percent,
              status: workOrder.status,
              approval_status: workOrder.approval_status,
            },
            updated: updatePayload,
          },
        });
      }

      return NextResponse.json({
        work_order_id: id,
        updated: true,
        pdf_replaced: Boolean(replacementFile && replacementFile.size > 0),
      });
    }

    if (["approved", "approve"].includes(action)) {
      const permission = await requirePermission(request, "wo_approval", "approve");

      if ("response" in permission) {
        return permission.response;
      }

      const admin = adminClient();
      const scopedWorkOrder = await loadScopedWorkOrder(admin, permission.user.id, id);

      if ("error" in scopedWorkOrder) {
        return NextResponse.json(
          { error: scopedWorkOrder.error },
          { status: scopedWorkOrder.status },
        );
      }

      const userEmail = permission.user.email || "";
      const userName =
        permission.user.user_metadata?.full_name ||
        permission.user.user_metadata?.name ||
        userEmail;

      const { error: updateError } = await admin
        .from("work_orders")
        .update({
          approval_status: "approved",
          status: "active",
          approved_by_name: userName,
          approved_by_email: userEmail,
          approved_at: new Date().toISOString(),
        })
        .eq("id", id);

      if (updateError) throw updateError;

      return NextResponse.json({ work_order_id: id, approved: true });
    }

    if (["suspended", "suspend", "cancelled", "cancel", "rejected", "reject"].includes(action)) {
      const permission = await requirePermission(request, "wo_approval", "approve");

      if ("response" in permission) {
        return permission.response;
      }

      const admin = adminClient();
      const scopedWorkOrder = await loadScopedWorkOrder(admin, permission.user.id, id);

      if ("error" in scopedWorkOrder) {
        return NextResponse.json(
          { error: scopedWorkOrder.error },
          { status: scopedWorkOrder.status },
        );
      }

      const { error: updateError } = await admin
        .from("work_orders")
        .update({
          approval_status: "suspended",
          status: "suspended",
        })
        .eq("id", id);

      if (updateError) throw updateError;

      await insertDeleteAudit(admin, permission.user, {
        organizationId: scopedWorkOrder.workOrder.organization_id,
        moduleCode: MODULE_CODE,
        documentType: "Work Order Suspension",
        documentId: scopedWorkOrder.workOrder.id,
        documentNumber: scopedWorkOrder.workOrder.wo_number,
        deletionReason: "Work Order suspended from approval workflow.",
        recordSnapshot: {
          action: "suspended",
          previous_status: scopedWorkOrder.workOrder.status,
          previous_approval_status: scopedWorkOrder.workOrder.approval_status,
          suspended_status: "suspended",
          suspended_approval_status: "suspended",
          suspended_at: new Date().toISOString(),
        },
      });

      return NextResponse.json({ work_order_id: id, suspended: true });
    }

    const status = String(payload.status || "").trim().toLowerCase();

    const access = await requireEditPermission(request);

    if ("error" in access) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    if (!ALLOWED_STATUSES.has(status)) {
      return NextResponse.json(
        { error: "Invalid Work Order status." },
        { status: 400 }
      );
    }

    const admin = adminClient();
    const scopedWorkOrder = await loadScopedWorkOrder(admin, access.user.id, id);

    if ("error" in scopedWorkOrder) {
      return NextResponse.json(
        { error: scopedWorkOrder.error },
        { status: scopedWorkOrder.status },
      );
    }

    const { error: updateError } = await admin
      .from("work_orders")
      .update({ status })
      .eq("id", id);

    if (updateError) throw updateError;

    return NextResponse.json({ work_order_id: id, status });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to update Work Order status." },
      { status: 500 }
    );
  }
}
