import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";
import { applyCompanySiteScope, loadCompanySiteAssignments } from "@/app/api/labour/_shared";
import { loadPermissionContext, hasServerPermission } from "@/lib/serverPermissions";
import { isInOrganizationScope, loadActorOrganizationScope, type OrganizationScope } from "@/lib/serverOrganizationScope";

const PAGE_SIZE = 50;
const EXPORT_LIMIT = 5000;
const EVENT_LABELS: Record<string, string> = { create: "Registered", update: "Profile Updated", employment_change: "Employment Changed", salary_revision: "Rate Changed", transfer: "Transferred", activate: "Activated", deactivate: "Inactivated" };
type AuditChange = { field: string; before: string; after: string };
type ReportRow = { id: string; at: string; labour_id: string; labour_name: string; event: string; summary: string; site: string; company: string; from_site: string; to_site: string; contractor: string; performed_by: string; reason: string; changes: AuditChange[] };

function adminClient() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!); }
function displayValue(value: unknown) { return value === null || value === undefined || value === "" ? "Previous value unavailable" : String(value); }
function changedFields(row: any): AuditChange[] { const before = row.old_values && typeof row.old_values === "object" ? row.old_values : {}; const after = row.new_values && typeof row.new_values === "object" ? row.new_values : {}; const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).filter((key) => key !== "__audit").filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])); return keys.map((field) => ({ field, before: displayValue(before[field]), after: displayValue(after[field]) })); }
function normalizeRow(row: any): ReportRow { const changes = changedFields(row); const before = row.old_values || {}; const after = row.new_values || {}; return { id: row.id, at: row.created_at, labour_id: row.record_id, labour_name: after.worker_name || before.worker_name || after.labour_name || before.labour_name || "Unavailable", event: EVENT_LABELS[row.action] || after.__audit?.activity_label || row.action, summary: changes.map((change) => `${change.field}: ${change.before} -> ${change.after}`).join("; ") || displayValue(row.description), site: row.site_name || "Unavailable", company: row.company_name || "Unavailable", from_site: before.from_site_name || "Unavailable", to_site: after.to_site_name || "Unavailable", contractor: after.contractor_name || before.contractor_name || "Unavailable", performed_by: row.created_by_name || row.created_by_email || "Unavailable", reason: after.__audit?.reason || "Unavailable", changes }; }
function organizationIdForRequest(scope: OrganizationScope, request: Request) { const requested = new URL(request.url).searchParams.get("organization_id")?.trim(); return requested && isInOrganizationScope(scope, requested) ? requested : null; }

