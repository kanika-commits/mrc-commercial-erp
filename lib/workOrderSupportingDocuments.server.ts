import { PDFDocument } from "pdf-lib";

export const WORK_ORDER_SUPPORTING_DOCUMENT_ACCEPT = "application/pdf,.pdf";

function isPdfFile(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

export async function appendWorkOrderSupportingPdfs(
  workOrderPdf: Buffer,
  files: File[],
) {
  const output = await PDFDocument.load(workOrderPdf);

  for (const file of files) {
    if (!isPdfFile(file)) {
      throw new Error(`Unsupported supporting document: ${file.name}. Only PDF files can be added.`);
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    let source: PDFDocument;
    try {
      source = await PDFDocument.load(bytes);
    } catch {
      throw new Error(`Supporting document ${file.name} is not a readable PDF.`);
    }

    const pages = await output.copyPages(source, source.getPageIndices());
    pages.forEach((page) => output.addPage(page));
  }

  return Buffer.from(await output.save());
}

export function validateWorkOrderSupportingFiles(files: File[]) {
  const invalid = files.find((file) => !isPdfFile(file));
  if (invalid) {
    throw new Error(`Unsupported supporting document: ${invalid.name}. Only PDF files can be added.`);
  }
}
