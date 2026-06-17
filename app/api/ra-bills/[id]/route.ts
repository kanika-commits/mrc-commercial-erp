import { NextResponse } from "next/server";
import {
  createServiceRoleClient,
  insertDeleteAudit,
  requireAuthenticatedUser,
  requireDeletePermission,
} from "@/lib/serverDeleteAudit";

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
        .map((document) => normalizeStoragePath(document.file_url))
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
