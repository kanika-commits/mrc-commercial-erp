import { NextResponse } from "next/server";
import { audit, jsonError, loadScopedLabourImportBatch, requireLabourPermission } from "@/app/api/labour/_shared";
import { normalizeLabourImportFilename } from "@/lib/labour/import";
import { extractGoogleDriveFolderId, googleDriveFolderUrl, listDriveFolderFiles } from "@/src/lib/googleDrive";

const DOCUMENT_FOLDER_KEY = "__document_folder";
const DOCUMENT_FOLDER_SOURCE_KEY = "__document_folder_source";

function mappingObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function friendlyAccessError(message: string) {
  if (/valid google drive folder link/i.test(message)) return message;
  if (/document source could not be detected/i.test(message)) return message;
  return "ConstructIQ could not access this folder. Check that the folder is shared with the configured Drive integration and try again.";
}

export async function POST(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_workers", "import");
    if ("response" in access) return access.response;
    const payload = await request.json().catch(() => ({}));
    if (!payload.batch_id) return jsonError("Batch ID is required.");
    const batch = await loadScopedLabourImportBatch(access, payload.batch_id);
    if (!batch) return jsonError("Import batch not found.", 404);

    const currentMapping = mappingObject(batch.mapping);
    const source = mappingObject(currentMapping[DOCUMENT_FOLDER_SOURCE_KEY]);
    const folderUrl = String(payload.folder_url || source.folder_url || "").trim();
    if (!folderUrl) {
      return jsonError("The Google Drive document source could not be detected. Please use the latest Labour Import template.");
    }
    const folderId = extractGoogleDriveFolderId(folderUrl);
    if (!folderId) return jsonError("Enter a valid Google Drive folder link.");

    const detectedAt = new Date().toISOString();
    const detectedMapping = {
      ...currentMapping,
      [DOCUMENT_FOLDER_SOURCE_KEY]: {
        ...source,
        folder_url: folderUrl,
        folder_id: folderId,
        status: "detected",
        error: null,
      },
    };
    const { error: sourceError } = await access.admin
      .from("labour_import_batches")
      .update({ mapping: detectedMapping, updated_at: detectedAt })
      .eq("id", payload.batch_id);
    if (sourceError) throw sourceError;

    const folder = await listDriveFolderFiles({ folderId });
    const filenameCounts = new Map<string, number>();
    for (const file of folder.files || []) {
      const key = normalizeLabourImportFilename(file.file_name);
      if (key) filenameCounts.set(key, (filenameCounts.get(key) || 0) + 1);
    }
    const duplicate_filenames = Array.from(filenameCounts.entries()).filter(([, count]) => count > 1).map(([name]) => name);
    const documentFolder = {
      folder_id: folder.folder_id,
      folder_url: folder.folder_url || googleDriveFolderUrl(folderId),
      folder_name: folder.folder_name || "",
      verified_at: new Date().toISOString(),
      files: folder.files || [],
      duplicate_filenames,
      total_files: folder.files?.length || 0,
    };
    const nextMapping = {
      ...currentMapping,
      [DOCUMENT_FOLDER_SOURCE_KEY]: {
        ...source,
        folder_url: documentFolder.folder_url,
        folder_id: documentFolder.folder_id,
        status: "verified",
        verified_at: documentFolder.verified_at,
        error: null,
      },
      [DOCUMENT_FOLDER_KEY]: documentFolder,
    };
    const { error } = await access.admin.from("labour_import_batches").update({ mapping: nextMapping, updated_at: new Date().toISOString() }).eq("id", payload.batch_id);
    if (error) throw error;

    await audit(access, request, {
      moduleCode: "labour_import",
      action: "verify_document_folder",
      entityType: "labour_import_batch",
      recordId: payload.batch_id,
      organizationId: batch.organization_id,
      companyId: batch.selected_company_id,
      siteId: batch.selected_site_id,
      description: `Verified Labour Import document folder with ${documentFolder.total_files} file(s).`,
      importBatchId: payload.batch_id,
      newValues: { folder_id: folder.folder_id, total_files: documentFolder.total_files, duplicate_filenames },
    } as any);

    return NextResponse.json({ folder: documentFolder });
  } catch (error: any) {
    return jsonError(friendlyAccessError(error.message || ""), 500);
  }
}
