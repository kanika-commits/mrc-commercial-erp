import { createDriveSubfolder, uploadDriveFile } from "@/src/lib/googleDrive";
import {
  type AdminClient,
  DOCUMENT_BUCKET,
  normalizeStoragePath,
} from "./_shared";

function folderUrl(folderId: string) {
  return `https://drive.google.com/drive/folders/${folderId}`;
}

function safeFolderName(value: string) {
  return String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|#%{}[\]^~`]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 140);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Unknown Drive sync error.");
}

async function markDriveSyncFailed(admin: AdminClient, claimId: string, error: unknown) {
  const message = errorMessage(error).slice(0, 2000);
  await admin
    .from("reimbursement_claims")
    .update({
      drive_sync_status: "failed",
      drive_sync_error: message,
      updated_at: new Date().toISOString(),
    })
    .eq("id", claimId);

  console.error("Reimbursement Drive sync failed", {
    claim_id: claimId,
    error: message,
  });
}

async function createNestedFolder(parentFolderId: string, folderName: string) {
  return createDriveSubfolder({
    parentFolderId,
    folderName,
  });
}

export async function syncApprovedReimbursementToDrive(
  admin: AdminClient,
  claim: Record<string, any>
) {
  try {
    const hrFolderId = process.env.GOOGLE_DRIVE_HR_FOLDER_ID;

    if (!hrFolderId) {
      throw new Error("Missing GOOGLE_DRIVE_HR_FOLDER_ID.");
    }

    await admin
      .from("reimbursement_claims")
      .update({
        drive_sync_status: "syncing",
        drive_sync_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", claim.id);

    const { data: employee, error: employeeError } = await admin
      .from("hr_employees")
      .select("id, employee_name, employee_code")
      .eq("id", claim.employee_id)
      .maybeSingle();

    if (employeeError) throw employeeError;

    const employeeName = employee?.employee_name || "Employee";
    const claimNumber = claim.claim_number || claim.id;
    const claimDate = new Date(claim.claim_date || claim.created_at || Date.now());
    const year = Number.isNaN(claimDate.getTime())
      ? String(new Date().getFullYear())
      : String(claimDate.getFullYear());

    const reimbursementsFolder = await createNestedFolder(hrFolderId, "Reimbursements");
    const yearFolder = await createNestedFolder(reimbursementsFolder.folder_id, year);
    const claimFolderName = safeFolderName(`${claimNumber} - ${employeeName}`);
    const claimFolder = await createNestedFolder(yearFolder.folder_id, claimFolderName);

    const { data: documents, error: documentsError } = await admin
      .from("reimbursement_documents")
      .select("id, file_name, file_url, file_path, mime_type")
      .eq("reimbursement_claim_id", claim.id);

    if (documentsError) throw documentsError;

    for (const document of documents || []) {
      const storagePath = normalizeStoragePath(document.file_path || document.file_url);

      if (!storagePath) {
        throw new Error(`Missing storage path for reimbursement document ${document.id}.`);
      }

      const { data: fileBlob, error: downloadError } = await admin.storage
        .from(DOCUMENT_BUCKET)
        .download(storagePath);

      if (downloadError || !fileBlob) {
        throw new Error(
          downloadError?.message ||
            `Failed to read reimbursement document ${document.id} from storage.`
        );
      }

      const buffer = Buffer.from(await fileBlob.arrayBuffer());
      const uploadedFile = await uploadDriveFile({
        targetFolderId: claimFolder.folder_id,
        fileName: document.file_name || "Reimbursement Document",
        mimeType: document.mime_type || fileBlob.type || "application/octet-stream",
        base64: buffer.toString("base64"),
      });

      const { error: updateDocumentError } = await admin
        .from("reimbursement_documents")
        .update({
          drive_file_id: uploadedFile.file_id,
          drive_file_url: uploadedFile.file_url,
        })
        .eq("id", document.id);

      if (updateDocumentError) throw updateDocumentError;
    }

    const { error: updateClaimError } = await admin
      .from("reimbursement_claims")
      .update({
        drive_folder_id: claimFolder.folder_id,
        drive_folder_url: folderUrl(claimFolder.folder_id),
        drive_sync_status: "synced",
        drive_sync_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", claim.id);

    if (updateClaimError) throw updateClaimError;
  } catch (error) {
    await markDriveSyncFailed(admin, claim.id, error);
  }
}
