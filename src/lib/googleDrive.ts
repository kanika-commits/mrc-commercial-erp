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

type DriveFileUploadInput = {
  targetFolderId: string;
  fileName: string;
  mimeType: string;
  base64: string;
};

function driveEndpoint() {
  const endpoint = process.env.GOOGLE_DRIVE_WORK_ORDER_WEB_APP_URL;

  if (!endpoint) {
    throw new Error("Missing GOOGLE_DRIVE_WORK_ORDER_WEB_APP_URL.");
  }

  return endpoint;
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

  if (!response.ok || !result?.success) {
    throw new Error(
      result?.error || "Failed to create Google Drive Work Order folder."
    );
  }

  return result as WorkOrderDriveFolderResponse;
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

  return result as DriveFileUploadResponse;
}