async function loadRows(request: Request, exportMode: boolean) {
  const auth = await loadPermissionContext(request);
  if ("response" in auth) return auth;
  if (!hasServerPermission(auth, "reports", "view") || !hasServerPermission(auth, "labour_workers", "view")) return { response: NextResponse.json({ error: "Reports and Labour access are required." }, { status: 403 }) } as const;
  const admin = adminClient();
  const scope = await loadActorOrganizationScope(admin, auth);
  const organizationId = organizationIdForRequest(scope, request);
  if (!organizationId) return { response: NextResponse.json({ error: "A permitted organization context is required." }, { status: 403 }) } as const;
  const assignments = await loadCompanySiteAssignments(admin, auth, scope);
  const modulesResult = await admin.from("organization_modules").select("module_code,enabled").eq("organization_id", organizationId).in("module_code", ["reports", "labour"]);
  if (modulesResult.error) throw modulesResult.error;
  const enabledModules = new Set((modulesResult.data || []).filter((row: any) => row.enabled === true).map((row: any) => row.module_code));
  if (!enabledModules.has("reports") || !enabledModules.has("labour")) return { response: NextResponse.json({ error: "Reports and Labour modules are not enabled for this organization." }, { status: 403 }) } as const;
  const params = new URL(request.url).searchParams;
  const siteId = params.get("site_id");
  if (siteId && assignments.siteIds !== null && !assignments.siteIds.includes(siteId)) return { response: NextResponse.json({ error: "Selected site is outside your authorized scope." }, { status: 403 }) } as const;
  if (params.get("metadata") === "true") {
    let sitesQuery: any = admin.from("sites").select("id,site_name").eq("organization_id", organizationId).eq("status", "active").order("site_name");
    if (assignments.siteIds !== null) sitesQuery = assignments.siteIds.length ? sitesQuery.in("id", assignments.siteIds) : null;
    const sitesResult = sitesQuery ? await sitesQuery : { data: [], error: null };
    if (sitesResult.error) throw sitesResult.error;
    return { metadata: true, report_available: true, sites: sitesResult.data || [] };
  }
  const page = Math.max(1, Number(new URL(request.url).searchParams.get("page") || "1") || 1);
  const pageSize = exportMode ? EXPORT_LIMIT : PAGE_SIZE;
  const start = exportMode ? 0 : (page - 1) * PAGE_SIZE;
  let query: any = admin.from("erp_audit_logs").select("id,organization_id,company_id,site_id,record_id,action,description,old_values,new_values,created_by,created_by_name,created_by_email,created_at", { count: "exact" }).eq("organization_id", organizationId).eq("module_code", "labour_workers").order("created_at", { ascending: false }).range(start, start + pageSize - 1);
  const from = params.get("date_from"); const to = params.get("date_to"); const search = params.get("search")?.trim(); const event = params.get("event");
  if (from) query = query.gte("created_at", `${from}T00:00:00.000Z`); if (to) query = query.lt("created_at", `${to}T23:59:59.999Z`); if (event) query = query.eq("action", event); if (search) query = query.or(`record_id.eq.${search},created_by_name.ilike.%${search}%`); if (siteId) query = query.eq("site_id", siteId);
  query = applyCompanySiteScope(query, assignments); if (!query) return { rows: [], page_size: PAGE_SIZE, export_limit: EXPORT_LIMIT };
  const result = await query; if (result.error) throw result.error;
  const siteIds = Array.from(new Set((result.data || []).map((row: any) => row.site_id).filter(Boolean))); const companyIds = Array.from(new Set((result.data || []).map((row: any) => row.company_id).filter(Boolean)));
  const [sites, companies] = await Promise.all([siteIds.length ? admin.from("sites").select("id,site_name").in("id", siteIds) : { data: [], error: null }, companyIds.length ? admin.from("companies").select("id,company_name").in("id", companyIds) : { data: [], error: null }]);
  if (sites.error) throw sites.error; if (companies.error) throw companies.error;
  const siteMap = new Map((sites.data || []).map((row: any) => [row.id, row.site_name])); const companyMap = new Map((companies.data || []).map((row: any) => [row.id, row.company_name]));
  return { rows: (result.data || []).map((row: any) => normalizeRow({ ...row, site_name: siteMap.get(row.site_id), company_name: companyMap.get(row.company_id) })), page, page_size: PAGE_SIZE, total: result.count || 0, export_limit: EXPORT_LIMIT };
}

async function excelResponse(rows: ReportRow[]) { const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("Labour Audit"); const headers = ["Date", "Labour ID", "Labour Name", "Event", "Field Changed", "Previous Value", "New Value", "Company", "Site", "From Site", "To Site", "Contractor", "Performed By", "Reason"]; sheet.columns = headers.map((header) => ({ header, key: header })); for (const row of rows) for (const change of row.changes) sheet.addRow({ Date: row.at, "Labour ID": row.labour_id, "Labour Name": row.labour_name, Event: row.event, "Field Changed": change.field, "Previous Value": change.before, "New Value": change.after, Company: row.company, Site: row.site, "From Site": row.from_site, "To Site": row.to_site, Contractor: row.contractor, "Performed By": row.performed_by, Reason: row.reason }); const buffer = await workbook.xlsx.writeBuffer(); return new NextResponse(buffer, { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": "attachment; filename=Labour_Audit_Report.xlsx" } }); }
async function pdfResponse(rows: ReportRow[]) { const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica); let page = pdf.addPage([842, 595]); let y = 560; page.drawText("Labour Audit Report", { x: 32, y, size: 18, font, color: rgb(0.05, 0.1, 0.2) }); y -= 28; for (const row of rows) { const line = `${new Date(row.at).toLocaleString()} | ${row.labour_id || "-"} | ${row.event} | ${row.summary}`.slice(0, 150); if (y < 30) { page = pdf.addPage([842, 595]); y = 560; } page.drawText(line, { x: 32, y, size: 8, font }); y -= 16; } return new NextResponse(Buffer.from(await pdf.save()), { headers: { "content-type": "application/pdf", "content-disposition": "attachment; filename=Labour_Audit_Report.pdf" } }); }
export async function GET(request: Request) { try { const format = new URL(request.url).searchParams.get("format"); const loaded = await loadRows(request, Boolean(format)); if ("response" in loaded) return loaded.response; if (format === "excel") return excelResponse(loaded.rows || []); if (format === "pdf") return pdfResponse(loaded.rows || []); return NextResponse.json(loaded); } catch (error: any) { return NextResponse.json({ error: error?.message || "Failed to load Labour Audit Report." }, { status: 500 }); } }
