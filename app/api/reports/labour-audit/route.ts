import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";
import { applyCompanySiteScope, loadCompanySiteAssignments } from "@/app/api/labour/_shared";
import { loadPermissionContext, hasServerPermission } from "@/lib/serverPermissions";
import { loadActorOrganizationScope, type OrganizationScope } from "@/lib/serverOrganizationScope";
import { conciseAuditSummary, deriveAuditEvent, presentAuditChanges, resolveLabourIdentity, type LabourAuditReferenceMaps } from "@/lib/reports/labourAuditPresentation";
import { assignmentCoversScope, filterAuditRowsByScope } from "@/lib/reports/labourAuditScope";

const PAGE_SIZE = 50;
const EXPORT_LIMIT = 5000;
const METADATA_LIMIT = 200;
const EVENT_LABELS: Record<string, string> = { create: "Registered", update: "Profile Updated", employment_change: "Employment Changed", salary_revision: "Rate Changed", transfer: "Transferred", activate: "Activated", deactivate: "Inactivated" };
type AuditChange = { field: string; before: string; after: string };
type ReportRow = { id: string; at: string; labour_id: string; labour_name: string; event: string; summary: string; site: string; company: string; from_site: string; to_site: string; contractor: string; performed_by: string; reason: string; changes: AuditChange[] };

