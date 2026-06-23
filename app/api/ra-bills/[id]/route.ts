import { NextResponse } from "next/server";
import {
  createServiceRoleClient,
  insertDeleteAudit,
  requireAuthenticatedUser,
  requireDeletePermission,
} from "@/lib/serverDeleteAudit";
import { optimizeUploadFile } from "@/lib/fileOptimization";
import {
  createWorkOrderDriveFolder,
  uploadDriveFile,
} from "@/src/lib/googleDrive";
import { requirePermission } from "@/lib/serverPermissions";

const DOCUMENT_BUCKET = "ra-bill-documents";
const MODULE_CODE = "ra_bills";

function normalizeStoragePath(value: string | null) {
  const raw = String(value || "").trim();

  if (!raw) return "";
  if (!raw.startsWith("http")) return raw.replace(/^\/+/, "");

  const marker = `/storage/v1/object/public/${DOCUMENT_BUCKET}/`;
  const markerIndex = raw.indexOf(marker);

  if (markerIndex >= 0) {
    return decodeURIComponent(raw.slice(markerIndex + marker.length));
  }

  return raw;
}

function isGoogleDriveUrl(value: string | null | undefined) {
  const url = String(value || "").trim();
  return (
    url.startsWith("https://drive.google.com/") ||
    url.startsWith("https://docs.google.com/")
  );
}

function documentStoragePath(document: any) {
  const filePath = String(document?.file_path || "").trim();
  const fileUrl = String(document?.file_url || "").trim();

  if (isGoogleDriveUrl(fileUrl) || isGoogleDriveUrl(filePath)) {
    return "";
  }

  return normalizeStoragePath(filePath || fileUrl);
}

function mimeTypeFromFileName(fileName: string) {
  const extension = fileName.split(".").pop()?.toLowerCase();

  switch (extension) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "pdf":
      return "application/pdf";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "xls":
      return "application/vnd.ms-excel";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "doc":
      return "application/msword";
    default:
      return "application/octet-stream";
  }
}

async function resolveRABillsDriveFolder(
  admin: ReturnType<typeof createServiceRoleClient>,
  workOrderId: string
) {
  const { data: existingFolder, error: existingFolderError } = await admin
    .from("work_order_drive_folders")
    .select(
      "id, organization_id, work_order_id, drive_folder_id, drive_folder_name, ra_bills_folder_id, invoices_folder_id, debit_notes_folder_id, contractor_docs_folder_id"
    )
    .eq("work_order_id", workOrderId)
    .maybeSingle();

  if (existingFolderError) throw existingFolderError;

  if (existingFolder?.ra_bills_folder_id) {
    return existingFolder.ra_bills_folder_id as string;
  }

  const { data: workOrder, error: workOrderError } = await admin
    .from("work_orders")
    .select("id, organization_id, wo_number")
    .eq("id", workOrderId)
    .maybeSingle();

  if (workOrderError) throw workOrderError;

  if (!workOrder?.wo_number) {
    throw new Error("Work Order number was not found for Drive folder resolution.");
  }

  const driveFolder = await createWorkOrderDriveFolder(workOrder.wo_number);

  if (!driveFolder?.folder_id || !driveFolder?.ra_bills_folder_id) {
    throw new Error("Google Drive RA Bills folder was not created.");
  }

  const folderPayload = {
    organization_id: existingFolder?.organization_id || workOrder.organization_id,
    work_order_id: workOrderId,
    drive_folder_id: driveFolder.folder_id,
    drive_folder_name: driveFolder.folder_name,
    ra_bills_folder_id: driveFolder.ra_bills_folder_id,
    invoices_folder_id: driveFolder.invoices_folder_id,
    debit_notes_folder_id: driveFolder.debit_notes_folder_id,
    contractor_docs_folder_id: driveFolder.contractor_docs_folder_id,
  };

  if (existingFolder?.id) {
    const { error: updateFolderError } = await admin
      .from("work_order_drive_folders")
      .update(folderPayload)
      .eq("id", existingFolder.id);

    if (updateFolderError) throw updateFolderError;
  } else {
    const { error: insertFolderError } = await admin
      .from("work_order_drive_folders")
      .insert(folderPayload);

    if (insertFolderError) throw insertFolderError;
  }

  return driveFolder.ra_bills_folder_id;
}

