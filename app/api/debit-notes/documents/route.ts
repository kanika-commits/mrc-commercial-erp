import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAnyPermission } from "@/lib/serverPermissions";
import {
  isInOrganizationScope,
  loadActorOrganizationScope,
} from "@/lib/serverOrganizationScope";
import {
  loadAllowedWorkOrderIds,
  loadApprovalScope,
} from "@/app/api/approvals/_shared";

const DOCUMENT_BUCKET = "debit-note-documents";

function isGoogleDriveUrl(value: string | null | undefined) {
  const url = String(value || "").trim();
  return (
    url.startsWith("https://drive.google.com/") ||
    url.startsWith("https://docs.google.com/")
  );
}

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

export async function GET(request: Request) {
  try {
    const auth = await requireAnyPermission(request, [
      { moduleCode: "debit_notes", actionCode: "view" },
      { moduleCode: "ra_approval", actionCode: "view" },
      { moduleCode: "ra_approval", actionCode: "approve" },
      { moduleCode: "ra_approval", actionCode: "reject" },
    ]);

    if ("response" in auth) {
      return auth.response;
    }

    const { searchParams } = new URL(request.url);
    const singleId = searchParams.get("debit_note_id")?.trim();
    const ids = (searchParams.get("debit_note_ids") || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    const debitNoteIds = singleId ? [singleId] : Array.from(new Set(ids));

    if (debitNoteIds.length === 0) {
      return NextResponse.json(
        { error: "debit_note_id or debit_note_ids is required." },
        { status: 400 }
      );
    }

    const admin = adminClient();
    const { data: debitNotes, error: debitNotesError } = await admin
      .from("debit_notes")
      .select("id, organization_id, work_order_id, company_id, site_id, source_purchase_order_id, source_purchase_order_documents")
      .in("id", debitNoteIds);

    if (debitNotesError) throw debitNotesError;

    if ((debitNotes || []).length !== debitNoteIds.length) {
      return NextResponse.json(
        { error: "One or more Debit Notes were not found." },
        { status: 404 }
      );
    }

    const organizationScope = await loadActorOrganizationScope(admin, auth);
    const outOfScope = (debitNotes || []).some(
      (debitNote) =>
        !isInOrganizationScope(organizationScope, debitNote.organization_id)
    );

    if (outOfScope) {
      return NextResponse.json(
        { error: "You do not have access to this organization." },
        { status: 403 }
      );
    }

    const recoveryNotes = (debitNotes || []).filter((note: any) => note.source_purchase_order_id);
    const sourceDocuments: any[] = [];
    for (const note of recoveryNotes) {
      const manifest = Array.isArray(note.source_purchase_order_documents) ? note.source_purchase_order_documents : [];
      if (!manifest.length) continue;
      const { data: poDocuments, error: poDocumentsError } = await admin
        .from("procurement_purchase_order_documents")
        .select("id,purchase_order_id,original_file_name,mime_type,storage_bucket,storage_key,created_at")
        .eq("purchase_order_id", note.source_purchase_order_id)
        .eq("organization_id", note.organization_id)
        .eq("status", "active")
        .in("id", manifest.map((entry: any) => String(entry.document_id || entry.id || "")).filter(Boolean));
      if (poDocumentsError) throw poDocumentsError;
      for (const document of poDocuments || []) {
        const entry = manifest.find((candidate: any) => String(candidate.document_id || candidate.id) === String(document.id));
        if (!entry) continue;
        let signed_url: string | null = null;
        let signed_url_error: string | null = null;
        if (document.storage_bucket && document.storage_key) {
          const signed = await admin.storage.from(document.storage_bucket).createSignedUrl(document.storage_key, 600);
          signed_url = signed.data?.signedUrl || null;
          signed_url_error = signed.error?.message || null;
        }
        sourceDocuments.push({ id: document.id, debit_note_id: note.id, source_purchase_order_id: note.source_purchase_order_id, file_name: document.original_file_name, mime_type: document.mime_type, uploaded_at: document.created_at, signed_url, signed_url_error, source: "purchase_order" });
      }
    }

    const { organizationScope: approvalOrganizationScope, assignments } =
      await loadApprovalScope(admin, auth);
    const allowedWorkOrderIds = await loadAllowedWorkOrderIds(
      admin,
      approvalOrganizationScope,
      assignments
    );

    if (
      allowedWorkOrderIds !== null &&
      (debitNotes || []).some(
        (debitNote) =>
          debitNote.work_order_id &&
          !allowedWorkOrderIds.includes(debitNote.work_order_id)
      )
    ) {
      return NextResponse.json(
        { error: "You do not have access to one or more Debit Note Work Orders." },
        { status: 403 }
      );
    }

    const { data: documents, error } = await admin
      .from("debit_note_documents")
      .select("id, debit_note_id, file_name, file_url, uploaded_at")
      .in("debit_note_id", debitNoteIds)
      .order("uploaded_at", { ascending: false });

    if (error) throw error;

    const signedDocuments = await Promise.all(
      (documents || []).map(async (document) => {
        if (isGoogleDriveUrl(document.file_url)) {
          return {
            ...document,
            signed_url: document.file_url,
            signed_url_error: null,
          };
        }

        const path = normalizeStoragePath(document.file_url);
        let signed_url: string | null = null;
        let signed_url_error: string | null = null;

        if (path) {
          const { data, error: signedError } = await admin.storage
            .from(DOCUMENT_BUCKET)
            .createSignedUrl(path, 60 * 10);

          signed_url = data?.signedUrl || null;
          signed_url_error = signedError?.message || null;
        }

        return {
          ...document,
          file_url: path || document.file_url,
          signed_url,
          signed_url_error,
        };
      })
    );

    return NextResponse.json({ documents: [...signedDocuments, ...sourceDocuments] });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load Debit Note documents." },
      { status: 500 }
    );
  }
}