function adminClient() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!); }
function rejected(message: string, code: string) { return { response: NextResponse.json({ error: message, rejection_code: process.env.NODE_ENV === "development" ? code : undefined }, { status: 403 }) } as const; }
function normalizeRow(row: any, maps: LabourAuditReferenceMaps): ReportRow { const presented = presentAuditChanges(row.old_values, row.new_values, maps); const changes = presented.map((change) => ({ field: change.label, before: change.before, after: change.after })); const summaryChanges = presented.filter((change) => change.bothSnapshotsPresent !== false); const before = row.old_values || {}; const after = row.new_values || {}; const identity = resolveLabourIdentity(row.record_id, before, after, maps, row.action); return { id: row.id, at: row.created_at, labour_id: identity.code || "", labour_name: identity.display, event: deriveAuditEvent(row.action, presented), summary: conciseAuditSummary(summaryChanges) || String(row.description || "—"), site: row.site_name || maps.sites?.get(String(row.site_id || "")) || "Unavailable", company: row.company_name || maps.companies?.get(String(row.company_id || "")) || "Unavailable", from_site: before.from_site_name || "—", to_site: after.to_site_name || "—", contractor: after.contractor_name || before.contractor_name || "—", performed_by: row.created_by_name || row.created_by_email || "Unavailable", reason: after.__audit?.reason || "Unavailable", changes }; }
async function loadAuthorizedActors(admin: any, organizationId: string, assignments: { companyIds: string[] | null; siteIds: string[] | null }, selectedCompanyId: string | null, selectedSiteId: string | null) {
  const actorMetadataLimit = 200;
  const [profilesResult, assignmentsResult, userRolesResult, userPermissionsResult] = await Promise.all([
    admin.from("profiles").select("id,full_name,email,status").eq("status", "active").range(0, actorMetadataLimit - 1),
    admin.from("user_access_assignments").select("user_id,organization_id,company_id,site_id").eq("organization_id", organizationId).range(0, actorMetadataLimit - 1),
    admin.from("user_roles").select("user_id,role_id").range(0, actorMetadataLimit - 1),
    admin.from("user_permissions").select("user_id,module_code,action_code,allowed").eq("allowed", true).range(0, actorMetadataLimit - 1),
  ]);
  if (profilesResult.error || assignmentsResult.error || userRolesResult.error || userPermissionsResult.error) throw profilesResult.error || assignmentsResult.error || userRolesResult.error || userPermissionsResult.error;
  const roleIds = Array.from(new Set((userRolesResult.data || []).map((row: any) => row.role_id).filter(Boolean)));
  const [rolesResult, rolePermissionsResult] = await Promise.all([
    roleIds.length ? admin.from("roles").select("id,status").in("id", roleIds).range(0, actorMetadataLimit - 1) : { data: [], error: null },
    roleIds.length ? admin.from("role_permissions").select("role_id,module_code,action_code,allowed").in("role_id", roleIds).eq("allowed", true).range(0, actorMetadataLimit - 1) : { data: [], error: null },
  ]);
  if (rolesResult.error || rolePermissionsResult.error) throw rolesResult.error || rolePermissionsResult.error;
  const activeRoleIds = new Set((rolesResult.data || []).filter((row: any) => row.status === "active").map((row: any) => row.id));
  const labourUsers = new Set((userPermissionsResult.data || []).filter((row: any) => row.module_code === "labour_workers" && row.action_code === "view").map((row: any) => row.user_id));
  const userRoleIds = new Map<string, string[]>();
  for (const row of userRolesResult.data || []) if (activeRoleIds.has(row.role_id)) userRoleIds.set(row.user_id, [...(userRoleIds.get(row.user_id) || []), row.role_id]);
  const labourRoleIds = new Set((rolePermissionsResult.data || []).filter((row: any) => row.module_code === "labour_workers" && row.action_code === "view").map((row: any) => row.role_id));
  for (const [userId, roleIdsForUser] of userRoleIds) if (roleIdsForUser.some((roleId) => labourRoleIds.has(roleId))) labourUsers.add(userId);
  const scopeRows = (assignmentsResult.data || []).filter((row: any) => row.organization_id === organizationId && labourUsers.has(row.user_id));
  const siteIds = Array.from(new Set(scopeRows.map((row: any) => row.site_id).filter(Boolean)));
  const sitesResult = siteIds.length ? await admin.from("sites").select("id,site_name").eq("organization_id", organizationId).in("id", siteIds).range(0, actorMetadataLimit - 1) : { data: [], error: null };
  if (sitesResult.error) throw sitesResult.error;
  const siteNames = new Map<string, string>((sitesResult.data || []).map((row: any) => [String(row.id), String(row.site_name || row.id)]));
  const scopeAllows = (row: any) => {
    const viewerAllowed = assignments.siteIds === null && assignments.companyIds === null ||
      (row.company_id === null && row.site_id === null) ||
      (assignments.siteIds !== null && Boolean(row.site_id && assignments.siteIds.includes(row.site_id))) ||
      Boolean(row.company_id && assignments.companyIds?.includes(row.company_id));
    if (!viewerAllowed) return false;
    return assignmentCoversScope(row, { companyId: selectedCompanyId, siteId: selectedSiteId });
  };
  const grouped = new Map<string, { id: string; name: string; email: string | null; group: string }>();
  for (const row of scopeRows.filter(scopeAllows)) {
    const profile = (profilesResult.data || []).find((candidate: any) => candidate.id === row.user_id);
    if (!profile) continue;
    const existing = grouped.get(profile.id);
    const group = row.company_id === null && row.site_id === null ? "Organization-wide / Head Office" : row.site_id ? (siteNames.get(row.site_id) || (selectedSiteId ? "Selected site access" : "Site-scoped access")) : "Company-wide";
    const rank = group === "Organization-wide / Head Office" ? 0 : group === "Company-wide" ? 1 : 2;
    const existingRank = existing ? (existing.group === "Organization-wide / Head Office" ? 0 : existing.group === "Company-wide" ? 1 : 2) : Number.POSITIVE_INFINITY;
    if (!existing || rank < existingRank || (rank === existingRank && group.localeCompare(existing.group) < 0)) grouped.set(profile.id, { id: profile.id, name: profile.full_name || profile.email || "Authorized user", email: profile.email || null, group });
  }
  return Array.from(grouped.values()).sort((left, right) => left.group.localeCompare(right.group) || left.name.localeCompare(right.name) || (left.email || "").localeCompare(right.email || ""));
}
function organizationIdForRequest(scope: OrganizationScope) {
  if (scope?.length === 1) return scope[0];
  return null;
}

