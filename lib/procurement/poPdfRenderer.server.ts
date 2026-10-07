import { PDFDocument } from "pdf-lib";
import { parsePurchaseOrderStandardTerms } from "@/lib/procurement/standardTerms";
import { visibleRevisionClause } from "@/lib/procurement/poRevisionComparison";
import { buildPurchaseOrderRevisionPdfRenderModel } from "@/lib/procurement/poRevisionPdfRenderer";

export const PAGE_W = 595;

export const PAGE_H = 842;

const LEFT = 42;

const RIGHT = 553;

const TOP = 735;

const SECTION_GAP = 6;

const SECTION_HEADING_BEFORE = 14;

const HEADING_GAP = 4;

const CELL_PAD_X = 4;

const CELL_PAD_TOP = 6;

const CELL_PAD_BOTTOM = 5;

const ITEM_PAD_TOP = 5;

const ITEM_PAD_BOTTOM = 5;

const TERMS_SIZE = 8;

const TERMS_LEADING = 10;

const FOOTER_SAFETY_GAP = 2;

export const PAGE_NUMBER_SIZE = 8;

export const PAGE_NUMBER_OFFSET = 2;

const PAGE_NUMBER_BODY_GAP = 2;

const FIRST_PAGE_TITLE_SAFE_GAP = 8;

const REDLINE = { r: 0.72, g: 0.08, b: 0.08 };

export type RevisionValueDiff<T> =
  | { state: "unchanged"; value: T }
  | { state: "added"; after: T }
  | { state: "removed"; before: T }
  | { state: "changed"; before: T; after: T };

type RevisionRenderRun = { value: string; red?: boolean; strike?: boolean };

export function diffScalar<T>(before: T | null | undefined, after: T | null | undefined): RevisionValueDiff<T> {
  const beforePresent = before !== null && before !== undefined && String(before) !== "";
  const afterPresent = after !== null && after !== undefined && String(after) !== "";
  if (!beforePresent && !afterPresent) return { state: "unchanged", value: after as T };
  if (!beforePresent) return { state: "added", after: after as T };
  if (!afterPresent) return { state: "removed", before: before as T };
  return Object.is(before, after) || JSON.stringify(before) === JSON.stringify(after) ? { state: "unchanged", value: after as T } : { state: "changed", before: before as T, after: after as T };
}

function normalizeVisibleText(value: unknown) {
  return String(value ?? "").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
}

function diffCollection<T>(before: T[], after: T[], identity: (value: T) => string): Array<RevisionValueDiff<T> & { identity: string; beforeIndex?: number; afterIndex?: number }> {
  const beforeMap = new Map(before.map((value, index) => [identity(value), { value, index }]));
  const afterMap = new Map(after.map((value, index) => [identity(value), { value, index }]));
  const result: Array<RevisionValueDiff<T> & { identity: string; beforeIndex?: number; afterIndex?: number }> = [];
  for (const [key, current] of afterMap) { const previous = beforeMap.get(key); const diff = previous ? diffScalar(previous.value, current.value) : { state: "added", after: current.value } as RevisionValueDiff<T>; result.push({ ...diff, identity: key, beforeIndex: previous?.index, afterIndex: current.index }); }
  for (const [key, previous] of beforeMap) if (!afterMap.has(key)) result.push({ state: "removed", before: previous.value, identity: key, beforeIndex: previous.index });
  return result;
}

function revisionRuns<T>(diff: RevisionValueDiff<T>, format: (value: T) => string): RevisionRenderRun[] | string {
  if (diff.state === "unchanged") return format(diff.value);
  if (diff.state === "added") return [{ value: format(diff.after), red: true }];
  if (diff.state === "removed") return [{ value: format(diff.before), red: true, strike: true }];
  return [{ value: format(diff.before), red: true, strike: true }, { value: format(diff.after), red: true }];
}

function textDiffRuns(before: unknown, after: unknown): RevisionRenderRun[] {
  const oldWords = normalizeVisibleText(before).split(/\s+/).filter(Boolean);
  const newWords = normalizeVisibleText(after).split(/\s+/).filter(Boolean);
  let start = 0;
  while (start < oldWords.length && start < newWords.length && oldWords[start] === newWords[start]) start += 1;
  let oldEnd = oldWords.length - 1;
  let newEnd = newWords.length - 1;
  while (oldEnd >= start && newEnd >= start && oldWords[oldEnd] === newWords[newEnd]) { oldEnd -= 1; newEnd -= 1; }
  const runs: RevisionRenderRun[] = [];
  if (start) runs.push({ value: `${oldWords.slice(0, start).join(" ")} ` });
  if (oldEnd >= start) runs.push({ value: oldWords.slice(start, oldEnd + 1).join(" "), red: true, strike: true });
  if (newEnd >= start) runs.push({ value: newWords.slice(start, newEnd + 1).join(" "), red: true });
  const suffix = newWords.slice(newEnd + 1).join(" ");
  if (suffix) runs.push({ value: `${runs.length ? " " : ""}${suffix}` });
  return runs.length ? runs : [{ value: normalizeVisibleText(after) }];
}

function itemSnapshotDiff(value: any): RevisionValueDiff<any> {
  if (value?.type === "added") return { state: "added", after: value.after };
  if (value?.type === "removed") return { state: "removed", before: value.before };
  return diffScalar(value?.before, value?.after);
}

export function text(value: unknown) { return value === null || value === undefined || String(value).trim() === "" ? "—" : String(value); }

