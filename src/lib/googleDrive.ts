export type WorkOrderDriveFolderResponse = {
  success: boolean;
  folder_id: string;
  folder_name: string;
  ra_bills_folder_id: string;
  invoices_folder_id: string;
  debit_notes_folder_id: string;
  contractor_docs_folder_id: string;
  work_order_file_id?: string;
  work_order_file_url?: string;
  work_order_file_name?: string;
};

type WorkOrderDriveFileInput = {
  fileName: string;
  mimeType: string;
  base64: string;
};

export type DriveFileUploadResponse = {
  success: boolean;
  file_id: string;
  file_url: string;
  file_name: string;
};

export type DriveSubfolderResponse = {
  success: boolean;
  folder_id: string;
  folder_name: string;
};

type DriveFileUploadInput = {
  targetFolderId: string;
  fileName: string;
  mimeType: string;
  base64: string;
};

type DriveSubfolderInput = {
  parentFolderId: string;
  folderName: string;
};

function driveEndpoint() {
  const endpoint = process.env.GOOGLE_DRIVE_WORK_ORDER_WEB_APP_URL;

  if (!endpoint) {
    throw new Error("Missing GOOGLE_DRIVE_WORK_ORDER_WEB_APP_URL.");
  }

  return endpoint;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function normalizeWorkOrderDriveFolderResponse(
  result: any,
  workOrderFile?: WorkOrderDriveFileInput
): WorkOrderDriveFolderResponse {
  return {
    ...result,
    folder_id: firstString(
      result?.folder_id,
      result?.folderId,
      result?.drive_folder_id,
      result?.driveFolderId,
      result?.work_order_folder_id,
      result?.workOrderFolderId,
      result?.id
    ),
    folder_name: firstString(
      result?.folder_name,
      result?.folderName,
      result?.drive_folder_name,
      result?.driveFolderName,
      result?.work_order_folder_name,
      result?.workOrderFolderName
    ),
    ra_bills_folder_id: firstString(
      result?.ra_bills_folder_id,
      result?.raBillsFolderId,
      result?.ra_bill_folder_id,
      result?.raBillFolderId,
      result?.folders?.ra_bills_folder_id,
      result?.folders?.raBillsFolderId,
      result?.folders?.ra_bills?.id,
      result?.folders?.raBills?.id
    ),
    invoices_folder_id: firstString(
      result?.invoices_folder_id,
      result?.invoicesFolderId,
      result?.invoice_folder_id,
      result?.invoiceFolderId,
      result?.folders?.invoices_folder_id,
      result?.folders?.invoicesFolderId,
      result?.folders?.invoices?.id
    ),
    debit_notes_folder_id: firstString(
      result?.debit_notes_folder_id,
      result?.debitNotesFolderId,
      result?.debit_note_folder_id,
      result?.debitNoteFolderId,
      result?.folders?.debit_notes_folder_id,
      result?.folders?.debitNotesFolderId,
      result?.folders?.debit_notes?.id,
      result?.folders?.debitNotes?.id
    ),
    contractor_docs_folder_id: firstString(
      result?.contractor_docs_folder_id,
      result?.contractorDocsFolderId,
      result?.contractor_documents_folder_id,
      result?.contractorDocumentsFolderId,
      result?.folders?.contractor_docs_folder_id,
      result?.folders?.contractorDocsFolderId,
      result?.folders?.contractor_docs?.id,
      result?.folders?.contractorDocs?.id
    ),
    work_order_file_id: firstString(
      result?.work_order_file_id,
      result?.workOrderFileId,
      result?.file_id,
      result?.fileId,
      result?.uploaded_file_id,
      result?.uploadedFileId
    ),
    work_order_file_url: firstString(
      result?.work_order_file_url,
      result?.workOrderFileUrl,
      result?.file_url,
      result?.fileUrl,
      result?.uploaded_file_url,
      result?.uploadedFileUrl
    ),
    work_order_file_name: firstString(
      result?.work_order_file_name,
      result?.workOrderFileName,
      result?.file_name,
      result?.fileName,
      result?.uploaded_file_name,
      result?.uploadedFileName,
      workOrderFile?.fileName
    ),
  };
}

export async function createWorkOrderDriveFolder(
  woNumber: string,
  workOrderFile?: WorkOrderDriveFileInput
) {
  const endpoint = driveEndpoint();

  const body: Record<string, string> = {
  action: "create_work_order_folder",
  wo_number: woNumber,
};

  if (workOrderFile) {
    body.work_order_file_name = workOrderFile.fileName;
    body.work_order_file_mime_type = workOrderFile.mimeType;
    body.work_order_file_base64 = workOrderFile.base64;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const result = await response.json().catch(() => null);
  console.log("[WorkOrder Drive] raw Apps Script response", result);

  if (!response.ok || !result?.success) {
    throw new Error(
      result?.error || "Failed to create Google Drive Work Order folder."
    );
  }

  const normalizedResult = normalizeWorkOrderDriveFolderResponse(
    result,
    workOrderFile
  );

  const missingFolderKeys = [
    ["folder_id", normalizedResult.folder_id],
    ["folder_name", normalizedResult.folder_name],
    ["ra_bills_folder_id", normalizedResult.ra_bills_folder_id],
    ["invoices_folder_id", normalizedResult.invoices_folder_id],
    ["debit_notes_folder_id", normalizedResult.debit_notes_folder_id],
    ["contractor_docs_folder_id", normalizedResult.contractor_docs_folder_id],
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missingFolderKeys.length > 0) {
    console.error("Drive Work Order folder response missing required keys", {
      missingFolderKeys,
      responseKeys: Object.keys(result || {}),
    });
    throw new Error(
      `Google Drive Work Order folder response was missing: ${missingFolderKeys.join(
        ", "
      )}.`
    );
  }

  if (
    workOrderFile &&
    (!normalizedResult.work_order_file_id || !normalizedResult.work_order_file_url)
  ) {
    console.error("Drive Work Order upload missing file keys", {
      keys: Object.keys(result || {}),
    });
  }

  return normalizedResult;
}

export async function uploadDriveFile(input: DriveFileUploadInput) {
  const response = await fetch(driveEndpoint(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
  action: "upload_file",
  target_folder_id: input.targetFolderId,
  file_name: input.fileName,
  file_mime_type: input.mimeType,
  file_base64: input.base64,
}),
  });

  const result = await response.json().catch(() => null);

  if (!response.ok || !result?.success) {
    throw new Error(result?.error || "Failed to upload Google Drive file.");
  }

  return {
    ...result,
    file_id: firstString(
      result?.file_id,
      result?.fileId,
      result?.uploaded_file_id,
      result?.uploadedFileId,
      result?.id
    ),
    file_url: firstString(
      result?.file_url,
      result?.fileUrl,
      result?.uploaded_file_url,
      result?.uploadedFileUrl,
      result?.url
    ),
    file_name: firstString(
      result?.file_name,
      result?.fileName,
      result?.uploaded_file_name,
      result?.uploadedFileName,
      input.fileName
    ),
  } as DriveFileUploadResponse;
}

export async function createDriveSubfolder(input: DriveSubfolderInput) {
  const response = await fetch(driveEndpoint(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "create_subfolder",
      parent_folder_id: input.parentFolderId,
      folder_name: input.folderName,
    }),
  });

  const result = await response.json().catch(() => null);

  if (!response.ok || !result?.success) {
    throw new Error(result?.error || "Failed to create Google Drive subfolder.");
  }

  return {
    ...result,
    folder_id: result.folder_id || result.subfolder_id || result.id,
    folder_name: result.folder_name || result.subfolder_name || input.folderName,
  } as DriveSubfolderResponse;
}