async function loadRows(request: Request, exportMode: boolean) {
  const auth = await loadPermissionContext(request);
  if ("response" in auth) return auth;
  if (!hasServerPermission(auth, "reports", "view")) return rejected("Reports access is required.", "REPORT_PERMISSION_DENIED");
  if (!hasServerPermission(auth, "labour_workers", "view")) return rejected("Labour access is required.", "LABOUR_PERMISSION_DENIED");
  const admin = adminClient();
  const scope = await loadActorOrganizationScope(admin, auth);
  const organizationId = organizationIdForRequest(scope);
  if (!organizationId) return rejected("A permitted organization context is required.", "TENANT_NOT_RESOLVED");
  const assignments = await loadCompanySiteAssignments(admin, auth, scope);
  const modulesResult = await admin.from("organization_modules").select("module_code,enabled").eq("organization_id", organizationId).in("module_code", ["reports", "labour"]);
  if (modulesResult.error) throw modulesResult.error;
  const enabledModules = new Set((modulesResult.data || []).filter((row: any) => row.enabled === true).map((row: any) => row.module_code));
  if (!enabledModules.has("reports")) return rejected("Reports module is not enabled for this organization.", "REPORT_NOT_ENTITLED");
  if (!enabledModules.has("labour")) return rejected("Labour module is not enabled for this organization.", "LABOUR_NOT_ENTITLED");
  const params = new URL(request.url).searchParams;
  const siteId = params.get("site_id");
  const companyId = params.get("company_id");
  if (companyId && assignments.companyIds !== null && !assignments.companyIds.includes(companyId)) return { response: NextResponse.json({ error: "Selected company is outside your authorized scope." }, { status: 403 }) } as const;
  if (siteId && assignments.siteIds !== null && !assignments.siteIds.includes(siteId)) return { response: NextResponse.json({ error: "Selected site is outside your authorized scope." }, { status: 403 }) } as const;
  if (params.get("metadata") === "true") {
    const organizationResult = await admin.from("organizations").select("name,code").eq("id", organizationId).maybeSingle();
    if (organizationResult.error) throw organizationResult.error;
    let companiesQuery: any = admin.from("companies").select("id,company_name").eq("organization_id", organizationId).eq("status", "active").order("company_name").range(0, METADATA_LIMIT - 1);
    companiesQuery = assignments.companyIds !== null ? (assignments.companyIds.length ? companiesQuery.in("id", assignments.companyIds) : null) : companiesQuery;
    const companiesResult = companiesQuery ? await companiesQuery : { data: [], error: null };
    if (companiesResult.error) throw companiesResult.error;
    let sitesQuery: any = admin.from("sites").select("id,site_name").eq("organization_id", organizationId).eq("status", "active").order("site_name").range(0, METADATA_LIMIT - 1);
    if (assignments.siteIds !== null) sitesQuery = assignments.siteIds.length ? sitesQuery.in("id", assignments.siteIds) : null;
    const sitesResult = sitesQuery ? await sitesQuery : { data: [], error: null };
    if (sitesResult.error) throw sitesResult.error;
    let workersQuery: any = admin.from("labour_workers").select("id,labour_code,worker_name,current_company_id,current_site_id").eq("organization_id", organizationId).neq("status", "deleted").order("worker_name").range(0, METADATA_LIMIT - 1);
    const labourBeforeResult = await admin.from("labour_workers").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).neq("status", "deleted");
    if (labourBeforeResult.error) throw labourBeforeResult.error;
    if (companyId && workersQuery) workersQuery = workersQuery.eq("current_company_id", companyId);
    if (siteId && workersQuery) workersQuery = workersQuery.eq("current_site_id", siteId);
    workersQuery = applyCompanySiteScope(workersQuery, assignments, "current_company_id", "current_site_id");
    const workersResult = workersQuery ? await workersQuery : { data: [], error: null };
    if (workersResult.error) throw workersResult.error;
    const actors = await loadAuthorizedActors(admin, organizationId, assignments, companyId, siteId);
    const metadata = { metadata: true, report_available: true, organization_id: organizationId, companies: companiesResult.data || [], sites: sitesResult.data || [], labour: workersResult.data || [], actors };
    if (process.env.NODE_ENV === "development") {
      return {
        ...metadata,
        debug: {
          organization: organizationResult.data ? { name: organizationResult.data.name, code: organizationResult.data.code } : null,
          scope: assignments.siteIds === null ? "Organization-wide" : "Site-restricted",
          tenant_super_admin: auth.roleCodes.includes("super_admin"),
          authorized_site_count: assignments.siteIds === null ? (sitesResult.data || []).length : assignments.siteIds.length,
          active_organization_site_count: (sitesResult.data || []).length,
          returned_site_count: (sitesResult.data || []).length,
          returned_company_count: (companiesResult.data || []).length,
          returned_labour_count: (workersResult.data || []).length,
          labour_before_scope: labourBeforeResult.count || 0,
          authorized_audit_row_count: actors.length,
          distinct_actor_count: actors.length,
          returned_actor_count: actors.length,
        },
      };
    }
    return metadata;
  }
  const page = Math.max(1, Number(new URL(request.url).searchParams.get("page") || "1") || 1);
  const pageSize = exportMode ? EXPORT_LIMIT : PAGE_SIZE;
  const start = exportMode ? 0 : (page - 1) * PAGE_SIZE;
  let query: any = admin.from("erp_audit_logs").select("id,organization_id,company_id,site_id,record_id,action,description,old_values,new_values,created_by,created_by_name,created_by_email,created_at", { count: "exact" }).eq("organization_id", organizationId).eq("module_code", "labour_workers").order("created_at", { ascending: false }).range(start, start + pageSize - 1);
  const from = params.get("date_from"); const to = params.get("date_to"); const search = params.get("search")?.trim(); const event = params.get("event"); const labourId = params.get("labour_id"); const performedBy = params.get("performed_by");
  if (companyId) query = query.eq("company_id", companyId);
  if (from) query = query.gte("created_at", `${from}T00:00:00.000Z`); if (to) query = query.lt("created_at", `${to}T23:59:59.999Z`); if (event) query = query.eq("action", event); if (search) query = query.or(`record_id.eq.${search},created_by_name.ilike.%${search}%`); if (labourId) query = query.eq("record_id", labourId); if (performedBy) query = query.eq("created_by", performedBy); if (siteId) query = query.eq("site_id", siteId);
  query = applyCompanySiteScope(query, assignments); if (!query) return { rows: [], page_size: PAGE_SIZE, export_limit: EXPORT_LIMIT };
  const result = await query; if (result.error) throw result.error;
  const scopedRows = filterAuditRowsByScope(result.data || [], { companyId, siteId });
  const siteIds = Array.from(new Set(scopedRows.map((row: any) => row.site_id).filter(Boolean))); const companyIds = Array.from(new Set(scopedRows.map((row: any) => row.company_id).filter(Boolean))); const labourIds = Array.from(new Set(scopedRows.map((row: any) => row.record_id).filter(Boolean)));
  const [sites, companies, labour] = await Promise.all([siteIds.length ? admin.from("sites").select("id,site_name").eq("organization_id", organizationId).in("id", siteIds) : { data: [], error: null }, companyIds.length ? admin.from("companies").select("id,company_name").eq("organization_id", organizationId).in("id", companyIds) : { data: [], error: null }, labourIds.length ? admin.from("labour_workers").select("id,worker_name,labour_code").eq("organization_id", organizationId).in("id", labourIds) : { data: [], error: null }]);
  if (sites.error) throw sites.error; if (companies.error) throw companies.error; if (labour.error) throw labour.error;
  const siteMap: Map<string, string> = new Map((sites.data || []).map((row: any) => [String(row.id), String(row.site_name || "—")])); const companyMap: Map<string, string> = new Map((companies.data || []).map((row: any) => [String(row.id), String(row.company_name || "—")])); const labourMap: Map<string, string> = new Map((labour.data || []).map((row: any) => [String(row.id), [row.labour_code, row.worker_name].filter(Boolean).join(" — ")])); const actorMap: Map<string, string> = new Map(scopedRows.filter((row: any) => row.created_by).map((row: any) => [String(row.created_by), String(row.created_by_name || row.created_by_email || "Historical actor")]));
  return { rows: scopedRows.map((row: any) => normalizeRow({ ...row, site_name: siteMap.get(row.site_id), company_name: companyMap.get(row.company_id) }, { sites: siteMap, companies: companyMap, labour: labourMap, actors: actorMap })), page, page_size: PAGE_SIZE, total: scopedRows.length, export_limit: EXPORT_LIMIT };
}

