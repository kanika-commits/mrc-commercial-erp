import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

function formatPilotDate(value: unknown) { const text = String(value ?? "").trim(); const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/); if (!match) return "-"; const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))); if (Number.isNaN(date.getTime())) return "-"; const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getUTCMonth()]; return `${String(date.getUTCDate()).padStart(2, "0")}-${month}-${date.getUTCFullYear()}`; }

export async function renderPilotRaBillPdf(input: { bill: any; order: any; effectiveRevision: any }) {
  const { bill, order, effectiveRevision } = input;
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 842, H = 595, margin = 28;
  const dark = rgb(0.08, 0.12, 0.2), teal = rgb(0.05, 0.34, 0.38), fill = rgb(0.86, 0.94, 0.94), softFill = rgb(0.96, 0.98, 0.98), breakdownFill = rgb(0.98, 0.99, 0.99), border = rgb(0.52, 0.64, 0.66);
  let page = pdf.addPage([W, H]); let y = H - 32; let pageNo = 1;
  const value = (v: unknown) => String(v ?? "").trim() || "-";
  const draw = (v: unknown, x: number, top: number, size = 8, strong = false) => page.drawText(value(v), { x, y: top - size, size, font: strong ? bold : regular, color: dark });
  const wrap = (v: unknown, width: number, size: number) => { const lines: string[] = []; let current = ""; for (const word of value(v).split(/\s+/)) { const candidate = current ? `${current} ${word}` : word; if (!current || regular.widthOfTextAtSize(candidate, size) <= width) current = candidate; else { lines.push(current); current = word; } } if (current) lines.push(current); return lines.slice(0, 4); };
  const ensure = (height: number) => { if (y - height < 30) { page = pdf.addPage([W, H]); pageNo += 1; y = H - 32; draw(`Pilot RA Bill - Page ${pageNo}`, margin, y, 8, true); y -= 18; } };
  const drawTable = (headers: string[], rows: string[][], widths: number[]) => {
    const row = (cells: string[], head = false) => {
      const isBreakdown = !head && /^\d+\.\d+$/.test(String(cells[0] || ""));
      const isParent = !head && !isBreakdown;
      const wrapped = cells.map((cell, i) => String(cell ?? "").trim() ? wrap(cell, widths[i] - 10, head ? 7.2 : 6.6) : []);
      const height = Math.max(head ? 38 : 26, ...wrapped.map((lines) => lines.length * 8 + 10));
      ensure(height);
      if (isParent) page.drawLine({ start: { x: margin, y }, end: { x: margin + widths.reduce((a, b) => a + b, 0), y }, thickness: 1.2, color: dark });
      let x = margin;
      cells.forEach((cell, i) => {
        const background = head ? fill : isBreakdown ? breakdownFill : isParent ? (rows.indexOf(cells) % 2 === 0 ? softFill : rgb(1, 1, 1)) : rgb(1, 1, 1);
        page.drawRectangle({ x, y: y - height, width: widths[i], height, color: background, borderColor: border, borderWidth: 0.5 });
        const lines = wrapped[i];
        const startY = y - (height - lines.length * 8) / 2 - 7;
        lines.forEach((line, n) => page.drawText(line, { x: x + 5, y: startY - n * 8, size: head ? 7.2 : 6.6, font: head ? bold : regular, color: dark }));
        x += widths[i];
      });
      y -= height;
    };
    row(headers, true);
    rows.forEach((item) => row(item));
  };
  const drawFinancialSummary = (rows: string[][]) => {
    const totalWidth = 610, labelWidth = 245, amountWidth = 145, percentWidth = 100, cumulativeWidth = totalWidth - labelWidth - amountWidth - percentWidth;
    const headerHeight = 18;
    ensure(rows.length * 15 + headerHeight + 42);
    draw("FINANCIAL SUMMARY", margin, y, 9.5, true);
    y -= 13;
    const summaryHeaders = ["Particulars", "This Bill", "% of Current Basic", "Cumulative to Date"];
    const summaryWidths = [labelWidth, amountWidth, percentWidth, cumulativeWidth];
    let x = margin;
    summaryHeaders.forEach((label, index) => {
      page.drawRectangle({ x, y: y - headerHeight, width: summaryWidths[index], height: headerHeight, color: teal, borderColor: border, borderWidth: 0.5 });
      page.drawText(label, { x: index === 0 ? x + 8 : x + summaryWidths[index] - bold.widthOfTextAtSize(label, 6.8) - 8, y: y - 12, size: 6.8, font: bold, color: rgb(1, 1, 1) });
      x += summaryWidths[index];
    });
    y -= headerHeight;
    rows.forEach(([label, thisBill, percentage, cumulative], index) => {
      const final = label === "Adjusted Net Payable";
      const height = final ? 20 : 15;
      const background = final ? teal : index % 2 === 0 ? fill : rgb(1, 1, 1);
      x = margin;
      summaryWidths.forEach((width) => { page.drawRectangle({ x, y: y - height, width, height, color: background, borderColor: border, borderWidth: 0.5 }); x += width; });
      const size = final ? 8.2 : 7.1;
      page.drawText(label, { x: margin + 8, y: y - height / 2 - 3, size, font: bold, color: final ? rgb(1, 1, 1) : dark });
      page.drawText(thisBill, { x: margin + labelWidth + amountWidth - bold.widthOfTextAtSize(thisBill, size) - 8, y: y - height / 2 - 3, size, font: bold, color: final ? rgb(1, 1, 1) : dark });
      if (percentage) page.drawText(percentage, { x: margin + labelWidth + amountWidth + percentWidth - bold.widthOfTextAtSize(percentage, size) - 8, y: y - height / 2 - 3, size, font: bold, color: final ? rgb(1, 1, 1) : dark });
      if (cumulative) page.drawText(cumulative, { x: margin + labelWidth + amountWidth + percentWidth + cumulativeWidth - bold.widthOfTextAtSize(cumulative, size) - 8, y: y - height / 2 - 3, size, font: bold, color: final ? rgb(1, 1, 1) : dark });
      y -= height;
    });
  };
  page.drawRectangle({ x: margin, y: y - 30, width: W - margin * 2, height: 30, color: teal });
  page.drawText("RA Bill", { x: margin + 10, y: y - 21, size: 18, font: bold, color: rgb(1, 1, 1) });
  y -= 42;
  const snapshot = bill.work_order_snapshot || {};
  const vendorLink = (order.work_order_vendors || []).find((link: any) => link.is_primary) || (order.work_order_vendors || [])[0];
  const vendor = vendorLink?.vendors?.vendor_name || "-";
  const revisionSnapshot = effectiveRevision?.snapshot || {};
  const workDescription = revisionSnapshot.description || revisionSnapshot.work_description || revisionSnapshot.project_description || order.description || order.work_description || order.project_description || "-";
  const site = order.site?.[0]?.site_name || snapshot.site?.site_name || snapshot.site_name || "-";
  const version = effectiveRevision ? `Revision ${effectiveRevision.revision_number} (${effectiveRevision.status})` : "Original approved Work Order";
  const period = String(bill.bill_period || "").split(/\s+to\s+/i).map(formatPilotDate).join(" to ");
  const headerRows = [["Contractor / vendor", vendor, "RA Bill No.", bill.bill_number], ["Project / work description", workDescription, "Bill date", formatPilotDate(bill.bill_date)], ["Site", site, "Work Period", period || "-"], ["Work Order No.", order.wo_number || bill.work_order_id, "Effective version", version]];
  ensure(112); let hy = y; const hw = [120, 300, 120, 246]; for (const row of headerRows) { let x = margin; row.forEach((cell, i) => { page.drawRectangle({ x, y: hy - 24, width: hw[i], height: 24, color: i % 2 === 0 ? fill : rgb(1, 1, 1), borderColor: border, borderWidth: 0.5 }); draw(cell, x + 8, hy - 8, 7.5, i % 2 === 0); x += hw[i]; }); hy -= 24; } y = hy - 20;
  draw("ITEMS AND BREAKDOWNS", margin, y, 12, true); y -= 18;
  const money = (v: unknown) => `Rs. ${Number(v || 0).toFixed(2)}`;
  const percentage = (amount: unknown, basic: unknown) => Number(basic || 0) > 0 ? `${((Number(amount || 0) / Number(basic)) * 100).toFixed(2)}%` : "0.00%";
  const headers = ["S.No.", "Item / breakdown description", "WO Qty", "Unit", "Rate", "Work done till date", "Release %", "Up-to-date amount", "Upto Previous bill", "Work done in this bill", "Remarks"];
  const widths = [38, 156, 52, 42, 58, 68, 52, 78, 70, 82, 75]; const rows: string[][] = [];
  const effectiveItems = effectiveRevision?.snapshot?.items || order.effective_items || order.work_order_items || [];
  const findEffectiveItem = (item: any) => effectiveItems.find((candidate: any) => String(candidate.serial ?? candidate.item_serial ?? candidate.sort_order ?? "") === String(item.parent_serial ?? "")) || {};
  for (const item of bill.work_order_pilot_ra_bill_items || []) { const children = Array.isArray(item.breakdowns) ? item.breakdowns : []; const calcItem = (bill.calculation_snapshot?.items || []).find((v: any) => String(v.serial) === String(item.parent_serial)) || item; const source = findEffectiveItem(item); const parent = [String(item.parent_serial || "-"), item.description, source.quantity ?? source.wo_qty ?? item.wo_qty, source.unit ?? source.unit_snapshot ?? item.unit, money(source.unit_rate ?? source.rate ?? item.rate), calcItem.cumulative_qty, `${(Number(calcItem.release_percent || 0) * 100).toFixed(2)}%`, money(calcItem.cumulative_amount), money(calcItem.previous_amount), money(calcItem.current_amount), item.remarks || ""]; rows.push(parent); for (const child of children) { const c = (calcItem.breakdowns || []).find((v: any) => String(v.id || "") === String(child.id || "")) || child; const release = Number(child.release_percent || 0); rows.push([String(child.serial || "-"), child.description || "", "", "", "", child.cumulative_qty, `${(release * (release <= 1 ? 100 : 1)).toFixed(2)}%`, money(c.cumulative_amount), money(child.previous_amount), money(c.current_amount), child.remarks || ""]); } }
  const calc = bill.calculation_snapshot || {};
  drawTable(headers, rows, widths);
  y -= 14;
  drawFinancialSummary([
    ["Basic Value", money(calc.current_basic), "", money(calc.cumulative_basic)],
    ["GST as per Work Order", money(calc.current_gst), "", money(calc.cumulative_gst)],
    ["Security in this bill", money(calc.current_security), percentage(calc.current_security, calc.current_basic), money(calc.cumulative_security)],
    ["Withheld", money(calc.withheld), percentage(calc.withheld, calc.current_basic), ""],
    ["Labour Cess", money(calc.labour_cess), percentage(calc.labour_cess, calc.current_basic), ""],
    ["Total Debit Notes", money(calc.total_debit_notes), "", ""],
    ["Total Credit Notes", money(calc.total_credit_notes), "", ""],
    ["Net Payable", money(calc.current_net_payable), "", money(calc.cumulative_net_payable)],
    ["Adjusted Net Payable", money(calc.adjusted_net_payable), "", ""],
  ]);
  return Buffer.from(await pdf.save());
}
