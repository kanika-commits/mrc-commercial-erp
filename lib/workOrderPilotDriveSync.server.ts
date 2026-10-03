import { createWorkOrderDriveFolder, listDriveFolderFiles, uploadDriveFile } from "@/src/lib/googleDrive";
import { renderApprovedWorkOrderPdfById, workOrderPdfFileName } from "@/lib/workOrderApprovedPdf.server";

const DOCUMENT_BUCKET = "work-order-documents";
const STALE_SYNC_MS = 10 * 60 * 1000;

const isDriveUrl = (value: unknown) => /^https:\/\/(drive|docs)\.google\.com\//.test(String(value || "").trim());
const clean = (value: unknown) => String(value ?? "").trim();
const safeName = (value: string) => value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "document.pdf";

function storagePath(document: any) {
  const explicit = clean(document.file_path);
  if (explicit && !isDriveUrl(explicit)) return explicit.replace(/^\/+/, "");
  const raw = clean(document.file_url);
  if (!raw || isDriveUrl(raw)) return "";
  const marker = `/storage/v1/object/public/${DOCUMENT_BUCKET}/`;
  const index = raw.indexOf(marker);
  return index >= 0 ? decodeURIComponent(raw.slice(index + marker.length)) : raw.replace(/^\/+/, "");
}

async function existingDriveFile(admin: any, folderId: string, fileName: string) {
  const listed = await listDriveFolderFiles({ folderId });
  return listed.files.find((file) => clean(file.file_name) === fileName) || null;
}

async function uploadOrReuse(admin: any, folderId: string, fileName: string, bytes: Buffer) {
  const existing = await existingDriveFile(admin, folderId, fileName);
  if (existing) return existing;
  return uploadDriveFile({ targetFolderId: folderId, fileName, mimeType: "application/pdf", base64: bytes.toString("base64") });
}

async function claimSync(admin: any, workOrderId: string) {
  const { data: identity, error: identityError } = await admin.from("work_orders").select("id,organization_id,wo_number,approval_status,creation_request_id").eq("id", workOrderId).maybeSingle();
  if (identityError) throw identityError;
  if (!identity || !identity.creation_request_id) return { kind: "skip" as const, current: identity };
  if (String(identity.approval_status || "").toLowerCase() !== "approved") return { kind: "skip" as const, current: identity };

  const { data: current, error: currentError } = await admin.from("work_orders").select("id,organization_id,wo_number,approval_status,creation_request_id,pilot_drive_sync_status,pilot_drive_sync_started_at").eq("id", workOrderId).maybeSingle();
  if (currentError) throw currentError;
  if (!current) return { kind: "skip" as const, current };
  if (current.pilot_drive_sync_status === "succeeded") return { kind: "done" as const, current };
  const started = current.pilot_drive_sync_started_at ? new Date(current.pilot_drive_sync_started_at).getTime() : 0;
  if (current.pilot_drive_sync_status === "running" && Date.now() - started < STALE_SYNC_MS) return { kind: "busy" as const, current };
  let claimQuery = admin.from("work_orders").update({ pilot_drive_sync_status: "running", pilot_drive_sync_error: null, pilot_drive_sync_started_at: new Date().toISOString() }).eq("id", workOrderId).eq("approval_status", "approved");
  if (current.pilot_drive_sync_status === "running") {
    claimQuery = claimQuery.eq("pilot_drive_sync_status", "running").eq("pilot_drive_sync_started_at", current.pilot_drive_sync_started_at);
  } else {
    claimQuery = claimQuery.or("pilot_drive_sync_status.is.null,pilot_drive_sync_status.eq.failed");
  }
  const { data: claimed, error: claimError } = await claimQuery.select("id").maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return { kind: "busy" as const, current };
  return { kind: "claimed" as const, current };
}

