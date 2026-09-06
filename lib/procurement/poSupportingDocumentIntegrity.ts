const PACKAGE_MIMES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

export async function loadFrozenSupportingDocuments(admin: any, row: any) {
  const { data, error } = await admin
    .from("procurement_purchase_order_documents")
    .select("id, purchase_order_id, document_type, original_file_name, storage_bucket, storage_key, mime_type, size_bytes, status, sort_order, created_by_name, created_by_email, created_at")
    .eq("purchase_order_id", row.id)
    .eq("organization_id", row.organization_id)
    .eq("status", "active");
  if (error) throw error;
  const live = data || [];
  const manifest = row.status !== "draft" && Array.isArray(row.supporting_documents_manifest) ? row.supporting_documents_manifest : null;
  if (!manifest) return { documents: live.sort(compareDocuments), manifest: null, integrityError: null };
  const documents = manifest.map((entry: any) => {
    const document = live.find((candidate: any) => candidate.id === entry.document_id);
    if (!document || !document.storage_bucket || !document.storage_key) {
      return { ...entry, id: entry.document_id, original_file_name: entry.original_file_name, integrity_error: `Supporting document "${entry.original_file_name || "Unnamed document"}" is unavailable. This submitted Purchase Order package cannot be fully reviewed.` };
    }
    return { ...document, ...entry, manifest_order: entry.manifest_order };
  });
  for (const document of documents) {
    if (document.integrity_error || !isPackageMime(document.mime_type)) continue;
    const downloaded = await admin.storage.from(document.storage_bucket).download(document.storage_key);
    if (downloaded.error || !downloaded.data) {
      document.integrity_error = `Supporting document "${document.original_file_name || "Unnamed document"}" could not be retrieved. This submitted Purchase Order package cannot be fully reviewed.`;
    }
  }
  const invalid = documents.find((document: any) => document.integrity_error);
  return { documents, manifest, integrityError: invalid?.integrity_error || null };
}

export function compareDocuments(a: any, b: any) {
  return (a.sort_order ?? Number.MAX_SAFE_INTEGER) - (b.sort_order ?? Number.MAX_SAFE_INTEGER)
    || String(a.created_at).localeCompare(String(b.created_at))
    || String(a.id).localeCompare(String(b.id));
}

export function isPackageMime(mime: unknown) { return PACKAGE_MIMES.has(String(mime || "")); }
