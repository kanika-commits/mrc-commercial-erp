import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

export async function addWorkOrderDraftWatermark(pdfBytes: Buffer) {
  const pdf = await PDFDocument.load(pdfBytes);
  pdf.getPages().forEach((page) => {
    const { width, height } = page.getSize();
    page.drawText("DRAFT", {
      x: width * 0.16,
      y: height * 0.42,
      size: Math.min(width, height) * 0.16,
      rotate: degrees(35),
      color: rgb(0.65, 0.12, 0.12),
      opacity: 0.2,
    });
  });
  return Buffer.from(await pdf.save());
}

export async function addWorkOrderPackagePageNumbers(pdfBytes: Buffer) {
  const pdf = await PDFDocument.load(pdfBytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const total = pdf.getPageCount();
  pdf.getPages().forEach((page, index) => {
    const label = `Package Page ${index + 1} of ${total}`;
    const size = 7;
    const x = page.getWidth() - font.widthOfTextAtSize(label, size) - 24;
    // Keep the package marker above the letterhead footer/contact band and out of the document footer area.
    const y = Math.min(page.getHeight() - 24, 110);
    page.drawText(label, { x, y, size, font, color: rgb(0.25, 0.28, 0.32) });
  });
  return Buffer.from(await pdf.save());
}
