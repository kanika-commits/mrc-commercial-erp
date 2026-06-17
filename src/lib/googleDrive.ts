export type WorkOrderDriveFolderResponse = {
  success: boolean;
  folder_id: string;
  folder_name: string;
  ra_bills_folder_id: string;
  invoices_folder_id: string;
  debit_notes_folder_id: string;
  contractor_docs_folder_id: string;
};

export async function createWorkOrderDriveFolder(woNumber: string) {
  const endpoint = process.env.GOOGLE_DRIVE_WORK_ORDER_WEB_APP_URL;

  if (!endpoint) {
    throw new Error("Missing GOOGLE_DRIVE_WORK_ORDER_WEB_APP_URL.");
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ wo_number: woNumber }),
  });

  const result = await response.json().catch(() => null);

  if (!response.ok || !result?.success) {
    throw new Error(
      result?.error || "Failed to create Google Drive Work Order folder."
    );
  }

  return result as WorkOrderDriveFolderResponse;
}