function money(value: unknown) { return `Rs. ${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }

function date(value: unknown) { const parts = String(value || "").slice(0, 10).split("-"); return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : text(value); }

function esc(value: unknown) { return String(value ?? "").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)"); }

function formatCreatorName(value: unknown) { return String(value ?? "").trim().toLocaleLowerCase().replace(/(^|[\s'-])([a-z])/g, (_, prefix, letter) => `${prefix}${letter.toLocaleUpperCase()}`); }

export function cleanDisplay(value: unknown) { const result = String(value ?? "").trim(); return result || null; }

export function firstDisplayValue(...values: unknown[]) { return values.map(cleanDisplay).find(Boolean) || null; }

function isPhoneLike(value: unknown) { return /^\+?[\d\s().-]{7,}$/.test(String(value ?? "").trim()); }

function frozenBillingContactName(address: any) {
  const contactName = cleanDisplay(address?.contact_name || address?.contact?.contact_name);
  const mobile = cleanDisplay(address?.mobile || address?.contact?.mobile);
  return contactName && !isPhoneLike(contactName) ? contactName : mobile && !isPhoneLike(mobile) ? mobile : contactName || mobile;
}

function frozenBillingContactMobile(address: any) {
  const contactName = cleanDisplay(address?.contact_name || address?.contact?.contact_name);
  const mobile = cleanDisplay(address?.mobile || address?.contact?.mobile);
  return mobile && isPhoneLike(mobile) ? mobile : contactName && isPhoneLike(contactName) ? contactName : mobile || contactName;
}

function wrap(value: unknown, width: number) { return String(value ?? "").split(/\r?\n/).flatMap((line) => { const words = line.split(/\s+/).filter(Boolean); if (!words.length) return [""]; const lines: string[] = []; let current = ""; for (const word of words) { if ((current + " " + word).trim().length > width && current) { lines.push(current); current = word; } else current = (current + " " + word).trim(); } if (current) lines.push(current); return lines; }); }

function isClauseHeading(value: string) { return /^(variation in quantity|quality of material|testing|taxes & duties|registration under|warranty|escalation|settlement of disputes|final say)\b.*:?$/i.test(value.trim()) || /^[^\s].{2,80}:$/.test(value.trim()); }

function termIndent(value: string) {
  if (/^[a-z]\./i.test(value.trim())) return LEFT + 10;
  if (/^[ivxlcdm]+\./i.test(value.trim())) return LEFT + 5;
  return LEFT + 5;
}

function textWidth(value: string, size: number) { return value.length * size * 0.52; }

function wrapToPointWidth(value: unknown, maxWidth: number, size: number, measure = textWidth) { return String(value ?? "").split(/\r?\n/).flatMap((line) => { const words = line.split(/\s+/).filter(Boolean); if (!words.length) return [""]; const lines: string[] = []; let current = ""; for (const word of words) { const candidate = (current + " " + word).trim(); if (measure(candidate, size) > maxWidth && current) { lines.push(current); current = word; } else current = candidate; } if (current) lines.push(current); return lines; }); }

type TermsLevel = "main" | "roman" | "alpha" | "body";

type TermsLine = {
  raw: string;
  level: TermsLevel;
  marker: string;
  content: string;
  indent: number;
  markerOffset: number;
  spacingBefore: number;
  spacingAfter: number;
  bold: boolean;
};

function parseTermsLine(raw: string): TermsLine {
  const trimmed = raw.trim();
  const mainMatch = trimmed.match(/^(\d+\.)\s*(.+)$/);
  if (mainMatch) {
    return { raw: trimmed, level: "main", marker: mainMatch[1], content: mainMatch[2], indent: LEFT, markerOffset: 0, spacingBefore: 2, spacingAfter: 0, bold: true };
  }
  const romanMatch = trimmed.match(/^([ivxlcdm]+\.)\s*(.+)$/i);
  if (romanMatch) {
    return { raw: trimmed, level: "roman", marker: romanMatch[1], content: romanMatch[2], indent: LEFT + 7, markerOffset: 0, spacingBefore: 1, spacingAfter: 0, bold: false };
  }
  const alphaMatch = trimmed.match(/^([a-z]\.)\s*(.+)$/i);
  if (alphaMatch) {
    return { raw: trimmed, level: "alpha", marker: alphaMatch[1], content: alphaMatch[2], indent: LEFT + 14, markerOffset: 0, spacingBefore: 0, spacingAfter: 0, bold: false };
  }
  if (isClauseHeading(trimmed)) {
    return { raw: trimmed, level: "main", marker: "", content: trimmed, indent: LEFT, markerOffset: 0, spacingBefore: 4, spacingAfter: 1, bold: true };
  }
  return { raw: trimmed, level: "body", marker: "", content: trimmed, indent: termIndent(trimmed), markerOffset: 0, spacingBefore: 0, spacingAfter: 1, bold: false };
}

function withoutClauseNumber(value: string) { return value.replace(/^\s*\d+[.)]\s*/, "").trim(); }

function numberedTerms(snapshot: unknown) {
  const parsed = parsePurchaseOrderStandardTerms(snapshot);
  if (!parsed) return ["No standard terms added."];
  if (parsed.kind === "structured") return parsed.clauses.flatMap((clause, index) => [`${index + 1}. ${withoutClauseNumber(clause.heading)}`, ...clause.clause_body.split(/\r?\n/)]);
  let clauseNumber = 0;
  return parsed.text.split(/\r?\n/).map((raw) => {
    const line = raw.trim();
    if (!line) return raw;
    const normalized = parseTermsLine(line);
    return normalized.level === "main" ? `${++clauseNumber}. ${withoutClauseNumber(normalized.content)}` : raw;
  });
}

function structuredClauses(snapshot: unknown) {
  const parsed = parsePurchaseOrderStandardTerms(snapshot);
  return parsed?.kind === "structured" ? parsed.clauses.map(visibleRevisionClause) : null;
}

function revisionHeader(row: any) { return row?.revisionComparison?.rendererSnapshot?.header || {}; }

function revisionCommercial(row: any) {
  const header = revisionHeader(row).commercial_snapshot || {};
  return { before: header.before || {}, after: header.after || {} };
}

function revisionChargeMap(value: any) {
  const charges = Array.isArray(value?.additional_charges) ? value.additional_charges : [];
  return new Map<string, any>(charges.map((charge: any) => [String(charge.id ?? charge.code ?? charge.key ?? charge.name ?? ""), charge] as [string, any]));
}

function revisionKeyTermMap(value: any) {
  const terms = Array.isArray(value?.key_terms) ? value.key_terms : [];
  return new Map<string, any>(terms.map((term: any) => [String(term.id ?? term.key ?? term.code ?? term.description ?? term.label ?? ""), term] as [string, any]));
}

export type ImageAsset = { name: string; data: Buffer; width: number; height: number; format: "jpeg" | "png" };

type PdfPage = { ops: string[]; images: ImageAsset[] };

export async function makePdf(row: any, creator: any, approver: any, resolved: { letterhead: { header: ImageAsset | null; footer: ImageAsset | null; fullPage: boolean }; deliveryCompany: string | null }, revisionPresentation: any = null, draftGeneratedAt: string | null = null) {
  const revisionRenderModel = revisionPresentation || null;
  const letterhead = resolved.letterhead;
  const footerRenderedHeight = letterhead.footer ? PAGE_W * letterhead.footer.height / letterhead.footer.width : 0;
  const headerRenderedHeight = letterhead.header ? PAGE_W * letterhead.header.height / letterhead.header.width : 0;
  const contentTop = letterhead.header ? PAGE_H - headerRenderedHeight - 8 : TOP;
  const pageNumberBaselineY = footerRenderedHeight + PAGE_NUMBER_OFFSET;
  const pageNumberTopY = pageNumberBaselineY + PAGE_NUMBER_SIZE;
  const bodyBottomY = letterhead.footer ? Math.max(footerRenderedHeight + FOOTER_SAFETY_GAP, pageNumberTopY + PAGE_NUMBER_BODY_GAP) : 72;
  const metricsPdf = await PDFDocument.create();
  const termsFont = await metricsPdf.embedFont("Helvetica");
  const termsTextWidth = (value: string, size: number) => termsFont.widthOfTextAtSize(value, size);
  const pages: PdfPage[] = [];
  let page: PdfPage;
  let y = TOP;
  const newPage = () => { page = { ops: [], images: [] }; pages.push(page); y = contentTop; if (letterhead.header) { page.images.push(letterhead.header); if (letterhead.header.format === "jpeg") page.ops.push(letterhead.fullPage ? `q ${PAGE_W} 0 0 ${PAGE_H} 0 0 cm /${letterhead.header.name} Do Q` : `q ${PAGE_W} 0 0 ${headerRenderedHeight} 0 ${PAGE_H - headerRenderedHeight} cm /${letterhead.header.name} Do Q`); } if (letterhead.footer) { page.images.push(letterhead.footer); if (letterhead.footer.format === "jpeg") page.ops.push(`q ${PAGE_W} 0 0 ${footerRenderedHeight} 0 0 cm /${letterhead.footer.name} Do Q`); } };
  const ensure = (height: number) => { if (y - height < bodyBottomY) newPage(); };
  const line = (x: number, yy: number, x2: number, yy2: number) => page.ops.push(`${x} ${yy} m ${x2} ${yy2} l S`);
  const tableLine = (x: number, yy: number, x2: number, yy2: number, strong = false) => page.ops.push(`q ${strong ? "0.45" : "0.78"} G ${strong ? "0.8" : "0.45"} w ${x} ${yy} m ${x2} ${yy2} l S Q`);
  const tableFill = (x: number, yy: number, width: number, height: number, color = "0.96 0.97 0.98") => page.ops.push(`q ${color} rg ${x} ${yy} ${width} ${height} re f Q`);
  const rect = (x: number, yy: number, w: number, h: number) => page.ops.push(`${x} ${yy} ${w} ${h} re S`);
  const rowGrid = (x: number, top: number, widths: number[], height: number, mergedStart?: number) => {
    const bottom = top - height;
    tableLine(x, bottom, x + widths.reduce((sum, width) => sum + width, 0), bottom);
    let cursor = x;
    tableLine(cursor, bottom, cursor, top);
    for (let index = 0; index < widths.length; index += 1) {
      cursor += widths[index];
      if (mergedStart === undefined || index < mergedStart || index === mergedStart) tableLine(cursor, bottom, cursor, top);
    }
  };
  const draw = (value: unknown, x: number, yy: number, size = 9, bold = false, strike = false) => { const rendered = String(value ?? ""); page.ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${x} ${yy} Td (${esc(rendered)}) Tj ET`); if (strike && rendered) { const width = textWidth(rendered, size); page.ops.push(`q 0 0 0 RG 0.7 w ${x} ${yy + size * 0.35} m ${x + width} ${yy + size * 0.35} l S Q`); } };
  const drawRedline = (value: unknown, x: number, yy: number, size = 9, strike = false, bold = false) => {
    const rendered = String(value ?? "");
    page.ops.push(`q ${REDLINE.r} ${REDLINE.g} ${REDLINE.b} rg BT /${bold ? "F2" : "F1"} ${size} Tf ${x} ${yy} Td (${esc(rendered)}) Tj ET Q`);
    if (strike && rendered) { const width = textWidth(rendered, size); page.ops.push(`q ${REDLINE.r} ${REDLINE.g} ${REDLINE.b} RG 0.7 w ${x} ${yy + size * 0.35} m ${x + width} ${yy + size * 0.35} l S Q`); }
  };
  const drawChanged = (oldValue: unknown, newValue: unknown, x: number, yy: number, size = 9) => {
    drawRedline(oldValue, x, yy, size, true);
    drawRedline(newValue, x + textWidth(String(oldValue ?? ""), size) + 5, yy, size, false);
  };
  const drawAligned = (value: string, cellX: number, cellW: number, yy: number, size: number, align: "left" | "center" | "right" = "left", bold = false, strike = false) => {
    const width = textWidth(value, size);
    if (align === "right") {
      draw(value, Math.max(cellX + CELL_PAD_X, cellX + cellW - CELL_PAD_X - width), yy, size, bold, strike);
      return;
    }
    if (align === "center") {
      draw(value, cellX + Math.max(CELL_PAD_X, (cellW - width) / 2), yy, size, bold, strike);
      return;
    }
    draw(value, cellX + CELL_PAD_X, yy, size, bold, strike);
  };
  const centered = (value: string, size: number) => draw(value, LEFT + ((RIGHT - LEFT) - value.length * size * 0.52) / 2, y, size, true);
  const heading = (value: string, firstContentHeight = 0) => {
    const requiredHeight = SECTION_HEADING_BEFORE + 15 + HEADING_GAP + firstContentHeight;
    if (y - requiredHeight < bodyBottomY) newPage();
    else y -= SECTION_HEADING_BEFORE;
    draw(value, LEFT, y, 10, true);
    y -= 15 + HEADING_GAP;
  };
  type RichRun = { value: string; red?: boolean; strike?: boolean };
  type TableCell = string | RichRun[];
  const table = (headers: string[], rows: TableCell[][], widths: number[], size = 8) => {
    const renderRow = (cells: TableCell[], header = false) => {
      const richLines = (cell: TableCell, width: number): RichRun[] => typeof cell === "string" ? wrap(cell, Math.max(8, Math.floor((width - CELL_PAD_X * 2) / (size * 0.52)))).map((value) => ({ value })) : cell.flatMap((run) => wrap(run.value, Math.max(8, Math.floor((width - CELL_PAD_X * 2) / (size * 0.52)))).map((value) => ({ ...run, value })));
      const lines = cells.map((cell, i) => richLines(cell, widths[i]));
      const lineHeight = size + 2;
      const h = Math.max(...lines.map((items) => items.length)) * lineHeight + CELL_PAD_TOP + CELL_PAD_BOTTOM;
      if (y - h < bodyBottomY) { newPage(); line(LEFT, y, RIGHT, y); if (!header) renderRow(headers, true); }
      if (header) tableFill(LEFT, y - h, widths.reduce((sum, width) => sum + width, 0), h);
      let x = LEFT;
      for (let i = 0; i < cells.length; i += 1) {
        const firstBaseline = y - CELL_PAD_TOP - lineHeight * 0.78;
        lines[i].forEach((item, index) => item.red ? drawRedline(item.value, x + CELL_PAD_X, firstBaseline - index * lineHeight, size, Boolean(item.strike), header) : draw(item.value, x + CELL_PAD_X, firstBaseline - index * lineHeight, size, header, Boolean(item.strike)));
        x += widths[i];
      }
      rowGrid(LEFT, y, widths, h);
      y -= h;
    };
      line(LEFT, y, RIGHT, y); renderRow(headers, true); rows.forEach((rowData) => renderRow(rowData)); y -= 3;
  };
  const labeledTable = (cells: string[], widths: number[], size = 9) => {
    const lineHeight = size + 2;
    const padding = CELL_PAD_X;
    const labelValueGap = 4;
    const renderCell = (cell: string, cellX: number, cellW: number, topY: number, drawLines = true) => {
      const logicalLines = String(cell).split(/\r?\n/);
      const rendered: Array<{ label: string; value: string }> = [];
      for (const logicalLine of logicalLines) {
        const match = logicalLine.match(/^([^:]+:\s*)(.*)$/);
        const label = match?.[1] || "";
        const value = match?.[2] || logicalLine;
        const firstWidth = Math.max(8, cellW - padding * 2 - termsTextWidth(label, size) - (label ? labelValueGap : 0));
        const valueLines = wrapToPointWidth(value, firstWidth, size, termsTextWidth);
        if (!valueLines.length) rendered.push({ label, value: "" });
        else valueLines.forEach((lineText, index) => rendered.push({ label: index === 0 ? label : "", value: lineText }));
      }
      if (!drawLines) return rendered.length;
      rendered.forEach((lineData, index) => {
        const yy = topY - padding - lineHeight * 0.78 - index * lineHeight;
        const labelWidth = termsTextWidth(lineData.label, size);
        if (lineData.label) draw(lineData.label, cellX + padding, yy, size, true);
        draw(lineData.value, cellX + padding + labelWidth + (lineData.label ? labelValueGap : 0), yy, size, false);
      });
      return rendered.length;
    };
    const lineCounts = cells.map((cell, index) => renderCell(cell, LEFT + widths.slice(0, index).reduce((sum, width) => sum + width, 0), widths[index], y, false));
    const height = Math.max(...lineCounts) * lineHeight + CELL_PAD_TOP + CELL_PAD_BOTTOM;
    if (y - height < bodyBottomY) newPage();
    const topY = y;
    let x = LEFT;
    cells.forEach((cell, index) => { renderCell(cell, x, widths[index], topY); x += widths[index]; });
    rowGrid(LEFT, y, widths, height);
    y -= height;
  };
  const addressTable = (cells: string[]) => {
    const widths = [270, 241];
    const padding = 8;
    const lineHeight = 11;
    const wrapAddress = (value: string, maxWidth: number) => String(value).split(/\r?\n/).flatMap((line) => {
      const words = line.split(/\s+/).filter(Boolean);
      if (!words.length) return [""];
      const lines: string[] = [];
      let current = "";
      const pushWord = (word: string) => {
        let chunk = "";
        for (const character of word) {
          const candidate = chunk + character;
          if (termsTextWidth(candidate, 9) > maxWidth && chunk) { lines.push(chunk); chunk = character; } else chunk = candidate;
        }
        if (chunk) current = chunk;
      };
      for (const word of words) {
        if (termsTextWidth(word, 9) > maxWidth) {
          if (current) { lines.push(current); current = ""; }
          pushWord(word);
          continue;
        }
        const candidate = (current + " " + word).trim();
        if (termsTextWidth(candidate, 9) > maxWidth && current) { lines.push(current); current = ""; pushWord(word); } else current = candidate;
      }
      if (current) lines.push(current);
      return lines;
    });
    const renderRow = (rowCells: string[], header = false) => {
      const lines = rowCells.map((cell, index) => wrapAddress(cell, widths[index] - padding * 2));
      const height = Math.max(...lines.map((items) => items.length)) * lineHeight + padding * 2;
      if (y - height < bodyBottomY) newPage();
      if (header) tableFill(LEFT, y - height, RIGHT - LEFT, height);
      lines.forEach((items, index) => items.forEach((item, lineIndex) => draw(item, LEFT + widths.slice(0, index).reduce((sum, width) => sum + width, 0) + padding, y - padding - lineHeight * 0.78 - lineIndex * lineHeight, 9, header)));
      rowGrid(LEFT, y, widths, height);
      y -= height;
    };
    line(LEFT, y, RIGHT, y);
    renderRow(["Billing Address", "Shipping / Delivery Address"], true);
    labeledTable(cells, widths, 9);
    y -= 3;
  };
  const itemTable = (rows: Array<Array<string | Array<{ value: string; red?: boolean; strike?: boolean }>>>, widths: number[]) => {
    const headers = ["S.No.", "Material / Description", "Make", "Qty", "Unit", "Rate", "GST", "Amount"];
    const aligns: Array<"left" | "center" | "right"> = ["center", "left", "left", "center", "center", "right", "right", "right"];
    const headerAligns: Array<"left" | "center" | "right"> = ["center", "left", "left", "center", "center", "center", "center", "center"];
    const tableRight = LEFT + widths.reduce((sum, width) => sum + width, 0);
    const drawOuterRowBorders = (top: number, height: number) => {
      tableLine(LEFT, top, tableRight, top, true);
      tableLine(LEFT, top - height, tableRight, top - height, true);
      tableLine(LEFT, top - height, LEFT, top, true);
      tableLine(tableRight, top - height, tableRight, top, true);
    };
    const render = (cells: Array<string | Array<{ value: string; red?: boolean; strike?: boolean }>>, bold = false, summary = false) => {
      const lines = cells.map((cell, i) => {
        const maxWidth = Math.max(8, Math.floor((widths[i] - CELL_PAD_X * 2) / (7 * 0.52)));
        if (typeof cell === "string") return wrap(cell, maxWidth).map((value) => ({ value, red: false, strike: false }));
        return cell.flatMap((run) => wrap(run.value, maxWidth).map((value) => ({ value, red: run.red, strike: run.strike })));
      });
      const h = summary ? Math.max(17, Math.max(...lines.map((items) => items.length)) * 9 + ITEM_PAD_TOP + ITEM_PAD_BOTTOM) : Math.max(...lines.map((items) => items.length)) * 9 + ITEM_PAD_TOP + ITEM_PAD_BOTTOM;
      if (y - h < bodyBottomY) { newPage(); line(LEFT, y, RIGHT, y); if (!summary) render(headers, true); }
      if (bold && !summary) tableFill(LEFT, y - h, tableRight - LEFT, h);
      let x = LEFT;
      for (let i = 0; i < cells.length; i += 1) {
        const lineHeight = 9;
        const textBlockHeight = lines[i].length * lineHeight;
        const firstBaseline = summary ? y - h + (h - textBlockHeight) / 2 + lineHeight * 0.78 : y - ITEM_PAD_TOP - lineHeight * 0.78;
        lines[i].forEach((item, index) => {
          const yy = firstBaseline - index * lineHeight;
          const align = bold ? headerAligns[i] : aligns[i];
          const value = item.value;
          const valueWidth = textWidth(value, 7);
          const alignedX = align === "right" ? x + widths[i] - CELL_PAD_X - valueWidth : align === "center" ? x + (widths[i] - valueWidth) / 2 : x + CELL_PAD_X;
          if (item.red) drawRedline(value, alignedX, yy, 7, Boolean(item.strike), bold);
          else drawAligned(value, x, widths[i], yy, 7, align, bold, Boolean(item.strike));
        });
        x += widths[i];
      }
      if (!summary) {
        drawOuterRowBorders(y, h);
        let boundary = LEFT;
        for (const width of widths) {
          boundary += width;
          tableLine(boundary, y - h, boundary, y);
        }
      } else {
        drawOuterRowBorders(y, h);
        const totalsLabelX = LEFT + widths.slice(0, 6).reduce((sum, width) => sum + width, 0);
        const amountX = totalsLabelX + widths[6];
        tableLine(totalsLabelX, y - h, totalsLabelX, y);
        tableLine(amountX, y - h, amountX, y);
      }
      y -= h;
    };
    render(headers, true); rows.forEach((rowData) => render(rowData));
    const explicitCharges = revisionRenderModel ? [] : (Array.isArray(row.commercial_snapshot?.additional_charges) ? row.commercial_snapshot.additional_charges.filter((charge: any) => Number(charge.amount) > 0 && String(charge.name || "").trim()) : []);
    const preparedCharges = revisionRenderModel?.additionalCharges || null;
    const commercialDiff = revisionRenderModel ? { before: {}, after: {} } : revisionCommercial(row);
    const freightBefore = commercialDiff.before.freight_amount ?? commercialDiff.before.freight;
    const freightAfter = commercialDiff.after.freight_amount ?? commercialDiff.after.freight;
    const beforeCharges = revisionRenderModel ? new Map(revisionRenderModel.additionalCharges.map((entry: any) => [entry.identity, entry])) : revisionChargeMap(commercialDiff.before);
    const afterCharges = revisionRenderModel ? new Map(revisionRenderModel.additionalCharges.map((entry: any) => [entry.identity, entry])) : revisionChargeMap(commercialDiff.after);
    const additionalTotal = revisionRenderModel ? 0 : explicitCharges.reduce((sum: number, charge: any) => sum + Number(charge.amount), 0);
    const displayedTotal = revisionRenderModel ? Number(row.total_amount ?? Number(row.total_basic_amount || 0) + Number(row.total_gst_amount || 0) + Number(row.total_freight_amount || 0)) : Number(row.total_basic_amount || 0) + Number(row.total_gst_amount || 0) + additionalTotal;
    const removedCharges = [...beforeCharges.values()].filter((entry: any) => entry.state === "removed").map((entry: any) => [String(entry.before.name).trim(), money(entry.before.amount), "removed"]);
    const freightAmount = Number(row.total_freight_amount || commercialDiff.after.freight_amount || 0);
    const preparedSummary = revisionRenderModel?.summary || null;
    const summaryRows = preparedSummary ? [["Items Basic", preparedSummary.itemsBasic], ["GST", preparedSummary.gst], ...(freightAmount > 0 ? [["Freight", preparedSummary.freight]] : []), ...(preparedCharges ? preparedCharges.map((charge: any) => [charge.name, charge.amount, charge.state]) : []), ["Total Amount", preparedSummary.total]] : [["Items Basic", money(row.total_basic_amount)], ["GST", money(row.total_gst_amount)], ...(freightAmount > 0 ? [["Freight", money(freightAmount)]] : []), ...explicitCharges.map((charge: any) => [String(charge.name).trim(), money(Number(charge.amount)), !beforeCharges.has(String(charge.id ?? charge.code ?? charge.key ?? charge.name ?? ""))]), ...removedCharges, ["Total Amount", money(displayedTotal)]];
    for (const [label, amount, addedOrRemoved] of summaryRows) {
      const labelRuns = label && typeof label === "object" ? label.runs : null;
      const amountRuns = amount && typeof amount === "object" ? amount.runs : null;
      const summaryCells = [labelRuns ? labelRuns.map((run: any) => run.text).join("") : String(label), amountRuns ? amountRuns.map((run: any) => run.text).join("") : String(amount)];
      const summaryLines = summaryCells.map((cell, index) => {
        const runs = (index === 1 ? amountRuns : labelRuns) as any[] | null;
        if (runs) return runs.flatMap((run: any) => wrap(run.text, Math.max(8, Math.floor((widths[index === 0 ? 6 : 7] - CELL_PAD_X * 2) / (7 * 0.52)))));
        return wrap(cell, Math.max(8, Math.floor((widths[index === 0 ? 6 : 7] - CELL_PAD_X * 2) / (7 * 0.52))));
      });
      const summaryHeight = Math.max(17, Math.max(...summaryLines.map((items) => items.length)) * 9 + ITEM_PAD_TOP + ITEM_PAD_BOTTOM);
      if (y - summaryHeight < bodyBottomY) { newPage(); render(headers, true); }
      const totalsLabelX = LEFT + widths.slice(0, 6).reduce((sum, value) => sum + value, 0);
      const amountX = totalsLabelX + widths[6];
      const labelText = summaryCells[0];
      const emphasized = labelText === "Items Basic" || labelText === "GST" || labelText === "Total Amount";
      if (label === "Total Amount") tableFill(LEFT, y - summaryHeight, tableRight - LEFT, summaryHeight, "0.93 0.95 0.97");
      if (labelRuns) labelRuns.forEach((run: any) => run.color === "red" ? drawRedline(run.text, totalsLabelX + CELL_PAD_X, y - summaryHeight + 9 * 0.78, 7, run.strike, emphasized) : draw(run.text, totalsLabelX + CELL_PAD_X, y - summaryHeight + 9 * 0.78, 7, emphasized, Boolean(run.strike)));
      else for (const [lineIndex, lineText] of summaryLines[0].entries()) addedOrRemoved ? drawRedline(lineText, totalsLabelX + CELL_PAD_X, y - summaryHeight + (summaryHeight - summaryLines[0].length * 9) / 2 + 9 * 0.78 - lineIndex * 9, 7, addedOrRemoved === "removed", emphasized) : drawAligned(lineText, totalsLabelX, widths[6], y - summaryHeight + (summaryHeight - summaryLines[0].length * 9) / 2 + 9 * 0.78 - lineIndex * 9, 7, "left", emphasized);
      const chargeKey = labelText === "Freight" ? "" : String(labelText);
      const chargeDiff = beforeCharges.get(chargeKey) || afterCharges.get(chargeKey);
      const changedCharge = chargeDiff?.state === "changed";
      const changedFreight = false;
      if (changedFreight) {
        const yy = y - summaryHeight + 9 * 0.78;
        drawRedline(money(freightBefore), amountX, yy, 7, true);
        drawRedline(money(freightAfter), amountX, yy - 9, 7, false);
      } else if (changedCharge && chargeDiff.before && chargeDiff.after) {
        const yy = y - summaryHeight + 9 * 0.78;
        drawRedline(money(chargeDiff.before.amount), amountX, yy, 7, true);
        drawRedline(money(chargeDiff.after.amount), amountX, yy - 9, 7, false);
      } else if (amountRuns) amountRuns.forEach((run: any, runIndex: number) => { const width = textWidth(String(run.text), 7); const xx = amountX + widths[7] - CELL_PAD_X - width; const yy = y - summaryHeight + (summaryHeight - summaryLines[1].length * 9) / 2 + 9 * 0.78 - runIndex * 9; run.color === "red" ? drawRedline(run.text, xx, yy, 7, run.strike, false) : draw(run.text, xx, yy, 7, false, Boolean(run.strike)); });
      else if (addedOrRemoved) for (const [lineIndex, lineText] of summaryLines[1].entries()) drawRedline(lineText, amountX, y - summaryHeight + (summaryHeight - summaryLines[1].length * 9) / 2 + 9 * 0.78 - lineIndex * 9, 7, addedOrRemoved === "removed", false);
      else for (const [lineIndex, lineText] of summaryLines[1].entries()) drawAligned(lineText, amountX, widths[7], y - summaryHeight + (summaryHeight - summaryLines[1].length * 9) / 2 + 9 * 0.78 - lineIndex * 9, 7, "right", label === "Total Amount");
      drawOuterRowBorders(y, summaryHeight);
      tableLine(totalsLabelX, y - summaryHeight, totalsLabelX, y);
      tableLine(amountX, y - summaryHeight, amountX, y);
      y -= summaryHeight;
    }
    y -= 4;
  };

  newPage();
  if (letterhead.header) y -= FIRST_PAGE_TITLE_SAFE_GAP;
  if (!letterhead.header) { draw(row.company?.company_name || "Purchase Order", LEFT, y, 16, true); y -= 28; }
  ensure(28); centered("Purchase Order", 13); y -= 22;
  if (Number(row.revision_no || 0) > 0 && row.previous_revision_id) {
    ensure(22);
    draw(`Revision: R-${row.revision_no}`, LEFT, y, 8, true);
    y -= 18;
  }

  const vendor = row.vendor_snapshot || {};
  const delivery = row.delivery_snapshot || {};
  const billing = delivery.gst_billing || delivery.billing_address || {};
  const shipping = delivery.delivery_location || delivery.shipping_address || delivery;
  const billingContact = delivery.billing_contact || billing;
  const contact = delivery.delivery_contact || delivery.site_contact || {};
  const billingCompany = firstDisplayValue(billing.legal_name, billing.company_name, billing.company, billing.trade_name, billing.label);
  const deliveryCompany = resolved.deliveryCompany;
  const shippingAddress = shipping.address || [shipping.address_line1, shipping.address_line2, shipping.city, shipping.state, shipping.pincode].filter(Boolean).join(", ");
  table(["Vendor Details", "Purchase Order Details"], [], [270, 241], 9);
  labeledTable([
    `Vendor Name: ${text(row.vendor_name_snapshot)}\nContact Person: ${text(vendor.contact_person || vendor.contact_name)}\nAddress: ${text(vendor.address)}\nMobile: ${text(vendor.phone || vendor.mobile)}\nEmail: ${text(vendor.email)}\nGSTIN: ${text(vendor.gstin)}`,
    `Purchase Order No: ${text(row.po_number)}\nDate: ${date(row.po_date)}\nCompany: ${text(row.company?.company_name)}\nSite: ${text(row.site?.site_name)}`,
  ], [270, 241], 9);

  y -= SECTION_GAP;
  addressTable([
    `Company: ${text(billingCompany)}\nGSTIN: ${text(billing.gstin)}\nAddress: ${text(billing.address || [billing.address_line1, billing.address_line2, billing.city, billing.state, billing.pincode].filter(Boolean).join(", "))}\nContact Person: ${text(frozenBillingContactName(billingContact))}\nMobile: ${text(frozenBillingContactMobile(billingContact))}`,
    `Company: ${text(deliveryCompany)}\nGSTIN: ${text(shipping.gstin || delivery.shipping_gstin)}\nSite / Location: ${text(shipping.location_name || shipping.location || row.site?.site_name)}\nAddress: ${text(shippingAddress)}\nContact Person: ${text(contact.contact_name || shipping.contact_name)}\nMobile: ${text(contact.mobile || shipping.mobile)}`,
  ]);

  heading("ITEMS", 19);
  const diffs = Number(row.revision_no || 0) > 0 && revisionRenderModel ? new Map(revisionRenderModel.items.map((item: any) => [String(item.revision_line_key), item])) : new Map();
  const renderedItems: Array<Array<string | Array<{ value: string; red?: boolean; strike?: boolean }>>> = [];
  const itemFields = ["item_name_snapshot", "item_code_snapshot", "make_snapshot", "quantity", "uom_snapshot", "unit_rate", "gst_rate", "gst_amount", "total_amount"];
  const formatItemValue = (field: string, item: any) => {
    if (field === "unit_rate" || field === "total_amount" || field === "gst_amount") return item?.[field] == null ? text(item?.[field]) : money(item[field]);
    if (field === "gst_rate") return `${item?.gst_rate || 0}%`;
    return text(item?.[field]);
  };
  const redlineCell = (field: string, current: any, diff: any, removed = false) => {
    const prepared = diff?.fields?.[field];
    if (prepared?.runs) return prepared.runs.map((run: any) => ({ value: run.text, red: run.color === "red", strike: Boolean(run.strike) }));
    const before = diff?.before;
    const after = diff?.after;
    if (!diff) return formatItemValue(field, removed ? before : current);
    const fieldDiff = diff?.fields?.[field] || { state: removed ? "removed" : "unchanged", ...(removed ? { before } : { value: current }) } as RevisionValueDiff<any>;
    return revisionRuns(fieldDiff, (value) => formatItemValue(field, value));
  };
  for (const [index, item] of (row.items || []).entries()) {
    const diff = item?.revision_line_key ? diffs.get(String(item.revision_line_key)) : null;
    const itemCell = (field: string) => redlineCell(field, item, diff);
    renderedItems.push([
      String(index + 1),
      diff ? [itemCell("item_name_snapshot"), itemCell("item_code_snapshot"), itemCell("specification_snapshot")].flatMap((value: any) => Array.isArray(value) ? value : [{ value }]) : `${text(item.item_name_snapshot)}\n${text(item.item_code_snapshot)}${item.specification_snapshot ? `\n${item.specification_snapshot}` : ""}`,
      itemCell("make_snapshot"), itemCell("quantity"), itemCell("uom_snapshot"), itemCell("unit_rate"), diff ? [itemCell("gst_rate"), itemCell("gst_amount")].flatMap((value: any) => Array.isArray(value) ? value : [{ value }]) : `${item.gst_rate || 0}%\n${money(item.gst_amount)}`, itemCell("total_amount"),
    ]);
  }
  for (const diff of diffs.values()) {
    if (itemSnapshotDiff(diff).state !== "removed") continue;
    const old = diff.before || {};
    renderedItems.push([String((row.items || []).length + 1), ["item_name_snapshot", "item_code_snapshot", "specification_snapshot"].map((field) => ({ value: formatItemValue(field, old), red: true, strike: true })), redlineCell("make_snapshot", null, diff, true), redlineCell("quantity", null, diff, true), redlineCell("uom_snapshot", null, diff, true), redlineCell("unit_rate", null, diff, true), [{ value: `${old.gst_rate || 0}%`, red: true, strike: true }, { value: money(old.gst_amount), red: true, strike: true }], redlineCell("total_amount", null, diff, true)]);
  }
  itemTable(renderedItems, [24, 155, 48, 28, 34, 64, 78, 80]);

  const keyTerms = Array.isArray(row.commercial_snapshot?.key_terms) ? row.commercial_snapshot.key_terms : [];
  const keyTermsDiff = revisionCommercial(row);
  const keyBefore = revisionKeyTermMap(keyTermsDiff.before);
  const keyAfter = revisionKeyTermMap(keyTermsDiff.after);
  const keyTermDiffs = revisionRenderModel?.keyTerms || diffCollection(Array.isArray(keyTermsDiff.before.key_terms) ? keyTermsDiff.before.key_terms : [], Array.isArray(keyTermsDiff.after.key_terms) ? keyTermsDiff.after.key_terms : [], (term: any) => String(term.id ?? term.key ?? term.code ?? term.description ?? term.label ?? ""));
  heading("KEY TERMS", 22);
  const keyRows: TableCell[][] = keyTerms.length ? keyTerms.map((term: any, index: number) => {
    const key = String(term.id ?? term.key ?? term.code ?? term.description ?? term.label ?? "");
    const termDiff = keyTermDiffs.find((entry: any) => entry.identity === key); const before = keyBefore.get(key); const current = text(term.value || term.terms || term.text); const previous = text(before?.value || before?.terms || before?.text);
    if (termDiff?.value?.runs) return [String(index + 1), termDiff.label, termDiff.value.runs.map((run: any) => ({ value: run.text, red: run.color === "red", strike: Boolean(run.strike) }))];
    const value: TableCell = termDiff?.state === "changed" ? textDiffRuns(termDiff.before, termDiff.after) : termDiff?.state === "added" ? [{ value: current, red: true }] : termDiff?.state === "removed" ? [{ value: previous, red: true, strike: true }] : current;
    return [String(index + 1), text(term.description || term.label), value];
  }) : [["—", "—", "No key terms added."]];
  for (const [key, before] of keyBefore) if (!keyAfter.has(key)) keyRows.push(["—", text(before.description || before.label), [{ value: text(before.value || before.terms || before.text), red: true, strike: true }]]);
  table(["S.No.", "Description", "Terms"], keyRows, [38, 160, 313], 9);

  const structuredBefore = structuredClauses(revisionHeader(row).standard_terms_snapshot?.before);
  const structuredAfter = structuredClauses(revisionHeader(row).standard_terms_snapshot?.after);
  const terms = numberedTerms(row.standard_terms_snapshot);
  const comparison = revisionRenderModel?.standardTerms?.map((entry: any) => ({ clause: entry.after || entry.before, diff: entry })) || null;
  const firstTerm = terms.map((entry) => entry.trim()).find(Boolean);
  const firstTermParsed = firstTerm ? parseTermsLine(firstTerm) : null;
  const firstTermHeight = firstTermParsed ? firstTermParsed.spacingBefore + TERMS_LEADING + firstTermParsed.spacingAfter : TERMS_LEADING;
  heading("TERMS & CONDITIONS", firstTermHeight);
  if (revisionRenderModel) {
    const drawWrappedRuns = (runs: any[], x: number, width: number, bold = false) => {
      for (const run of runs) {
        const lines = wrapToPointWidth(String(run.text ?? ""), width, TERMS_SIZE, termsTextWidth);
        for (const line of lines.length ? lines : [""]) {
          ensure(TERMS_LEADING);
          if (run.color === "red") drawRedline(line, x, y, TERMS_SIZE, Boolean(run.strike), bold);
          else draw(line, x, y, TERMS_SIZE, bold, Boolean(run.strike));
          y -= TERMS_LEADING;
        }
      }
    };
    revisionRenderModel.standardTerms.forEach((block: any, index: number) => {
      const marker = `${index + 1}. `;
      const markerWidth = termsTextWidth(marker, TERMS_SIZE) + 3;
      ensure(TERMS_LEADING * 2);
      draw(marker, LEFT, y, TERMS_SIZE, true);
      y -= 0;
      drawWrappedRuns(block.heading.runs, LEFT + markerWidth, RIGHT - LEFT - markerWidth, true);
      drawWrappedRuns(block.body.runs, LEFT + 10, RIGHT - LEFT - 10, false);
      ensure(2);
      y -= 2;
    });
  } else if (comparison) {
    comparison.forEach((block: any, index: number) => {
      const clause = block.clause; const headingText = withoutClauseNumber(String(clause.heading || "")); const body = String(clause.clause_body || ""); const oldBody = block.diff.state === "changed" || block.diff.state === "removed" ? String(block.diff.before?.clause_body || "") : ""; const changed = block.diff.state === "changed"; const removed = block.diff.state === "removed";
      const bodyLines = wrapToPointWidth(removed ? oldBody : body, RIGHT - LEFT - 10, TERMS_SIZE, termsTextWidth);
      const oldLines = changed ? wrapToPointWidth(oldBody, RIGHT - LEFT - 10, TERMS_SIZE, termsTextWidth) : [];
      const newLines = changed ? wrapToPointWidth(body, RIGHT - LEFT - 10, TERMS_SIZE, termsTextWidth) : bodyLines;
      ensure(TERMS_LEADING * (1 + oldLines.length + newLines.length));
      draw(`${index + 1}. ${headingText}`, LEFT, y, TERMS_SIZE, true); y -= TERMS_LEADING;
      if (changed || removed) { oldLines.length ? oldLines.forEach((lineText) => { drawRedline(lineText, LEFT + 10, y, TERMS_SIZE, true); y -= TERMS_LEADING; }) : (drawRedline(oldBody, LEFT + 10, y, TERMS_SIZE, true), y -= TERMS_LEADING); }
      if (!removed) newLines.forEach((lineText) => { drawRedline(lineText, LEFT + 10, y, TERMS_SIZE, false); y -= TERMS_LEADING; });
      y -= 2;
    });
  } else {
    terms.forEach((raw, index) => {
      const trimmed = raw.trim(); if (!trimmed) { y -= TERMS_LEADING; return; }
      const parsed = parseTermsLine(trimmed); const markerWidth = parsed.marker ? termsTextWidth(`${parsed.marker} `, TERMS_SIZE) : 0; const textX = parsed.indent + markerWidth + parsed.markerOffset;
      const lines = wrapToPointWidth(parsed.content || parsed.raw, Math.max(42, RIGHT - textX), TERMS_SIZE, termsTextWidth); ensure(parsed.spacingBefore + lines.length * TERMS_LEADING + parsed.spacingAfter); y -= parsed.spacingBefore; if (parsed.marker) draw(parsed.marker, parsed.indent, y, TERMS_SIZE, parsed.bold); lines.forEach((lineText) => { draw(lineText, textX, y, TERMS_SIZE, parsed.bold); y -= TERMS_LEADING; }); y -= parsed.spacingAfter;
    });
  }
  const finalStatus = row.status === "approved" || row.status === "issued";
  const vendorName = cleanDisplay(row.vendor_name_snapshot || vendor.vendor_name);
  const approverSignatureBlock = finalStatus ? approver?.signatureBlock : null;
  const approverSignatureAsset = finalStatus ? approver?.signatureAsset as ImageAsset | null : null;
  const internalName = formatCreatorName(finalStatus ? approverSignatureBlock?.employeeName || approver?.employee_name || row.approved_by_name : creator?.employee_name || row.created_by_name);
  const internalDesignation = finalStatus ? cleanDisplay(row.approved_by_designation_name) || approverSignatureBlock?.designation || approver?.designation?.designation_name : creator?.designation?.designation_name;
  const internalCompany = finalStatus ? cleanDisplay(row.approved_by_company_name) || cleanDisplay(approverSignatureBlock?.company || approver?.company?.company_name) : null;
  const signaturePadding = 9;
  const dividerX = LEFT + (RIGHT - LEFT) / 2;
  const leftInnerX = LEFT + signaturePadding;
  const leftInnerRight = dividerX - signaturePadding;
  const rightInnerX = dividerX + signaturePadding;
  const rightInnerRight = RIGHT - signaturePadding;
  const wrapSignature = (value: string, maxWidth: number, size: number) => value.split(/\r?\n/).flatMap((line) => {
    const words = line.split(/\s+/).filter(Boolean);
    if (!words.length) return [""];
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      if (termsTextWidth(word, size) > maxWidth) {
        if (current) { lines.push(current); current = ""; }
        let chunk = "";
        for (const character of word) {
          if (termsTextWidth(chunk + character, size) > maxWidth && chunk) { lines.push(chunk); chunk = character; } else chunk += character;
        }
        current = chunk;
        continue;
      }
      const candidate = (current + " " + word).trim();
      if (termsTextWidth(candidate, size) > maxWidth && current) { lines.push(current); current = word; } else current = candidate;
    }
    if (current) lines.push(current);
    return lines;
  });
  const vendorLines = [
    ["Vendor Acceptance", true, 8],
    ["I hereby accept the terms and conditions of this Purchase Order and confirm acceptance on behalf of the Vendor.", false, 7],
    [vendorName ? `For: ${vendorName}` : "For: —", false, 7],
    ["Name: ____________________", false, 7],
    ["Designation: ____________________", false, 7],
    ["Signature: ____________________", false, 7],
  ] as Array<[string, boolean, number]>;
  const internalLines = (finalStatus
    ? [["Approved By", true, 8], [`For: ${internalCompany || "—"}`, false, 8], ...(approverSignatureAsset ? [] : [["Signature: ____________________", false, 8] as [string, boolean, number]]), [`Name: ${internalName || "—"}`, false, 8], [`Designation: ${internalDesignation || "—"}`, false, 8]]
    : [["Prepared By", true, 8], [`Name: ${internalName || formatCreatorName(creator?.name || creator?.full_name || row.created_by_name) || "—"}`, false, 8], [`Email: ${creator?.email || creator?.email_address || row.created_by_email || "—"}`, false, 8], ...(draftGeneratedAt ? [[`Generated: ${draftGeneratedAt}`, false, 7] as [string, boolean, number]] : [])]) as Array<[string, boolean, number]>;
  const signatureLineHeight = 10;
  const prepareSignatureLines = (lines: Array<[string, boolean, number]>, maxWidth: number) => lines.flatMap(([value, bold, size]) => wrapSignature(value, maxWidth, size).map((wrapped) => [wrapped, bold, size] as [string, boolean, number]));
  const leftSignatureLines = prepareSignatureLines(vendorLines, leftInnerRight - leftInnerX);
  const rightSignatureLines = prepareSignatureLines(internalLines, rightInnerRight - rightInnerX);
  const signatureMaxWidth = Math.min(150, rightInnerRight - rightInnerX);
  const signatureMaxHeight = 45;
  const signatureImageScale = approverSignatureAsset ? Math.min(signatureMaxWidth / Math.max(1, approverSignatureAsset.width), signatureMaxHeight / Math.max(1, approverSignatureAsset.height), 1) : 0;
  const signatureImageWidth = approverSignatureAsset ? approverSignatureAsset.width * signatureImageScale : 0;
  const signatureImageHeight = approverSignatureAsset ? approverSignatureAsset.height * signatureImageScale : 0;
  const signatureCellHeight = (lines: Array<[string, boolean, number]>, imageHeight = 0) => signaturePadding * 2 + lines.length * signatureLineHeight + (imageHeight ? imageHeight + 6 : 0);
  const signatureTableHeight = Math.max(signatureCellHeight(leftSignatureLines), signatureCellHeight(rightSignatureLines, signatureImageHeight));
  y -= 20;
  if (y - signatureTableHeight < bodyBottomY) newPage();
  const finalPage = pages[pages.length - 1];
  const signatureTop = y;
  tableLine(LEFT, signatureTop, RIGHT, signatureTop, true);
  tableLine(LEFT, signatureTop - signatureTableHeight, RIGHT, signatureTop - signatureTableHeight, true);
  tableLine(LEFT, signatureTop - signatureTableHeight, LEFT, signatureTop, true);
  tableLine(RIGHT, signatureTop - signatureTableHeight, RIGHT, signatureTop, true);
  tableLine(dividerX, signatureTop - signatureTableHeight, dividerX, signatureTop, true);
  let approverSignatureDrawX = 0;
  let approverSignatureDrawY = 0;
  const drawSignatureCell = (lines: Array<[string, boolean, number]>, x: number) => lines.forEach(([value, bold, size], index) => draw(value, x, signatureTop - signaturePadding - signatureLineHeight * 0.78 - index * signatureLineHeight, size, bold));
  const drawApproverCell = () => {
    let cursorY = signatureTop - signaturePadding - signatureLineHeight * 0.78;
    rightSignatureLines.forEach(([value, bold, size], index) => {
      draw(value, rightInnerX, cursorY, size, bold);
      cursorY -= signatureLineHeight;
      if (index === 1 && approverSignatureAsset) {
        const imageX = rightInnerX;
        const imageY = cursorY - signatureImageHeight + 2;
        approverSignatureDrawX = imageX;
        approverSignatureDrawY = imageY;
        finalPage.images.push(approverSignatureAsset);
        if (approverSignatureAsset.format === "jpeg") finalPage.ops.push(`q ${signatureImageWidth} 0 0 ${signatureImageHeight} ${imageX} ${imageY} cm /${approverSignatureAsset.name} Do Q`);
        cursorY -= signatureImageHeight + 6;
      }
    });
  };
  drawSignatureCell(leftSignatureLines, leftInnerX);
  drawApproverCell();
  y = signatureTop - signatureTableHeight;

  const objects: string[] = [];
  const add = (value: string) => { objects.push(value); return objects.length; };
  const font1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const font2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const imageObjects = new Map<ImageAsset, number>();
  for (const currentPage of pages) for (const image of currentPage.images) if (image.format === "jpeg" && !imageObjects.has(image)) imageObjects.set(image, add(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.data.length} >>\nstream\n${image.data.toString("binary")}\nendstream`));
  const contentIds = pages.map((currentPage) => add(`<< /Length ${Buffer.byteLength(currentPage.ops.join("\n"))} >>\nstream\n${currentPage.ops.join("\n")}\nendstream`));
  const pageIds: number[] = [];
  const pagesId = objects.length + pages.length + 2;
  for (let i = 0; i < pages.length; i += 1) { const resourceImages = pages[i].images.filter((image) => image.format === "jpeg").map((image) => `/${image.name} ${imageObjects.get(image)} 0 R`).join(" "); pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R >> ${resourceImages ? `/XObject << ${resourceImages} >>` : ""} >> /Contents ${contentIds[i]} 0 R >>`)); }
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  const pagesObject = add(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  if (pagesObject !== pagesId) throw new Error("PDF page tree construction failed.");
  let output = "%PDF-1.4\n%\xFF\xFF\xFF\xFF\n"; const offsets = [0]; objects.forEach((object, index) => { offsets.push(Buffer.byteLength(output, "latin1")); output += `${index + 1} 0 obj\n${object}\nendobj\n`; }); const xref = Buffer.byteLength(output, "latin1"); output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const pdf = await PDFDocument.load(Buffer.from(output, "binary"));
  const embeddedPngs = new Map<ImageAsset, any>();
  for (const currentPage of pages) {
    const pdfPage = pdf.getPages()[pages.indexOf(currentPage)];
    for (const image of currentPage.images) {
      if (image.format !== "png") continue;
      let embedded = embeddedPngs.get(image);
      if (!embedded) { embedded = await pdf.embedPng(image.data); embeddedPngs.set(image, embedded); }
      const isApproverSignature = image.name === "approverSignature";
      const width = isApproverSignature ? signatureImageWidth : PAGE_W;
      const height = isApproverSignature ? signatureImageHeight : width * image.height / image.width;
      const xPosition = isApproverSignature ? approverSignatureDrawX : 0;
      const yPosition = isApproverSignature ? approverSignatureDrawY : image.name === "frozenHeader" ? PAGE_H - height : 0;
      pdfPage.drawImage(embedded, { x: xPosition, y: yPosition, width, height });
    }
  }
  return { pdf: Buffer.from(await pdf.save()), pageCount: pages.length, footerRenderedHeight };
}