async function excelResponse(rows: ReportRow[]) { const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("Labour Audit"); const headers = ["Date & Time", "Labour", "Event", "Field Changed", "Previous Value", "New Value", "Company", "Site", "Performed By", "Reason"]; sheet.columns = headers.map((header) => ({ header, key: header, width: Math.max(16, header.length + 2) })); sheet.autoFilter = { from: "A1", to: `J${Math.max(1, rows.reduce((count, row) => count + Math.max(1, row.changes.length), 0) + 1)}` }; for (const row of rows) for (const change of row.changes) sheet.addRow({ "Date & Time": new Date(row.at).toLocaleString("en-IN"), Labour: row.labour_name, Event: row.event, "Field Changed": change.field, "Previous Value": change.before, "New Value": change.after, Company: row.company, Site: row.site, "Performed By": row.performed_by, Reason: row.reason }); sheet.getRow(1).font = { bold: true }; const buffer = await workbook.xlsx.writeBuffer(); return new NextResponse(buffer, { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": "attachment; filename=Labour_Audit_Report.xlsx" } }); }
function pdfSafeText(value: unknown) { return String(value || "—").replace(/[—–]/g, "-").replace(/[→⇒]/g, "->").replace(/[•·]/g, "*").replace(/\u00a0/g, " ").replace(/[^\x09-\x7E]/g, "?"); }
function pdfLines(text: string, font: any, size: number, width: number) { const words = pdfSafeText(text).split(/\s+/); const lines: string[] = []; let current = ""; for (const word of words) { const next = current ? `${current} ${word}` : word; if (font.widthOfTextAtSize(next, size) > width && current) { lines.push(current); current = word; } else current = next; } if (current) lines.push(current); return lines.length ? lines : ["-"]; }
async function pdfResponse(rows: ReportRow[]) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageSize: [number, number] = [842, 595];
  const margin = 28;
  const widths = [92, 125, 82, 265, 105, 105];
  const headers = ["Date & Time", "Labour", "Event", "Change Summary", "Site", "Performed By"];
  let page = pdf.addPage(pageSize); let y = 555; let pageNumber = 1;
  const lineHeight = 10; const fontSize = 8;
  const lines = (value: unknown, width: number) => pdfLines(String(value || "-"), font, fontSize, width - 8);
  const drawHeader = () => { page.drawText("SiteQube", { x: margin, y, size: 10, font: bold }); y -= 16; page.drawText("Labour Audit Report", { x: margin, y, size: 17, font: bold }); y -= 24; page.drawText(`Generated On: ${new Date().toLocaleString("en-IN")}`, { x: margin, y, size: 8, font }); y -= 18; };
  const drawTableHeader = () => { let x = margin; page.drawRectangle({ x: margin, y: y - 4, width: widths.reduce((a,b)=>a+b,0), height: 18, color: rgb(0.12,0.2,0.32) }); headers.forEach((header, i) => { page.drawText(header, { x: x + 4, y, size: fontSize, font: bold, color: rgb(1,1,1) }); x += widths[i]; }); y -= 22; };
  const footer = () => page.drawText(`Page ${pageNumber}`, { x: pageSize[0] - 70, y: 18, size: 8, font });
  drawHeader(); drawTableHeader();
  for (const row of rows) {
    const cells = [new Date(row.at).toLocaleString("en-IN"), row.labour_name, row.event, row.summary, row.site, row.performed_by].map((value, i) => lines(value, widths[i]));
    const height = Math.max(...cells.map((cell) => cell.length), 1) * lineHeight + 8;
    if (y - height < 34) { footer(); page = pdf.addPage(pageSize); pageNumber++; y = 555; drawHeader(); drawTableHeader(); }
    let x = margin; cells.forEach((cell, i) => { cell.forEach((line, n) => page.drawText(line, { x: x + 4, y: y - n * lineHeight, size: fontSize, font })); x += widths[i]; });
    page.drawLine({ start: { x: margin, y: y - height + 2 }, end: { x: margin + widths.reduce((a,b)=>a+b,0), y: y - height + 2 }, thickness: 0.4, color: rgb(0.8,0.82,0.85) }); y -= height;
  }
  footer();
  return new NextResponse(Buffer.from(await pdf.save()), { headers: { "content-type": "application/pdf", "content-disposition": "attachment; filename=Labour_Audit_Report.pdf" } });
}
export async function GET(request: Request) { try { const format = new URL(request.url).searchParams.get("format"); const loaded: any = await loadRows(request, Boolean(format)); if ("response" in loaded) return loaded.response; if (format === "excel") return excelResponse(loaded.rows || []); if (format === "pdf") return pdfResponse(loaded.rows || []); return NextResponse.json(loaded); } catch { console.error("[Labour Audit Report] request failed"); return NextResponse.json({ error: "Unable to load Labour Audit Report." }, { status: 500 }); } }
