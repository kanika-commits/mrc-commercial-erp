import { listDriveFolderFiles, uploadDriveFile } from "@/src/lib/googleDrive";

/**
 * Credit Notes deliberately share the Work Order's existing Debit Notes Drive
 * folder. This module is kept separate from the Debit Note API and ledger.
 */
export function creditNoteDriveFileName(number: string, extension = "pdf") {
  const safeNumber = String(number || "").trim().replace(/[^a-zA-Z0-9._-]+/g, "-");
  return `Credit Note ${safeNumber}.${extension}`;
}

export function creditNoteSupportingFileName(_number: string, _index: number, originalName: string) {
  const safeName = String(originalName || "document").replace(/[^a-zA-Z0-9._-]+/g, "-");
  return `Credit-Note - ${safeName}`;
}

export async function uploadCreditNoteFile(input: {
  debitNotesFolderId: string;
  fileName: string;
  mimeType: string;
  base64: string;
}) {
  if (!String(input.debitNotesFolderId || "").trim()) throw new Error("Work Order Debit Notes Drive folder is not linked.");
  return uploadDriveFile({
    targetFolderId: input.debitNotesFolderId,
    fileName: input.fileName,
    mimeType: input.mimeType,
    base64: input.base64,
  });
}

export async function findCreditNoteFileInDebitNotesFolder(input: { debitNotesFolderId: string; fileName: string }) {
  if (!String(input.debitNotesFolderId || "").trim()) throw new Error("Work Order Debit Notes Drive folder is not linked.");
  const listed = await listDriveFolderFiles({ folderId: input.debitNotesFolderId });
  const matches = listed.files.filter((file) => file.file_name === input.fileName);
  if (matches.length > 1) throw new Error(`Multiple Drive files already exist with the Credit Note filename ${input.fileName}.`);
  return matches[0] || null;
}

export async function listCreditNoteFilesInDebitNotesFolder(input: { debitNotesFolderId: string; fileName: string }) {
  if (!String(input.debitNotesFolderId || "").trim()) throw new Error("Work Order Debit Notes Drive folder is not linked.");
  const listed = await listDriveFolderFiles({ folderId: input.debitNotesFolderId });
  return listed.files.filter((file) => file.file_name === input.fileName);
}
