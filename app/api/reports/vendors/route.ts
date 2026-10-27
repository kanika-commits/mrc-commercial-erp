import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createClient } from "@supabase/supabase-js";
import { loadPermissionContext, hasServerPermission } from "@/lib/serverPermissions";
import { applyOrganizationScope, loadActorOrganizationScope } from "@/lib/serverOrganizationScope";
import { normalizeVendorColumns, VENDOR_COLUMNS } from "@/lib/reports/vendorColumns";

function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!); }
function normalizedPhone(value: unknown) { return String(value || "").replace(/\D/g, "").replace(/^91(?=\d{10}$)/, ""); }
function normalizedGstin(value: unknown) { return String(value || "").trim().toUpperCase(); }
function safe(value: unknown) { return String(value ?? "—").replace(/[—–]/g, "-").replace(/[→⇒]/g, "->").replace(/[^\x09-\x7E]/g, "?"); }
const CONTACT_BATCH_SIZE = 100;
const REPORT_PAGE_SIZE = 200;
const EXPORT_LIMIT = 5000;
async function loadVendorContacts(db: any, ids: string[]) {
  const all: any[] = [];
  for (let start = 0; start < ids.length; start += CONTACT_BATCH_SIZE) {
    const batch = ids.slice(start, start + CONTACT_BATCH_SIZE);
    try {
      const result = await db.from("vendor_contacts").select("vendor_id,contact_name,contact_number,email,is_primary").in("vendor_id", batch);
      if (result.error) {
        throw new Error("Vendor contacts query failed.");
      }
      all.push(...(result.data || []));
    } catch {
      throw new Error("Vendor contacts query failed.");
    }
  }
  return all;
}
async function exportRows(kind: string, format: string | null, rows: any[], selectedColumns = [...VENDOR_COLUMNS], metadata: Record<string, string> = {}) {
  if (!format) return null;
  const audit = kind === "audit";
  const labels: Record<string, string> = { vendor_name: "Vendor Name", gstin: "GSTIN", pan: "PAN", phone: "Phone / Mobile", email: "Email", status: "Status", created_on: "Created On", created_by: "Created By" };
  const columns = audit ? ["date", "vendor", "event", "summary", "performed"] : normalizeVendorColumns(selectedColumns);
  const headers = audit ? ["Date & Time", "Vendor", "Event", "Change Summary", "Performed By"] : columns.map((key) => labels[key]);
  const values = rows.map((row: any) => audit ? [new Date(row.changed_at).toLocaleString("en-IN"), row.vendor_id, row.action, row.change_summary || (row.action === "created" ? "Vendor created" : "Vendor updated"), row.changed_by_name || row.changed_by_email || "Unavailable"] : columns.map((key) => key === "vendor_name" ? row.vendor_name : key === "gstin" ? row.gstin : key === "pan" ? row.pan : key === "phone" ? (row.contacts || []).map((c: any) => c.contact_number).filter(Boolean).join(", ") : key === "email" ? (row.contacts || []).map((c: any) => c.email).filter(Boolean).join(", ") : key === "status" ? row.status : key === "created_on" ? (row.created_at ? new Date(row.created_at).toLocaleString("en-IN") : "—") : row.created_by || "Unavailable"));
  if (format === "excel") {
    const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet(audit ? "Vendor Audit" : "Vendor Master");
    const widths: Record<string, number> = { "Vendor Name": 36, GSTIN: 20, PAN: 17, "Phone / Mobile": 19, Email: 36, Status: 14, "Created On": 22, "Created By": 30, "Date & Time": 22, Vendor: 30, Event: 16, "Change Summary": 55, "Performed By": 28 };
    sheet.mergeCells(1, 1, 1, headers.length); sheet.getCell(1, 1).value = audit ? "Vendor Audit Report" : "Vendor Master Report"; sheet.getCell(1, 1).font = { bold: true, size: 16 }; sheet.getCell(2, 1).value = `Generated On: ${new Date().toLocaleString("en-IN")}`; const headerRow = audit ? 4 : 6; if (!audit) { sheet.getCell(3, 1).value = `Vendor: ${metadata.vendor || "All Vendors"}`; sheet.getCell(4, 1).value = `Status: ${metadata.status || "All Statuses"}`; if (metadata.search) sheet.getCell(5, 1).value = `Search: ${metadata.search}`; } sheet.getRow(headerRow).values = headers; sheet.getRow(headerRow).font = { bold: true, color: { argb: "FFFFFFFF" } }; sheet.getRow(headerRow).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF334155" } }; sheet.getRow(headerRow).alignment = { wrapText: true, vertical: "middle" };
    headers.forEach((header, index) => { sheet.getColumn(index + 1).width = widths[header] || 20; }); values.forEach((value) => { const row = sheet.addRow(value); row.alignment = { wrapText: true, vertical: "top" }; row.eachCell((cell) => { cell.border = { top: { style: "thin", color: { argb: "FFD1D5DB" } }, bottom: { style: "thin", color: { argb: "FFD1D5DB" } }, left: { style: "thin", color: { argb: "FFD1D5DB" } }, right: { style: "thin", color: { argb: "FFD1D5DB" } } }; }); }); sheet.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow + values.length, column: headers.length } }; sheet.views = [{ state: "frozen", ySplit: headerRow }];
    const buffer = await workbook.xlsx.writeBuffer(); return new NextResponse(buffer, { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename=${audit ? "Vendor_Audit" : "Vendor_Master"}.xlsx` } });
  }
  if (format === "pdf") {
    const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica); const bold = await pdf.embedFont(StandardFonts.HelveticaBold); const pageWidth = 842, pageHeight = 595, margin = 28, usable = pageWidth - margin * 2; const priorities: Record<string, number> = { "Vendor Name": 1.6, Email: 1.45, "Created By": 1.2, "Created On": 1, GSTIN: 1, PAN: .8, "Phone / Mobile": 1, Status: .65, Vendor: 1.2, Event: .8, "Change Summary": 2 };
    const weights = headers.map((h) => priorities[h] || 1); const total = weights.reduce((a, b) => a + b, 0); const widths = weights.map((w) => usable * w / total); const wrap = (value: any, width: number, size = 8) => { const max = Math.max(8, Math.floor(width / (size * .52))); const text = safe(value); const out: string[] = []; for (let i = 0; i < text.length; i += max) out.push(text.slice(i, i + max)); return out.length ? out : ["—"]; };
    let pageNo = 0; let pages: any[] = []; const addPage = () => { const page = pdf.addPage([pageWidth, pageHeight]); pageNo += 1; pages.push(page); return page; }; let page = addPage(); let y = pageHeight - 34; page.drawText(audit ? "Vendor Audit Report" : "Vendor Master Report", { x: margin, y, size: 18, font: bold }); y -= 18; page.drawText(`Generated On: ${new Date().toLocaleString("en-IN")}`, { x: margin, y, size: 8, font }); y -= 12; if (!audit) { page.drawText(`Vendor: ${safe(metadata.vendor || "All Vendors")}`, { x: margin, y, size: 8, font }); y -= 12; page.drawText(`Status: ${safe(metadata.status || "All Statuses")}`, { x: margin, y, size: 8, font }); if (metadata.search) { y -= 12; page.drawText(`Search: ${safe(metadata.search)}`, { x: margin, y, size: 8, font }); } } y -= 16;
    const drawHeader = () => { let x = margin; const h = 24; page.drawRectangle({ x: margin, y: y - h + 4, width: usable, height: h, color: rgb(.2,.29,.38) }); headers.forEach((header, i) => { page.drawText(safe(header), { x: x + 4, y: y - 13, size: 7, font: bold, color: rgb(1,1,1), maxWidth: widths[i] - 8 }); x += widths[i]; }); y -= h; }; drawHeader();
    for (const row of values) { const lines = row.map((cell: any, i: number) => wrap(cell, widths[i] - 8)); const height = Math.max(...lines.map((l: string[]) => l.length)) * 10 + 8; if (y - height < 34) { page = addPage(); y = pageHeight - 34; drawHeader(); } let x = margin; row.forEach((_cell: any, i: number) => { page.drawRectangle({ x, y: y - height, width: widths[i], height, borderColor: rgb(.75,.78,.82), borderWidth: .5, color: rgb(1,1,1) }); lines[i].forEach((line: string, li: number) => page.drawText(line, { x: x + 4, y: y - 12 - li * 10, size: 8, font, maxWidth: widths[i] - 8 })); x += widths[i]; }); y -= height; }
    pages.forEach((p, i) => p.drawText(`Page ${i + 1} of ${pages.length}  •  SiteQube`, { x: pageWidth - 150, y: 16, size: 7, font })); const buffer = await pdf.save(); return new NextResponse(Buffer.from(buffer), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename=${audit ? "Vendor_Audit" : "Vendor_Master"}.pdf` } });
  }
  return null;
}

