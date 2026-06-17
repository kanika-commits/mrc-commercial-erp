import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const DOCUMENT_BUCKET = "work-order-documents";

function isGoogleDriveUrl(value: string | null | undefined) {
  return String(value || "").trim().startsWith("https://drive.google.com/");
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

function normalizeStoragePath(document: any) {
  const explicitPath = String(document.file_path || "").trim();
  if (explicitPath) return explicitPath.replace(/^\/+/, "");

  const raw = String(document.file_url || "").trim();
  if (!raw) return "";
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

export async function GET(request: Request) {
  try {
    const auth = await requireUser(request);

    if ("error" in auth) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.status }
      );
    }

    const { searchParams } = new URL(request.url);
    const singleId = searchParams.get("work_order_id")?.trim();
    const ids = (searchParams.get("work_order_ids") || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    const workOrderIds = singleId ? [singleId] : Array.from(new Set(ids));

    if (workOrderIds.length === 0) {
      return NextResponse.json(
        { error: "work_order_id or work_order_ids is required." },
        { status: 400 }
      );
    }

    const admin = adminClient();
    const { data: documents, error } = await admin
      .from("work_order_documents")
      .select("id, organization_id, work_order_id, file_name, file_url, file_path, uploaded_at")
      .in("work_order_id", workOrderIds)
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

        const path = normalizeStoragePath(document);
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
          file_path: path || document.file_path,
          signed_url,
          signed_url_error,
        };
      })
    );

    return NextResponse.json({ documents: signedDocuments });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load Work Order documents." },
      { status: 500 }
    );
  }
}
