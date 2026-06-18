import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  insertDeleteAudit,
  requireDeletePermission,
} from "@/lib/serverDeleteAudit";

const DOCUMENT_BUCKET = "debit-note-documents";
const MODULE_CODE = "debit_notes";

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

  if (!token) return { error: "Missing auth token.", status: 401 };

  const authClient = createClient(supabaseUrl, anonKey);
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser(token);

  if (error) throw error;
  if (!user) return { error: "User not found.", status: 401 };

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
    haystack.includes("debit_notes_unique_number_per_org")
  ) {
    return "Debit Note number already exists.";
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

  if (contentType.includes("application/x-www-form-urlencoded")) {
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

function logDebitNoteDeleteError(step: string, error: any) {
  console.error("[Debit Note DELETE]", step, {
    message: error?.message,
    code: error?.code,
    details: error?.details,
    hint: error?.hint,
    error,
  });
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

async function cleanupDebitNote(
  admin: ReturnType<typeof adminClient>,
  debitNoteId?: string,
  uploadedPaths: string[] = []
) {
  if (uploadedPaths.length > 0) {
    await admin.storage.from(DOCUMENT_BUCKET).remove(uploadedPaths);
  }

  if (debitNoteId) {
    await admin
      .from("debit_note_documents")
      .delete()
      .eq("debit_note_id", debitNoteId);
    await admin.from("debit_notes").delete().eq("id", debitNoteId);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireUser(request);

    if ("error" in auth) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.status }
      );
    }

    const formData = await request.formData();
    const workOrderId = String(formData.get("work_order_id") || "").trim();
    const vendorId = String(formData.get("vendor_id") || "").trim();
    const raBillId = String(formData.get("ra_bill_id") || "").trim();
    const debitNoteNumber = String(
      formData.get("debit_note_number") || ""
    ).trim();
    const debitNoteDate = String(formData.get("debit_note_date") || "").trim();
    const debitNoteType = String(formData.get("debit_note_type") || "").trim();
    const reason = String(formData.get("reason") || "").trim();
    const grossAmount = Number(formData.get("gross_amount") || 0);
    const files = formData
      .getAll("attachments")
      .filter((item): item is File => item instanceof File && item.size > 0);

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

    if (!debitNoteNumber) {
      return NextResponse.json(
        { error: "Debit Note Number is required." },
        { status: 400 }
      );
    }

    if (!debitNoteDate) {
      return NextResponse.json(
        { error: "Debit Note Date is required." },
        { status: 400 }
      );
    }

    if (!debitNoteType) {
      return NextResponse.json(
        { error: "Debit Note Type is required." },
        { status: 400 }
      );
    }

    if (!Number.isFinite(grossAmount) || grossAmount <= 0) {
      return NextResponse.json(
        { error: "Gross amount is required." },
        { status: 400 }
      );
    }

    if (!reason) {
      return NextResponse.json(
        { error: "Reason is required." },
        { status: 400 }
      );
    }

    if (files.length === 0) {
      return NextResponse.json(
        { error: "At least one Debit Note attachment is required." },
        { status: 400 }
      );
    }

    const admin = adminClient();

    const { data: workOrder, error: workOrderError } = await admin
      .from("work_orders")
      .select("id, organization_id")
      .eq("id", workOrderId)
      .maybeSingle();

    if (workOrderError) throw workOrderError;

    if (!workOrder) {
      return NextResponse.json(
        { error: "Selected Work Order was not found." },
        { status: 404 }
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

    const { data: existingDebitNotes, error: duplicateError } = await admin
      .from("debit_notes")
      .select("id, debit_note_number, approval_status")
      .eq("organization_id", workOrder.organization_id);

    if (duplicateError) throw duplicateError;

    const duplicate = (existingDebitNotes || []).find(
  (note) =>
    normalized(String(note.debit_note_number || "")) ===
      normalized(debitNoteNumber) &&
    normalized(String(note.approval_status || "")) !== "rejected"
);

    if (duplicate) {
      return NextResponse.json(
        { error: "Debit Note number already exists." },
        { status: 409 }
      );
    }

    const userEmail = auth.user.email || "platform.owner@mrc.local";
    const userName =
      auth.user.user_metadata?.full_name ||
      auth.user.user_metadata?.name ||
      userEmail ||
      "Platform Owner";

    const roundedGross = Math.round(grossAmount);

    let debitNoteId = "";
    const uploadedPaths: string[] = [];

    try {
      const { data: debitNote, error: debitNoteError } = await admin
        .from("debit_notes")
        .insert({
          organization_id: workOrder.organization_id,
          work_order_id: workOrderId,
          ra_bill_id: raBillId || null,
          vendor_id: vendorId,
          debit_note_number: debitNoteNumber,
          debit_note_date: debitNoteDate,
          debit_note_type: debitNoteType,
          reason,
          gross_amount: roundedGross,
          gst_amount: 0,
          total_amount: roundedGross,
          status: "Draft",
          approval_status: "Pending",
          created_by_name: userName,
          created_by_email: userEmail,
        })
        .select("id")
        .single();

      if (debitNoteError) throw debitNoteError;

      debitNoteId = debitNote.id;

      for (const file of files) {
        const filePath = `${workOrder.organization_id}/debit-notes/${
          debitNote.id
        }/${Date.now()}_${safeFileName(file.name)}`;

        const { error: uploadError } = await admin.storage
          .from(DOCUMENT_BUCKET)
          .upload(filePath, file, { upsert: false });

        if (uploadError) throw uploadError;

        uploadedPaths.push(filePath);

        const { error: documentError } = await admin
          .from("debit_note_documents")
          .insert({
            organization_id: workOrder.organization_id,
            debit_note_id: debitNote.id,
            file_name: file.name,
            file_url: filePath,
          });

        if (documentError) throw documentError;
      }

      return NextResponse.json({ id: debitNote.id });
    } catch (error) {
      await cleanupDebitNote(admin, debitNoteId, uploadedPaths);
      throw error;
    }
  } catch (error: any) {
    const friendlyDuplicate = duplicateErrorMessage(error);

    if (friendlyDuplicate) {
      return NextResponse.json({ error: friendlyDuplicate }, { status: 409 });
    }

    return NextResponse.json(
      { error: error.message || "Failed to create Debit Note." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const fail = (step: string, details: any, status = 500) => {
    logDebitNoteDeleteError(step, details);

    return NextResponse.json(
      {
        error: "Debit Note delete failed",
        step,
        details,
      },
      { status }
    );
  };

  let debitNoteId = "";
  let deletionReason = "";

  try {
    const { searchParams } = new URL(request.url);
    debitNoteId = searchParams.get("debit_note_id")?.trim() || "";
    deletionReason = await readDeletionReason(request);
  } catch (error) {
    return fail("parse_request", error);
  }

  if (!debitNoteId) {
    return fail("parse_request", { message: "debit_note_id is required." }, 400);
  }

  if (deletionReason.length < 10) {
    return fail(
      "parse_request",
      { message: "Deletion reason must be at least 10 characters." },
      400
    );
  }

  const auth = await requireUser(request).catch((error) => ({
    error,
    status: 401,
  }));

  if ("error" in auth) {
    return fail("permission_check", auth.error, auth.status);
  }

  let admin: ReturnType<typeof adminClient>;

  try {
    admin = adminClient();
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

  const { data: debitNote, error: debitNoteError } = await admin
    .from("debit_notes")
    .select("*")
    .eq("id", debitNoteId)
    .maybeSingle();

  if (debitNoteError) {
    return fail("fetch_debit_note", debitNoteError);
  }

  if (!debitNote) {
    return fail("fetch_debit_note", { message: "Debit Note was not found." }, 404);
  }

  const normalizedApprovalStatus = String(
    debitNote.approval_status || debitNote.status || ""
  )
    .trim()
    .toLowerCase();
  const isApprovedDebitNote = normalizedApprovalStatus === "approved";

  let documents: any[] = [];
  const { data: documentData, error: documentsError } = await admin
    .from("debit_note_documents")
    .select("*")
    .eq("debit_note_id", debitNoteId);

  if (documentsError) {
    if (isMissingRelationError(documentsError)) {
      documents = [];
    } else {
      return fail("fetch_related_documents", documentsError);
    }
  } else {
    documents = documentData || [];
  }

  const paths = Array.from(
    new Set(
      documents
        .map((document) => normalizeStoragePath(document.file_url))
        .filter(Boolean)
    )
  );

  const audit = await insertDeleteAudit(admin, auth.user, {
    organizationId: debitNote.organization_id,
    moduleCode: MODULE_CODE,
    documentType: "Debit Note",
    documentId: debitNote.id,
    documentNumber: debitNote.debit_note_number,
    deletionReason,
    recordSnapshot: debitNote,
    relatedSnapshot: {
      debit_note_documents: documents,
    },
    fileSnapshot: {
      bucket: DOCUMENT_BUCKET,
      paths,
    },
  }).catch((error) => ({ error }));

  if ("error" in audit) {
    return fail("insert_audit", audit.error);
  }

  if (paths.length > 0) {
    const { error: storageError } = await admin.storage
      .from(DOCUMENT_BUCKET)
      .remove(paths);

    if (storageError) {
      return fail("delete_storage_files", storageError);
    }
  }

  if (documents.length > 0) {
    const { error: documentDeleteError } = await admin
      .from("debit_note_documents")
      .delete()
      .eq("debit_note_id", debitNoteId);

    if (documentDeleteError) {
      return fail("delete_document_rows", documentDeleteError);
    }
  }

  const { error: debitNoteDeleteError } = await admin
    .from("debit_notes")
    .delete()
    .eq("id", debitNoteId);

  if (debitNoteDeleteError) {
    return fail("delete_debit_note", debitNoteDeleteError);
  }

  return NextResponse.json({
    deleted: true,
    deleted_storage_files: paths.length,
    audited: true,
    approved_delete: isApprovedDebitNote,
  });
}