async function getVendorReport(request: Request) {
  const auth = await loadPermissionContext(request);
  if ("response" in auth) return auth.response;
  if (!hasServerPermission(auth, "reports", "view") || !hasServerPermission(auth, "vendors", "view")) return NextResponse.json({ error: "Reports and vendor access are required." }, { status: 403 });
  const db = admin();
  const scope = await loadActorOrganizationScope(db, auth);
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind") === "audit" ? "audit" : "master";
  const search = String(params.get("search") || "").trim();
  const vendorId = params.get("vendor_id");
  const event = params.get("event");
  const status = params.get("status");
  const duplicate = params.get("duplicate");
  const performedBy = params.get("performed_by");
  const selectedColumns = normalizeVendorColumns(params.get("columns")?.split(","));
  const resultLimit = params.get("format") ? EXPORT_LIMIT : REPORT_PAGE_SIZE;
  const from = params.get("date_from");
  const to = params.get("date_to");
  const base = applyOrganizationScope(db.from(kind === "audit" ? "vendor_audit_logs" : "vendors").select("*"), scope);
  if (!base) return NextResponse.json({ rows: [] });
  let query: any = base;
  if (kind === "master") {
    query = query.neq("status", "deleted").order("created_at", { ascending: false }).range(0, resultLimit - 1);
    if (status) query = query.eq("status", status);
    if (vendorId) query = query.eq("id", vendorId);
    const result = await query;
    if (result.error) throw result.error;
    const ids = (result.data || []).map((row: any) => row.id);
    const contactRows = ids.length ? await loadVendorContacts(db, ids) : [];
    const creates = ids.length ? await db.from("vendor_audit_logs").select("vendor_id,changed_by_user_id,changed_by_name,changed_by_email,changed_at").in("vendor_id", ids).eq("action", "created").order("changed_at", { ascending: true }) : { data: [], error: null };
    // Older vendor records may have no audit history; that is a valid report state.
    const creatorRows = creates.error ? [] : (creates.data || []);
    const creatorIds = [...new Set(creatorRows.map((row: any) => row.changed_by_user_id).filter(Boolean))];
    const profiles = creatorIds.length ? await db.from("profiles").select("id,full_name,email").in("id", creatorIds) : { data: [], error: null };
    const profileById = new Map((profiles.data || []).map((profile: any) => [String(profile.id), profile]));
    const creatorByVendor = new Map<string, any>(); for (const audit of creatorRows) if (!creatorByVendor.has(audit.vendor_id)) { const profile = profileById.get(String(audit.changed_by_user_id)); creatorByVendor.set(audit.vendor_id, { ...audit, changed_by_name: audit.changed_by_name || profile?.full_name, changed_by_email: audit.changed_by_email || profile?.email }); }
    const byVendor = new Map<string, any[]>(); for (const contact of contactRows) byVendor.set(contact.vendor_id, [...(byVendor.get(contact.vendor_id) || []), contact]);
    const rows = (result.data || []).map((row: any) => ({ ...row, contacts: byVendor.get(row.id) || [], created_by: row.created_by_name || row.created_by_email || creatorByVendor.get(row.id)?.changed_by_name || creatorByVendor.get(row.id)?.changed_by_email || "Unavailable", duplicate_phone: false, duplicate_gstin: false }));
    const needle = search.toLocaleLowerCase();
    const searched = needle ? rows.filter((row: any) => [row.vendor_name, row.gstin, row.pan, ...row.contacts.flatMap((contact: any) => [contact.contact_number, contact.email])].filter(Boolean).some((value: any) => String(value).toLocaleLowerCase().includes(needle) || normalizedPhone(value).includes(normalizedPhone(needle)))) : rows;
    const phoneCounts = new Map<string, number>(); const gstinCounts = new Map<string, number>();
    for (const row of rows) { const contact = row.contacts.find((item: any) => item.is_primary) || row.contacts[0]; const phone = normalizedPhone(contact?.contact_number); const gstin = normalizedGstin(row.gstin); if (phone) phoneCounts.set(phone, (phoneCounts.get(phone) || 0) + 1); if (gstin) gstinCounts.set(gstin, (gstinCounts.get(gstin) || 0) + 1); }
    for (const row of rows) { const contact = row.contacts.find((item: any) => item.is_primary) || row.contacts[0]; row.duplicate_phone = Boolean(normalizedPhone(contact?.contact_number) && phoneCounts.get(normalizedPhone(contact?.contact_number))! > 1); row.duplicate_gstin = Boolean(normalizedGstin(row.gstin) && gstinCounts.get(normalizedGstin(row.gstin))! > 1); }
    const finalRows = searched.filter((row: any) => !duplicate || (duplicate === "phone" ? row.duplicate_phone : row.duplicate_gstin));
    const selectedVendorName = vendorId ? String((result.data || []).find((row: any) => row.id === vendorId)?.vendor_name || "All Vendors") : "All Vendors"; const exported = await exportRows("master", params.get("format"), finalRows, selectedColumns, { vendor: selectedVendorName, status: status ? status[0].toUpperCase() + status.slice(1) : "All Statuses", search }); if (exported) return exported;
    const visibleRows = finalRows.map((row: any) => ({ ...row, contacts: selectedColumns.includes("phone") || selectedColumns.includes("email") ? row.contacts : undefined, ...(!selectedColumns.includes("gstin") ? { gstin: undefined } : {}), ...(!selectedColumns.includes("pan") ? { pan: undefined } : {}), ...(!selectedColumns.includes("status") ? { status: undefined } : {}), ...(!selectedColumns.includes("created_on") ? { created_at: undefined } : {}), ...(!selectedColumns.includes("created_by") ? { created_by: undefined } : {}) }));
    return NextResponse.json({ rows: visibleRows });
  }
  query = query.order("changed_at", { ascending: false }).range(0, resultLimit - 1);
  if (vendorId) query = query.eq("vendor_id", vendorId);
  if (event) query = query.eq("action", event);
  if (performedBy) query = query.eq("changed_by_user_id", performedBy);
  if (from) query = query.gte("changed_at", `${from}T00:00:00.000Z`);
  if (to) query = query.lt("changed_at", `${to}T23:59:59.999Z`);
  const result = await query; if (result.error) throw result.error;
  const auditRows = (result.data || []).map((row: any) => { const before = row.old_values || {}; const after = row.new_values || {}; const fields = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])); return { ...row, change_summary: row.action === "created" ? "Vendor created" : fields.map((key) => `${key.replace(/_/g, " ")}: ${before[key] ?? "Not recorded"} -> ${after[key] ?? "Not recorded"}`).join(" · ") || "Vendor updated" }; });
  const exported = await exportRows("audit", params.get("format"), auditRows); if (exported) return exported;
  return NextResponse.json({ rows: auditRows });
}

export async function GET(request: Request) {
  try {
    return await getVendorReport(request);
  } catch {
    console.error("[Vendor Reports] request failed");
    return NextResponse.json({ error: "Unable to load Vendor Report." }, { status: 500 });
  }
}