export async function syncPilotWorkOrderToDrive(admin: any, workOrderId: string) {
  let claim;
  try {
    claim = await claimSync(admin, workOrderId);
  } catch (error: any) {
    const message = error?.message || "Pilot Work Order Drive sync is unavailable until its sync schema is applied.";
    return { status: "unavailable", error: message };
  }
  if (claim.kind !== "claimed") return { status: claim.kind === "done" ? "succeeded" : claim.kind === "skip" ? "skipped" : "running" };
  try {
    const { data: folder, error: folderError } = await admin.from("work_order_drive_folders").select("drive_folder_id").eq("work_order_id", workOrderId).maybeSingle();
    if (folderError) throw folderError;
    let folderId = folder?.drive_folder_id;
    if (!folderId) {
      const { data: orderForFolder, error: orderForFolderError } = await admin.from("work_orders").select("id,organization_id,company_id,site_id,wo_number").eq("id", workOrderId).single();
      if (orderForFolderError) throw orderForFolderError;
      const createdFolder = await createWorkOrderDriveFolder(orderForFolder.wo_number);
      const { error: folderSaveError } = await admin.from("work_order_drive_folders").upsert({ organization_id: orderForFolder.organization_id, work_order_id: workOrderId, drive_folder_id: createdFolder.folder_id, drive_folder_name: createdFolder.folder_name, ra_bills_folder_id: createdFolder.ra_bills_folder_id, invoices_folder_id: createdFolder.invoices_folder_id, debit_notes_folder_id: createdFolder.debit_notes_folder_id, contractor_docs_folder_id: createdFolder.contractor_docs_folder_id }, { onConflict: "work_order_id" });
      if (folderSaveError) throw folderSaveError;
      folderId = createdFolder.folder_id;
    }

    const pdf = await renderApprovedWorkOrderPdfById(admin, workOrderId);
    const { data: order, error: orderError } = await admin.from("work_orders").select("id,wo_number,organization_id").eq("id", workOrderId).single();
    if (orderError) throw orderError;
    const pdfName = workOrderPdfFileName(order.wo_number);
    const pdfFile = await uploadOrReuse(admin, folderId, pdfName, pdf);
    const { error: pdfUpdateError } = await admin.from("work_orders").update({ generated_pdf_file_id: pdfFile.file_id, generated_pdf_file_url: pdfFile.file_url, generated_pdf_uploaded_at: new Date().toISOString(), generated_pdf_upload_key: `work-order:${workOrderId}:generated-pdf` }).eq("id", workOrderId).is("generated_pdf_file_id", null);
    if (pdfUpdateError) throw pdfUpdateError;
    const { error: pdfDocumentError } = await admin.from("work_order_documents").upsert({ organization_id: order.organization_id, work_order_id: workOrderId, file_name: pdfFile.file_name || pdfName, file_url: pdfFile.file_url, file_path: pdfFile.file_id, uploaded_at: new Date().toISOString(), drive_sync_key: "pilot-generated-pdf", drive_sync_status: "succeeded", drive_sync_error: null }, { onConflict: "work_order_id,drive_sync_key" });
    if (pdfDocumentError) throw pdfDocumentError;

    const { data: documents, error: documentsError } = await admin.from("work_order_documents").select("id,organization_id,work_order_id,file_name,file_url,file_path,uploaded_at,drive_sync_key").eq("work_order_id", workOrderId).order("uploaded_at", { ascending: true });
    if (documentsError) throw documentsError;
    for (const [index, document] of (documents || []).filter((row: any) => row.drive_sync_key !== "pilot-generated-pdf").entries()) {
      if (isDriveUrl(document.file_url)) continue;
      const path = storagePath(document);
      if (!path) throw new Error(`Supporting document ${document.file_name || index + 1} has no storage path.`);
      const downloaded = await admin.storage.from(DOCUMENT_BUCKET).download(path);
      if (downloaded.error || !downloaded.data) throw downloaded.error || new Error(`Supporting document ${document.file_name || index + 1} could not be downloaded.`);
      const fileName = `Supporting ${String(index + 1).padStart(2, "0")} - ${safeName(document.file_name || "document.pdf")}`;
      const driveFile = await uploadOrReuse(admin, folderId, fileName, Buffer.from(await downloaded.data.arrayBuffer()));
      const { error: updateError } = await admin.from("work_order_documents").update({ file_name: driveFile.file_name || fileName, file_url: driveFile.file_url, file_path: driveFile.file_id, uploaded_at: new Date().toISOString(), drive_sync_key: `pilot-supporting-${String(index + 1).padStart(4, "0")}`, drive_sync_status: "succeeded", drive_sync_error: null }).eq("id", document.id);
      if (updateError) throw updateError;
      await admin.storage.from(DOCUMENT_BUCKET).remove([path]);
    }
    const { error: successError } = await admin.from("work_orders").update({ pilot_drive_sync_status: "succeeded", pilot_drive_sync_error: null, pilot_drive_sync_completed_at: new Date().toISOString() }).eq("id", workOrderId);
    if (successError) throw successError;
    return { status: "succeeded" };
  } catch (error: any) {
    const message = error?.message || "Pilot Work Order Drive sync failed.";
    await admin.from("work_orders").update({ pilot_drive_sync_status: "failed", pilot_drive_sync_error: message }).eq("id", workOrderId);
    return { status: "failed", error: message };
  }
}
