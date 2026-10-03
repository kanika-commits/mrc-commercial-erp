import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export const WORK_ORDER_SUPPORTING_DOCUMENT_ACCEPT = "*/*";

function isPdfFile(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function imageFormat(file: File) {
  const name = file.name.toLowerCase();
  if (file.type === "image/png" || name.endsWith(".png")) return "png" as const;
  if (file.type === "image/jpeg" || name.endsWith(".jpg") || name.endsWith(".jpeg")) return "jpeg" as const;
  return null;
}

function wrapAttachmentLabel(text: string, max = 78) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && `${line} ${word}`.length > max) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export async function appendWorkOrderSupportingPdfs(
  workOrderPdf: Buffer,
  files: File[],
) {
  const output = await PDFDocument.load(workOrderPdf);

  for (const file of files) {
    const bytes = Buffer.from(await file.arrayBuffer());
    if (isPdfFile(file)) {
      let source: PDFDocument;
      try {
        source = await PDFDocument.load(bytes);
      } catch {
        throw new Error(`Supporting document ${file.name} is not a readable PDF.`);
      }
      const pages = await output.copyPages(source, source.getPageIndices());
      pages.forEach((page) => output.addPage(page));
      continue;
    }

    const format = imageFormat(file);
    if (format) {
      const image = format === "png" ? await output.embedPng(bytes) : await output.embedJpg(bytes);
      const page = output.addPage([595, 842]);
      const margin = 36;
      const scale = Math.min((page.getWidth() - margin * 2) / image.width, (page.getHeight() - margin * 2) / image.height, 1);
      const width = image.width * scale;
      const height = image.height * scale;
      page.drawImage(image, { x: (page.getWidth() - width) / 2, y: (page.getHeight() - height) / 2, width, height });
      continue;
    }

    const page = output.addPage([595, 842]);
    const font = await output.embedFont(StandardFonts.Helvetica);
    page.drawText("Supporting attachment", { x: 48, y: 748, size: 18, font, color: rgb(0.08, 0.1, 0.14) });
    page.drawText("The original file is attached to this Work Order after submission.", { x: 48, y: 714, size: 10, font, color: rgb(0.25, 0.28, 0.32) });
    wrapAttachmentLabel(`File: ${file.name}`).forEach((line, index) => page.drawText(line, { x: 48, y: 660 - index * 16, size: 12, font, color: rgb(0.08, 0.1, 0.14) }));
    page.drawText(`Type: ${file.type || "unknown"}`, { x: 48, y: 620, size: 10, font, color: rgb(0.25, 0.28, 0.32) });
    page.drawText(`Size: ${file.size} bytes`, { x: 48, y: 602, size: 10, font, color: rgb(0.25, 0.28, 0.32) });
  }

  return Buffer.from(await output.save());
}

export function validateWorkOrderSupportingFiles(files: File[]) {
  // The original attachment is preserved for every extension. Preview rendering
  // uses the PDF/image content when possible and a labeled attachment page otherwise.
  return files;
}
