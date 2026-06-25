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
    const access = await requireEditPermission(request);

    if ("error" in access) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { id } = await params;
    const payload = await request.json().catch(() => ({}));
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

    if (["approved", "approve"].includes(action)) {
      const permission = await requirePermission(request, MODULE_CODE, "approve");

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
      const permission = await requirePermission(request, MODULE_CODE, "reject");

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
