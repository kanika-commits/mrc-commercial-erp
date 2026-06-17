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

function isMissingColumnError(error: any) {
  const message = String(error?.message || "").toLowerCase();
  return (
    error?.code === "42703" ||
    error?.code === "PGRST204" ||
    message.includes("could not find") ||
    message.includes("does not exist")
  );
}

async function countDirectLinks(
  admin: ReturnType<typeof createServiceRoleClient>,
  table: string,
  column: string,
  id: string
) {
  const { count, error } = await admin
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq(column, id);

  if (error) {
    if (isMissingColumnError(error)) return 0;
    throw error;
  }

  return count || 0;
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuthenticatedUser(request);

    if ("error" in auth) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.status }
      );
    }

    const { id } = await context.params;
    const raBillId = String(id || "").trim();
    const deletionReason = await readDeletionReason(request);

    if (!raBillId) {
      return NextResponse.json(
        { error: "RA Bill id is required." },
        { status: 400 }
      );
    }

    if (deletionReason.length < 10) {
      return NextResponse.json(
        { error: "Deletion reason must be at least 10 characters." },
        { status: 400 }
      );
    }

    const admin = createServiceRoleClient();
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

    const { data: raBill, error: raBillError } = await admin
      .from("ra_bills")
      .select("*")
      .eq("id", raBillId)
      .maybeSingle();

    if (raBillError) throw raBillError;

    if (!raBill) {
      return NextResponse.json(
        { error: "RA Bill was not found." },
        { status: 404 }
      );
    }

    const [invoiceCount, debitNoteCount, paymentCount] = await Promise.all([
      countDirectLinks(admin, "invoices", "ra_bill_id", raBillId),
      countDirectLinks(admin, "debit_notes", "ra_bill_id", raBillId),
      countDirectLinks(admin, "payments", "ra_bill_id", raBillId),
    ]);

    if (invoiceCount > 0 || debitNoteCount > 0 || paymentCount > 0) {
      return NextResponse.json(
        {
          error:
            "Cannot delete RA Bill because linked invoices/payments/debit notes exist.",
          dependencies: {
            invoices: invoiceCount,
            debit_notes: debitNoteCount,
            payments: paymentCount,
          },
        },
        { status: 409 }
      );
    }

    const { data: documents, error: documentsError } = await admin
      .from("ra_bill_documents")
      .select("*")
      .eq("ra_bill_id", raBillId);

    if (documentsError) throw documentsError;

    const filePaths = Array.from(
      new Set(
        (documents || [])
          .map((document) => normalizeStoragePath(document.file_url))
          .filter(Boolean)
      )
    );

    await insertDeleteAudit(admin, auth.user, {
      organizationId: raBill.organization_id,
      moduleCode: MODULE_CODE,
      documentType: "RA Bill",
      documentId: raBill.id,
      documentNumber: raBill.ra_number,
      deletionReason,
      recordSnapshot: raBill,
      relatedSnapshot: {
        ra_bill_documents: documents || [],
      },
      fileSnapshot: {
        bucket: DOCUMENT_BUCKET,
        paths: filePaths,
      },
    });

    if (filePaths.length > 0) {
      const { error: storageError } = await admin.storage
        .from(DOCUMENT_BUCKET)
        .remove(filePaths);

      if (storageError) throw storageError;
    }

    const { error: documentDeleteError } = await admin
      .from("ra_bill_documents")
      .delete()
      .eq("ra_bill_id", raBillId);

    if (documentDeleteError) throw documentDeleteError;

    const { error: deleteError } = await admin
      .from("ra_bills")
      .delete()
      .eq("id", raBillId);

    if (deleteError) throw deleteError;

    return NextResponse.json({
      deleted: true,
      audit_logged: true,
      deleted_storage_files: filePaths.length,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to delete RA Bill." },
      { status: 500 }
    );
  }
}

