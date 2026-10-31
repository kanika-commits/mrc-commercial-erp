import crypto from "node:crypto";
import { listDriveFolderFiles, uploadDriveFile } from "@/src/lib/googleDrive";

export async function deletePilotDriveFile(fileId: string) {
  const endpoint = process.env.GOOGLE_DRIVE_WORK_ORDER_WEB_APP_URL;
  if (!endpoint) throw new Error("Missing GOOGLE_DRIVE_WORK_ORDER_WEB_APP_URL.");
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete_file", file_id: fileId }) });
  const result = await response.json().catch(() => null);
  if (response.status === 404) return { deleted: true, idempotent: true };
  if (!response.ok || !result?.success) throw new Error(result?.error || "Failed to delete the exact Pilot Drive file.");
  return { deleted: true, idempotent: false };
}

const clean = (value: unknown) => String(value ?? "").trim();
const safeName = (value: string) => clean(value).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "document";

function datePart(value: unknown) {
  const match = clean(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : "undated";
}

function bytesFromStored(value: unknown) {
  const text = String(value || "");
  return Buffer.from(text.startsWith("\\x") ? text.slice(2) : text, text.startsWith("\\x") ? "hex" : "base64");
}

async function fileFor(admin: any, cycleId: string, fileName: string) {
  const { data, error } = await admin.from("work_order_pilot_ra_bill_drive_files").select("*").eq("cycle_id", cycleId).eq("file_name", fileName).maybeSingle();
  if (error) throw error;
  return data;
}

export async function filePilotRaBillCycleToDrive(admin: any, input: { bill: any; cycle: any; pdfBytes: Buffer }) {
  const { bill, cycle, pdfBytes } = input;
  const folderResult = await admin.from("work_order_drive_folders").select("ra_bills_folder_id").eq("work_order_id", bill.work_order_id).eq("organization_id", bill.organization_id).maybeSingle();
  if (folderResult.error) throw folderResult.error;
  const folderId = clean(folderResult.data?.ra_bills_folder_id);
  if (!folderId) throw new Error("The Pilot Work Order has no RA Bills Drive folder.");
  const listed = await listDriveFolderFiles({ folderId });
  const vendor = clean(bill.work_order_snapshot?.vendor_name) || "Pilot Vendor";
  const stem = `${safeName(vendor)} ${safeName(bill.bill_number)} ${datePart(bill.bill_date)}`;
  const manifest = Array.isArray(cycle.attachment_manifest) ? cycle.attachment_manifest : [];
  const entries = [{ kind: "reviewed_pdf", manifest_attachment_id: null, fileName: `${stem}.pdf`, mimeType: "application/pdf", bytes: pdfBytes, sha256: crypto.createHash("sha256").update(pdfBytes).digest("hex") }];
  for (const attachment of manifest) {
    const stored = await admin.storage.from("work-order-pilot-ra-bill-attachments").download(String(attachment.storage_key));
    if (stored.error || !stored.data) throw new Error(`Supporting document ${attachment.file_name || attachment.id} could not be read for Drive filing.`);
    const bytes = Buffer.from(await stored.data.arrayBuffer());
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== attachment.sha256 || bytes.length !== Number(attachment.byte_length)) throw new Error(`Supporting document ${attachment.file_name || attachment.id} failed integrity verification.`);
    const original = safeName(attachment.file_name || `attachment-${attachment.id}`);
    entries.push({ kind: "supporting_document", manifest_attachment_id: attachment.id, fileName: `${stem} - ${original}`, mimeType: attachment.mime_type || "application/octet-stream", bytes, sha256 });
  }
  for (const entry of entries) {
    const saved = await fileFor(admin, cycle.id, entry.fileName);
    if (saved) {
      if (saved.sha256 !== entry.sha256 || Number(saved.byte_length) !== entry.bytes.length) throw new Error(`Pilot Drive file ${entry.fileName} does not match the submitted cycle.`);
      continue;
    }
    const collision = listed.files.find((file: any) => clean(file.file_name) === entry.fileName);
    if (collision) throw new Error(`A different Drive file already uses ${entry.fileName}.`);
    const uploaded = await uploadDriveFile({ targetFolderId: folderId, fileName: entry.fileName, mimeType: entry.mimeType, base64: entry.bytes.toString("base64") });
    const inserted = await admin.from("work_order_pilot_ra_bill_drive_files").insert({ organization_id: bill.organization_id, ra_bill_id: bill.id, cycle_id: cycle.id, manifest_attachment_id: entry.manifest_attachment_id, kind: entry.kind, file_name: entry.fileName, drive_file_id: uploaded.file_id, drive_file_url: uploaded.file_url, sha256: entry.sha256, byte_length: entry.bytes.length }).select("*").single();
    if (inserted.error) throw inserted.error;
  }
  return { folderId, files: entries.map((entry) => entry.fileName) };
}
