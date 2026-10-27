import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission } from "@/lib/serverPermissions";
import { loadActorOrganizationScope, isInOrganizationScope } from "@/lib/serverOrganizationScope";

function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!); }

export async function GET(request: Request) {
  const auth = await requirePermission(request, "credit_notes", "view");
  if ("response" in auth) return auth.response;
  const ids = (new URL(request.url).searchParams.get("credit_note_ids") || new URL(request.url).searchParams.get("credit_note_id") || "").split(",").map((id) => id.trim()).filter(Boolean);
  if (!ids.length) return NextResponse.json({ error: "credit_note_id or credit_note_ids is required." }, { status: 400 });
  const client = admin();
  const { data: notes, error: noteError } = await client.from("credit_notes").select("id, organization_id").in("id", ids);
  if (noteError) return NextResponse.json({ error: noteError.message }, { status: 500 });
  const scope = await loadActorOrganizationScope(client, auth);
  if ((notes || []).some((note: any) => !isInOrganizationScope(scope, note.organization_id))) return NextResponse.json({ error: "You do not have access to one or more Credit Notes." }, { status: 403 });
  const { data, error } = await client.from("credit_note_documents").select("id, credit_note_id, file_name, file_url, uploaded_at").in("credit_note_id", ids).order("uploaded_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const documents = await Promise.all((data || []).map(async (document: any) => {
    const path = String(document.file_url || "").replace(/^\/+/, "");
    if (!path || path.startsWith("http")) return { ...document, signed_url: document.file_url || null };
    const signed = await client.storage.from("credit-note-documents").createSignedUrl(path, 300);
    return { ...document, signed_url: signed.data?.signedUrl || null, signed_url_error: signed.error?.message || null };
  }));
  return NextResponse.json({ documents });
}