async function readApprovalAction(request: Request) {
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || body.approval_status || "").trim();
  const rejectionReason = String(
    body.rejection_reason || body.rejectionReason || ""
  ).trim();

  return { action, rejectionReason };
}

async function readDeletionReason(request: Request) {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => ({}));
    return String(body.deletion_reason || body.deletionReason || "").trim();
  }

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    return String(
      formData.get("deletion_reason") || formData.get("deletionReason") || ""
    ).trim();
  }

  return "";
}

function isMissingRelationError(error: any) {
  const message = String(error?.message || "").toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "42703" ||
    error?.code === "PGRST204" ||
    error?.code === "PGRST205" ||
    message.includes("could not find") ||
    message.includes("does not exist")
  );
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const fail = (message: string, status = 500, details?: any) => {
    if (details) {
      console.error("[RA Bill APPROVAL]", message, details);
    }

    return NextResponse.json({ error: message, details }, { status });
  };

  const { id } = await context.params;
  const raBillId = String(id || "").trim();

  if (!raBillId) {
    return fail("RA Bill id is required.", 400);
  }

  const { action, rejectionReason } = await readApprovalAction(request);
  const normalizedAction = action.toLowerCase();

  if (!["approved", "rejected"].includes(normalizedAction)) {
    return fail("Approval action must be Approved or Rejected.", 400);
  }

  if (normalizedAction === "rejected" && !rejectionReason) {
    return fail("Reason is required for Reject.", 400);
  }

  const auth = await requirePermission(
    request,
    MODULE_CODE,
    normalizedAction === "approved" ? "approve" : "reject"
  ).catch((error) => ({
    response: NextResponse.json(
      { error: error.message || "Permission check failed." },
      { status: 500 }
    ),
  }));

  if ("response" in auth) {
    return auth.response;
  }

  const admin = createServiceRoleClient();
  const { data: raBill, error: raBillError } = await admin
    .from("ra_bills")
    .select("*")
    .eq("id", raBillId)
    .maybeSingle();

  if (raBillError) {
    return fail("Failed to load RA Bill.", 500, raBillError);
  }

  if (!raBill) {
    return fail("RA Bill was not found.", 404);
  }

  const { data: documents, error: documentsError } = await admin
    .from("ra_bill_documents")
    .select("*")
    .eq("ra_bill_id", raBillId);

  if (documentsError) {
    return fail("Failed to load RA Bill documents.", 500, documentsError);
  }

  const userEmail = auth.user.email || "";
  const userName =
    auth.user.user_metadata?.full_name ||
    auth.user.user_metadata?.name ||
    userEmail ||
    "HO User";
  const now = new Date().toISOString();

  if (normalizedAction === "approved") {
    const raBillsFolderId = await resolveRABillsDriveFolder(
      admin,
      raBill.work_order_id
    ).catch((error) => ({ error }));

    if (typeof raBillsFolderId !== "string") {
      return fail(
        "Failed to resolve Work Order Google Drive RA Bills folder.",
        500,
        raBillsFolderId.error
      );
    }

    for (const document of documents || []) {
      if (isGoogleDriveUrl(document.file_url)) {
        continue;
      }

      const tempPath = documentStoragePath(document);

      if (!tempPath) {
        return fail(
          `Temporary file path was not found for ${document.file_name || "attachment"}.`,
          400
        );
      }

      const { data: fileBlob, error: downloadError } = await admin.storage
        .from(DOCUMENT_BUCKET)
        .download(tempPath);

      if (downloadError || !fileBlob) {
        return fail("Failed to read temporary RA Bill attachment.", 500, downloadError);
      }

      const fileBuffer = Buffer.from(await fileBlob.arrayBuffer());
      const fileName = document.file_name || "ra-bill-attachment";
      const optimizedFile = await optimizeUploadFile(
        fileBuffer,
        mimeTypeFromFileName(fileName),
        fileName
      );
      const driveFile = await uploadDriveFile({
        targetFolderId: raBillsFolderId,
        fileName,
        mimeType: optimizedFile.mimeType || mimeTypeFromFileName(fileName),
        base64: optimizedFile.buffer.toString("base64"),
      });

      const { error: documentUpdateError } = await admin
        .from("ra_bill_documents")
        .update({
          file_name: driveFile.file_name || fileName,
          file_url: driveFile.file_url,
          file_path: driveFile.file_id,
        })
        .eq("id", document.id);

      if (documentUpdateError) {
        return fail(
          "Failed to update RA Bill document after Google Drive upload.",
          500,
          documentUpdateError
        );
      }

      const { error: storageDeleteError } = await admin.storage
        .from(DOCUMENT_BUCKET)
        .remove([tempPath]);

      if (storageDeleteError) {
        return fail(
          "Failed to delete temporary RA Bill attachment after Google Drive upload.",
          500,
          storageDeleteError
        );
      }
    }

    const { error: approvalError } = await admin
      .from("ra_bills")
      .update({
        approval_status: "Approved",
        status: "Approved",
        approved_by_name: userName,
        approved_by_email: userEmail,
        approved_at: now,
      })
      .eq("id", raBillId);

    if (approvalError) {
      return fail("Failed to approve RA Bill.", 500, approvalError);
    }

    return NextResponse.json({ approved: true });
  }

  const { error: rejectionAuditError } = await admin
    .from("ra_bill_rejections")
    .insert({
      organization_id: raBill.organization_id,
      ra_bill_id: raBill.id,
      rejected_by_name: userName,
      rejected_by_email: userEmail,
      rejection_reason: rejectionReason,
      rejected_at: now,
    });

  if (rejectionAuditError) {
    return fail("Failed to save RA Bill rejection reason.", 500, rejectionAuditError);
  }

  const tempPaths = Array.from(
    new Set((documents || []).map(documentStoragePath).filter(Boolean))
  );
  const driveDocuments = (documents || []).filter((document) =>
    isGoogleDriveUrl(document.file_url)
  );

  if (tempPaths.length > 0) {
    const { error: storageDeleteError } = await admin.storage
      .from(DOCUMENT_BUCKET)
      .remove(tempPaths);

    if (storageDeleteError) {
      return fail("Failed to delete temporary RA Bill attachments.", 500, storageDeleteError);
    }
  }

  if (driveDocuments.length > 0) {
    console.warn(
      "[RA Bill REJECTION] Google Drive deletion helper is not available; Drive files were not deleted.",
      {
        ra_bill_id: raBillId,
        drive_files: driveDocuments.map((document) => ({
          id: document.id,
          file_name: document.file_name,
          file_path: document.file_path,
          file_url: document.file_url,
        })),
      }
    );
  }

  const { error: documentDeleteError } = await admin
    .from("ra_bill_documents")
    .delete()
    .eq("ra_bill_id", raBillId);

  if (documentDeleteError) {
    return fail("Failed to delete rejected RA Bill document rows.", 500, documentDeleteError);
  }

  const { error: raBillDeleteError } = await admin
    .from("ra_bills")
    .delete()
    .eq("id", raBillId);

  if (raBillDeleteError) {
    return fail("Failed to delete rejected RA Bill.", 500, raBillDeleteError);
  }

  return NextResponse.json({
    rejected: true,
    deleted: true,
    drive_files_not_deleted: driveDocuments.length,
  });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const fail = (step: string, details: any, status = 500) => {
    console.error("[RA Bill DELETE]", step, {
      message: details?.message,
      code: details?.code,
      details: details?.details,
      hint: details?.hint,
      error: details,
    });

    return NextResponse.json(
      {
        error: "RA Bill delete failed",
        step,
        details,
      },
      { status }
    );
  };

  let raBillId = "";
  let deletionReason = "";

  try {
    const { id } = await context.params;
    raBillId = String(id || "").trim();
    deletionReason = await readDeletionReason(request);
  } catch (error) {
    return fail("parse_request", error);
  }

  if (!raBillId) {
    return fail("parse_request", { message: "RA Bill id is required." }, 400);
  }

  if (deletionReason.length < 10) {
    return fail(
      "parse_request",
      { message: "Deletion reason must be at least 10 characters." },
      400
    );
  }

  const auth = await requireAuthenticatedUser(request).catch((error) => ({
    error,
    status: 401,
  }));

  if ("error" in auth) {
    return fail("permission_check", auth.error, auth.status);
  }

  let admin: ReturnType<typeof createServiceRoleClient>;

  try {
    admin = createServiceRoleClient();
  } catch (error) {
    return fail("permission_check", error);
  }

  const permission = await requireDeletePermission(
    admin,
    auth.user,
    MODULE_CODE
  ).catch((error) => ({
    error,
    status: 500,
  }));

  if ("error" in permission) {
    return fail("permission_check", permission.error, permission.status);
  }

  const { data: raBill, error: raBillError } = await admin
    .from("ra_bills")
    .select("*")
    .eq("id", raBillId)
    .maybeSingle();

  if (raBillError) {
    return fail("fetch_ra_bill", raBillError);
  }

  if (!raBill) {
    return fail("fetch_ra_bill", { message: "RA Bill was not found." }, 404);
  }

  const normalizedApprovalStatus = String(
    raBill.approval_status || raBill.status || ""
  )
    .trim()
    .toLowerCase();
  const isApprovedRABill = normalizedApprovalStatus === "approved";
  const dependencies: Record<string, number> = {};

  for (const [key, table] of [
    ["invoices", "invoices"],
    ["debit_notes", "debit_notes"],
  ] as const) {
    const { count, error } = await admin
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("ra_bill_id", raBillId);

    if (error) {
      console.error("[RA Bill DELETE] linked record lookup failed", {
        dependency_table: table,
        error,
      });
      dependencies[key] = 0;
    } else {
      dependencies[key] = count || 0;
    }
  }

  dependencies.payments = 0;

  const { data: linkedInvoices, error: linkedInvoicesError } = await admin
    .from("invoices")
    .select("id")
    .eq("ra_bill_id", raBillId);

  if (linkedInvoicesError) {
    console.error("[RA Bill DELETE] linked invoice id lookup failed", {
      dependency_table: "invoices",
      error: linkedInvoicesError,
    });
  } else {
    const invoiceIds = (linkedInvoices || [])
      .map((invoice) => invoice.id)
      .filter(Boolean);

    if (invoiceIds.length > 0) {
      const { count: paymentCount, error: paymentError } = await admin
        .from("payments")
        .select("id", { count: "exact", head: true })
        .in("invoice_id", invoiceIds);

      if (paymentError) {
        console.error("[RA Bill DELETE] linked payment lookup failed", {
          dependency_table: "payments",
          error: paymentError,
        });
      } else {
        dependencies.payments = paymentCount || 0;
      }
    }
  }

  if (
    dependencies.invoices > 0 ||
    dependencies.debit_notes > 0 ||
    dependencies.payments > 0
  ) {
    return NextResponse.json(
      {
        error: "Cannot delete RA Bill because linked records exist.",
        dependencies,
      },
      { status: 409 }
    );
  }

  let documents: any[] = [];
  const { data: documentData, error: documentsError } = await admin
    .from("ra_bill_documents")
    .select("*")
    .eq("ra_bill_id", raBillId);

  if (documentsError) {
    if (isMissingRelationError(documentsError)) {
      documents = [];
    } else {
      return fail("fetch_related_documents", documentsError);
    }
  } else {
    documents = documentData || [];
  }

  const filePaths = Array.from(
    new Set(
      documents
        .map(documentStoragePath)
        .filter(Boolean)
    )
  );

  const audit = await insertDeleteAudit(admin, auth.user, {
    organizationId: raBill.organization_id,
    moduleCode: MODULE_CODE,
    documentType: "RA Bill",
    documentId: raBill.id,
    documentNumber: raBill.ra_number,
    deletionReason,
    recordSnapshot: raBill,
    relatedSnapshot: {
      ra_bill_documents: documents,
    },
    fileSnapshot: {
      bucket: DOCUMENT_BUCKET,
      paths: filePaths,
    },
  }).catch((error) => ({ error }));

  if ("error" in audit) {
    return fail("insert_audit", audit.error);
  }

  if (filePaths.length > 0) {
    const { error: storageError } = await admin.storage
      .from(DOCUMENT_BUCKET)
      .remove(filePaths);

    if (storageError) {
      return fail("delete_storage_files", storageError);
    }
  }

  if (documents.length > 0) {
    const { error: documentDeleteError } = await admin
      .from("ra_bill_documents")
      .delete()
      .eq("ra_bill_id", raBillId);

    if (documentDeleteError) {
      return fail("delete_document_rows", documentDeleteError);
    }
  }

  const { error: deleteError } = await admin
    .from("ra_bills")
    .delete()
    .eq("id", raBillId);

  if (deleteError) {
    return fail("delete_ra_bill", deleteError);
  }

  return NextResponse.json({
    deleted: true,
    audit_logged: true,
    deleted_storage_files: filePaths.length,
    approved_delete: isApprovedRABill,
  });
}
