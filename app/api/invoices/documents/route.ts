import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAnyPermission } from "@/lib/serverPermissions";
import {
  loadAllowedWorkOrderIds,
  loadApprovalScope,
} from "@/app/api/approvals/_shared";

const DOCUMENT_BUCKET = "invoice-documents";

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
      { moduleCode: "invoices", actionCode: "view" },
      { moduleCode: "itc_claims", actionCode: "view" },
      { moduleCode: "itc_claims", actionCode: "approve" },
    ]);

    if ("response" in auth) {
      return auth.response;
    }

    const { searchParams } = new URL(request.url);
    const singleId = searchParams.get("invoice_id")?.trim();
    const ids = (searchParams.get("invoice_ids") || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    const invoiceIds = singleId ? [singleId] : Array.from(new Set(ids));

    if (invoiceIds.length === 0) {
      return NextResponse.json(
        { error: "invoice_id or invoice_ids is required." },
        { status: 400 }
      );
    }

    const admin = adminClient();
    const { data: invoices, error: invoicesError } = await admin
      .from("invoices")
      .select("id, organization_id, work_order_id")
      .in("id", invoiceIds);

    if (invoicesError) throw invoicesError;

    if ((invoices || []).length !== invoiceIds.length) {
      return NextResponse.json(
        { error: "One or more invoices were not found." },
        { status: 404 }
      );
    }

    const { organizationScope, assignments } = await loadApprovalScope(admin, auth);
    const allowedWorkOrderIds = await loadAllowedWorkOrderIds(
      admin,
      organizationScope,
      assignments,
    );

    if (
      allowedWorkOrderIds !== null &&
      (invoices || []).some(
        (invoice) =>
          !invoice.work_order_id ||
          !allowedWorkOrderIds.includes(invoice.work_order_id),
      )
    ) {
      return NextResponse.json(
        { error: "You do not have access to this Work Order scope." },
        { status: 403 }
      );
    }

    const { data: documents, error } = await admin
      .from("invoice_documents")
      .select("id, invoice_id, file_name, file_url, uploaded_at")
      .in("invoice_id", invoiceIds)
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

    return NextResponse.json({ documents: signedDocuments });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load invoice documents." },
      { status: 500 }
    );
  }
}
