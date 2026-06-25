import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  insertDeleteAudit,
  requireDeletePermission,
} from "@/lib/serverDeleteAudit";
import { optimizeUploadFile } from "@/lib/fileOptimization";
import { uploadDriveFile } from "@/src/lib/googleDrive";
import { requirePermission } from "@/lib/serverPermissions";
import {
  isInOrganizationScope,
  loadActorOrganizationScope,
  loadOrganizationScopeForUser,
} from "@/lib/serverOrganizationScope";

const DOCUMENT_BUCKET = "invoice-documents";
const MODULE_CODE = "invoices";

function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

async function requireUser(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const token = request.headers.get("authorization")?.replace("Bearer ", "");

  if (!token) {
    return { error: "Missing auth token.", status: 401 };
  }

  const authClient = createClient(supabaseUrl, anonKey);
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser(token);

  if (error) throw error;

  if (!user) {
    return { error: "User not found.", status: 401 };
  }

  return { user };
}

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function normalized(value: string) {
  return value.trim().toLowerCase();
}

function duplicateErrorMessage(error: any) {
  const message = String(error?.message || "");
  const details = String(error?.details || "");
  const constraint = String(error?.constraint || "");
  const haystack = `${message} ${details} ${constraint}`.toLowerCase();

  if (
    error?.code === "23505" &&
    haystack.includes("invoices_unique_number_per_vendor_org")
  ) {
    return "Invoice number already exists for this vendor.";
  }

  return "";
}

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
  const fileUrl = String(document?.file_url || "").trim();

  if (isGoogleDriveUrl(fileUrl)) {
    return "";
  }

  return normalizeStoragePath(fileUrl);
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

  if (
    contentType.includes("multipart/form-data") ||
    contentType.includes("application/x-www-form-urlencoded")
  ) {
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

async function countDirectLinks(
  admin: ReturnType<typeof adminClient>,
  table: string,
  column: string,
  id: string
) {
  const { count, error } = await admin
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq(column, id);

  if (error) {
    if (isMissingRelationError(error)) return 0;
    throw error;
  }

  return count || 0;
}

async function cleanupInvoice(
  admin: ReturnType<typeof adminClient>,
  invoiceId?: string,
  uploadedPath?: string
) {
  if (uploadedPath) {
    await admin.storage.from(DOCUMENT_BUCKET).remove([uploadedPath]);
  }

  if (invoiceId) {
    await admin.from("invoice_documents").delete().eq("invoice_id", invoiceId);
    await admin.from("invoices").delete().eq("id", invoiceId);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requirePermission(request, MODULE_CODE, "add");

    if ("response" in auth) {
      return auth.response;
    }

    const formData = await request.formData();
    const workOrderId = String(formData.get("work_order_id") || "").trim();
    const vendorId = String(formData.get("vendor_id") || "").trim();
    const invoiceNumber = String(formData.get("invoice_number") || "").trim();
    const invoiceDate = String(formData.get("invoice_date") || "").trim();
    const taxableAmount = Number(formData.get("taxable_amount") || 0);
    const gstRate = Number(formData.get("gst_rate") || 0);
    const gstAmount = Number(formData.get("gst_amount") || 0);
    const invoiceAmount = Number(formData.get("invoice_amount") || 0);
    const remarks = String(formData.get("remarks") || "").trim();
    const file = formData.get("invoice_file");

    if (!workOrderId) {
      return NextResponse.json(
        { error: "Work Order is required." },
        { status: 400 }
      );
    }

    if (!vendorId) {
      return NextResponse.json(
        { error: "Vendor is required." },
        { status: 400 }
      );
    }

    if (!invoiceNumber) {
      return NextResponse.json(
        { error: "Vendor Invoice Number is required." },
        { status: 400 }
      );
    }

    if (!invoiceDate) {
      return NextResponse.json(
        { error: "Invoice Date is required." },
        { status: 400 }
      );
    }

    if (!Number.isFinite(taxableAmount) || taxableAmount <= 0) {
      return NextResponse.json(
        { error: "Taxable amount is required." },
        { status: 400 }
      );
    }

    if (!Number.isFinite(gstRate) || gstRate < 0) {
      return NextResponse.json(
        { error: "GST rate is required." },
        { status: 400 }
      );
    }

    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json(
        { error: "Invoice PDF is required." },
        { status: 400 }
      );
    }

    if (file.type && file.type !== "application/pdf") {
      return NextResponse.json(
        { error: "Only PDF file is allowed for invoice." },
        { status: 400 }
      );
    }

    const admin = adminClient();

    const { data: workOrder, error: workOrderError } = await admin
      .from("work_orders")
      .select("id, organization_id, status, approval_status")
      .eq("id", workOrderId)
      .maybeSingle();

    if (workOrderError) throw workOrderError;

    if (!workOrder) {
      return NextResponse.json(
        { error: "Selected Work Order was not found." },
        { status: 404 }
      );
    }

    const workOrderStatus = String(workOrder.status || "").trim().toLowerCase();
    const workOrderApprovalStatus = String(workOrder.approval_status || "")
      .trim()
      .toLowerCase();

    if (
      workOrderStatus !== "active" ||
      !["pending", "approved"].includes(workOrderApprovalStatus)
    ) {
      return NextResponse.json(
        { error: "This Work Order is suspended and cannot accept new transactions." },
        { status: 400 }
      );
    }

    const organizationScope = await loadActorOrganizationScope(admin, auth);

    if (!isInOrganizationScope(organizationScope, workOrder.organization_id)) {
      return NextResponse.json(
        { error: "You do not have access to this organization." },
        { status: 403 }
      );
    }

    const { data: vendorLink, error: vendorLinkError } = await admin
      .from("work_order_vendors")
      .select("id")
      .eq("work_order_id", workOrderId)
      .eq("vendor_id", vendorId)
      .maybeSingle();

    if (vendorLinkError) throw vendorLinkError;

    if (!vendorLink) {
      return NextResponse.json(
        { error: "Selected vendor is not linked to this Work Order." },
        { status: 400 }
      );
    }

    const { data: existingInvoices, error: duplicateError } = await admin
      .from("invoices")
      .select("id, invoice_number, approval_status")
      .eq("organization_id", workOrder.organization_id)
      .eq("vendor_id", vendorId);

    if (duplicateError) throw duplicateError;

   const duplicate = (existingInvoices || []).find(
  (invoice) =>
    normalized(String(invoice.invoice_number || "")) ===
      normalized(invoiceNumber) &&
    normalized(String(invoice.approval_status || "")) !== "rejected"
);

    if (duplicate) {
      return NextResponse.json(
        { error: "Invoice number already exists for this vendor." },
        { status: 409 }
      );
    }

    const userEmail = auth.user.email || "platform.owner@mrc.local";
    const userName =
      auth.user.user_metadata?.full_name ||
      auth.user.user_metadata?.name ||
      userEmail ||
      "Platform Owner";

    const roundedTaxable = Math.round(taxableAmount);
    const roundedGst = Number.isFinite(gstAmount)
      ? Math.round(gstAmount)
      : Math.round((roundedTaxable * gstRate) / 100);
    const roundedInvoiceAmount = Number.isFinite(invoiceAmount)
      ? Math.round(invoiceAmount)
      : roundedTaxable + roundedGst;

    let invoiceId = "";
    let uploadedPath = "";

    try {
      const { data: invoice, error: invoiceError } = await admin
        .from("invoices")
        .insert({
          organization_id: workOrder.organization_id,
          work_order_id: workOrderId,
          vendor_id: vendorId,
          invoice_number: invoiceNumber,
          invoice_date: invoiceDate,
          taxable_amount: roundedTaxable,
          gst_rate: Number.isFinite(gstRate) ? gstRate : 0,
          gst_amount: roundedGst,
          invoice_amount: roundedInvoiceAmount,
          status: "Submitted",
          approval_status: "Pending",
          itc_status: "Pending",
          remarks: remarks || null,
          created_by_name: userName,
          created_by_email: userEmail,
        })
        .select("id")
        .single();

      if (invoiceError) throw invoiceError;

      invoiceId = invoice.id;

      const fileBuffer = Buffer.from(await file.arrayBuffer());
      const optimizedFile = await optimizeUploadFile(
        fileBuffer,
        file.type || "application/octet-stream",
        file.name
      );
      const filePath = `${workOrder.organization_id}/pending/${invoice.id}/${Date.now()}-${safeFileName(
        file.name
      )}`;

      const { error: uploadError } = await admin.storage
        .from(DOCUMENT_BUCKET)
        .upload(filePath, optimizedFile.buffer, {
          contentType: optimizedFile.mimeType || "application/octet-stream",
          upsert: false,
        });

      if (uploadError) throw uploadError;

      uploadedPath = filePath;

      const { error: documentError } = await admin
        .from("invoice_documents")
        .insert({
          organization_id: workOrder.organization_id,
          invoice_id: invoice.id,
          file_name: file.name,
          file_url: filePath,
        });

      if (documentError) throw documentError;

      return NextResponse.json({ id: invoice.id });
    } catch (error) {
      await cleanupInvoice(admin, invoiceId, uploadedPath);
      throw error;
    }
  } catch (error: any) {
    const friendlyDuplicate = duplicateErrorMessage(error);

    if (friendlyDuplicate) {
      return NextResponse.json({ error: friendlyDuplicate }, { status: 409 });
    }

    return NextResponse.json(
      { error: error.message || "Failed to create invoice." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  const fail = (message: string, status = 500, details?: any) => {
    if (details) {
      console.error("[Invoice APPROVAL]", message, details);
    }

    return NextResponse.json({ error: message, details }, { status });
  };

  const { searchParams } = new URL(request.url);
  const invoiceId = searchParams.get("invoice_id")?.trim() || "";

  if (!invoiceId) {
    return fail("invoice_id is required.", 400);
  }

  const { action, rejectionReason } = await readApprovalAction(request);
  const normalizedAction = action.toLowerCase();

  if (["claimed", "itc_claimed"].includes(normalizedAction)) {
    const auth = await requirePermission(request, "itc_claims", "approve");

    if ("response" in auth) {
      return auth.response;
    }

    const admin = adminClient();
    const { data: invoice, error: invoiceError } = await admin
      .from("invoices")
      .select("id, organization_id")
      .eq("id", invoiceId)
      .maybeSingle();

    if (invoiceError) {
      return fail("Failed to load invoice.", 500, invoiceError);
    }

    if (!invoice) {
      return fail("Invoice was not found.", 404);
    }

    const organizationScope = await loadActorOrganizationScope(admin, auth);

    if (!isInOrganizationScope(organizationScope, invoice.organization_id)) {
      return fail("You do not have access to this organization.", 403);
    }

    const userEmail = auth.user.email || "";
    const userName =
      auth.user.user_metadata?.full_name ||
      auth.user.user_metadata?.name ||
      userEmail ||
      "HO User";

    const { error: itcError } = await admin
      .from("invoices")
      .update({
        itc_status: "Claimed",
        itc_claimed_by_name: userName,
        itc_claimed_by_email: userEmail,
        itc_claimed_at: new Date().toISOString(),
      })
      .eq("id", invoiceId);

    if (itcError) {
      return fail("Failed to claim ITC.", 500, itcError);
    }

    return NextResponse.json({ itc_claimed: true });
  }

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
  );

  if ("response" in auth) {
    return auth.response;
  }

  const admin = adminClient();
  const { data: invoice, error: invoiceError } = await admin
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .maybeSingle();

  if (invoiceError) {
    return fail("Failed to load invoice.", 500, invoiceError);
  }

  if (!invoice) {
    return fail("Invoice was not found.", 404);
  }

  const organizationScope = await loadActorOrganizationScope(admin, auth);

  if (!isInOrganizationScope(organizationScope, invoice.organization_id)) {
    return fail("You do not have access to this organization.", 403);
  }

  const { data: documents, error: documentsError } = await admin
    .from("invoice_documents")
    .select("*")
    .eq("invoice_id", invoiceId);

  if (documentsError) {
    return fail("Failed to load invoice documents.", 500, documentsError);
  }

  const userEmail = auth.user.email || "";
  const userName =
    auth.user.user_metadata?.full_name ||
    auth.user.user_metadata?.name ||
    userEmail ||
    "HO User";
  const now = new Date().toISOString();

  if (normalizedAction === "approved") {
    const { data: driveFolder, error: driveFolderError } = await admin
      .from("work_order_drive_folders")
      .select("invoices_folder_id")
      .eq("work_order_id", invoice.work_order_id)
      .maybeSingle();

    if (driveFolderError) {
      return fail("Failed to load Work Order Drive folder.", 500, driveFolderError);
    }

    if (!driveFolder?.invoices_folder_id) {
      return fail("Work Order Google Drive Invoices folder was not found.", 400);
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
        return fail("Failed to read temporary invoice attachment.", 500, downloadError);
      }

      const fileBuffer = Buffer.from(await fileBlob.arrayBuffer());
      const fileName = document.file_name || "invoice-attachment";
      const optimizedFile = await optimizeUploadFile(
        fileBuffer,
        mimeTypeFromFileName(fileName),
        fileName
      );
      const driveFile = await uploadDriveFile({
        targetFolderId: driveFolder.invoices_folder_id,
        fileName,
        mimeType: optimizedFile.mimeType || mimeTypeFromFileName(fileName),
        base64: optimizedFile.buffer.toString("base64"),
      });

      const { error: documentUpdateError } = await admin
        .from("invoice_documents")
        .update({
          file_name: driveFile.file_name || fileName,
          file_url: driveFile.file_url,
        })
        .eq("id", document.id);

      if (documentUpdateError) {
        return fail(
          "Failed to update invoice document after Google Drive upload.",
          500,
          documentUpdateError
        );
      }

      const { error: storageDeleteError } = await admin.storage
        .from(DOCUMENT_BUCKET)
        .remove([tempPath]);

      if (storageDeleteError) {
        return fail(
          "Failed to delete temporary invoice attachment after Google Drive upload.",
          500,
          storageDeleteError
        );
      }
    }

    const { error: approvalError } = await admin
      .from("invoices")
      .update({
        approval_status: "Approved",
        status: "Approved",
      })
      .eq("id", invoiceId);

    if (approvalError) {
      return fail("Failed to approve invoice.", 500, approvalError);
    }

    return NextResponse.json({ approved: true });
  }

  const tempPaths = Array.from(
    new Set((documents || []).map(documentStoragePath).filter(Boolean))
  );
  const driveDocuments = (documents || []).filter((document) =>
    isGoogleDriveUrl(document.file_url)
  );

  const { error: rejectionUpdateError } = await admin
    .from("invoices")
    .update({
      approval_status: "Rejected",
      status: "Rejected",
      itc_rejected_by_name: userName,
      itc_rejected_by_email: userEmail,
      itc_rejected_at: now,
      itc_rejection_reason: rejectionReason,
    })
    .eq("id", invoiceId);

  if (rejectionUpdateError) {
    return fail("Failed to save invoice rejection reason.", 500, rejectionUpdateError);
  }

  if (tempPaths.length > 0) {
    const { error: storageDeleteError } = await admin.storage
      .from(DOCUMENT_BUCKET)
      .remove(tempPaths);

    if (storageDeleteError) {
      return fail("Failed to delete temporary invoice attachments.", 500, storageDeleteError);
    }
  }

  if (driveDocuments.length > 0) {
    console.warn(
      "[Invoice REJECTION] Google Drive deletion helper is not available; Drive files were not deleted.",
      {
        invoice_id: invoiceId,
        drive_files: driveDocuments.map((document) => ({
          id: document.id,
          file_name: document.file_name,
          file_url: document.file_url,
        })),
      }
    );
  }

  const { error: documentDeleteError } = await admin
    .from("invoice_documents")
    .delete()
    .eq("invoice_id", invoiceId);

  if (documentDeleteError) {
    return fail("Failed to delete rejected invoice document rows.", 500, documentDeleteError);
  }

  const { error: invoiceDeleteError } = await admin
    .from("invoices")
    .delete()
    .eq("id", invoiceId);

  if (invoiceDeleteError) {
    return fail("Failed to delete rejected invoice.", 500, invoiceDeleteError);
  }

  return NextResponse.json({
    rejected: true,
    deleted: true,
    drive_files_not_deleted: driveDocuments.length,
  });
}

export async function DELETE(request: Request) {
  try {
    const auth = await requireUser(request);

    if ("error" in auth) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.status }
      );
    }

    const { searchParams } = new URL(request.url);
    const invoiceId = searchParams.get("invoice_id")?.trim();
    const deletionReason = await readDeletionReason(request);

    if (!invoiceId) {
      return NextResponse.json(
        { error: "invoice_id is required." },
        { status: 400 }
      );
    }

    if (deletionReason.length < 10) {
      return NextResponse.json(
        { error: "Deletion reason must be at least 10 characters." },
        { status: 400 }
      );
    }

    const admin = adminClient();
    const permission = await requireDeletePermission(
      admin,
      auth.user,
      MODULE_CODE
    );

    if ("error" in permission) {
      return NextResponse.json(
        { error: permission.error },
        { status: permission.status }
      );
    }

    const { data: invoice, error: invoiceError } = await admin
      .from("invoices")
      .select("*")
      .eq("id", invoiceId)
      .maybeSingle();

    if (invoiceError) throw invoiceError;

    if (!invoice) {
      return NextResponse.json(
        { error: "Invoice was not found." },
        { status: 404 }
      );
    }

    const organizationScope = await loadOrganizationScopeForUser(
      admin,
      auth.user.id
    );

    if (!isInOrganizationScope(organizationScope, invoice.organization_id)) {
      return NextResponse.json(
        { error: "You do not have access to this organization." },
        { status: 403 }
      );
    }

    const paymentCount = await countDirectLinks(
      admin,
      "payments",
      "invoice_id",
      invoiceId
    );

    if (paymentCount > 0) {
      return NextResponse.json(
        {
          error: "Cannot delete Invoice because linked payments exist.",
          dependencies: {
            payments: paymentCount,
          },
        },
        { status: 409 }
      );
    }

    const { data: documents, error: documentsError } = await admin
      .from("invoice_documents")
      .select("*")
      .eq("invoice_id", invoiceId);

    if (documentsError) throw documentsError;

    const paths = Array.from(
      new Set(
        (documents || [])
          .map(documentStoragePath)
          .filter(Boolean)
      )
    );

    await insertDeleteAudit(admin, auth.user, {
      organizationId: invoice.organization_id,
      moduleCode: MODULE_CODE,
      documentType: "Invoice",
      documentId: invoice.id,
      documentNumber: invoice.invoice_number,
      deletionReason,
      recordSnapshot: invoice,
      relatedSnapshot: {
        invoice_documents: documents || [],
      },
      fileSnapshot: {
        bucket: DOCUMENT_BUCKET,
        paths,
      },
    });

    if (paths.length > 0) {
      const { error: storageError } = await admin.storage
        .from(DOCUMENT_BUCKET)
        .remove(paths);

      if (storageError) throw storageError;
    }

    const { error: documentDeleteError } = await admin
      .from("invoice_documents")
      .delete()
      .eq("invoice_id", invoiceId);

    if (documentDeleteError) throw documentDeleteError;

    const { error: deleteError } = await admin
      .from("invoices")
      .delete()
      .eq("id", invoiceId);

    if (deleteError) throw deleteError;

    return NextResponse.json({
      deleted: true,
      deleted_storage_files: paths.length,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to delete invoice." },
      { status: 500 }
    );
  }
}
