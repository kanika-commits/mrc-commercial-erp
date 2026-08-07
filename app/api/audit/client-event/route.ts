import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { recordAuditEvent } from "@/lib/auditEvent";
import { hasServerPermission, loadPermissionContext } from "@/lib/serverPermissions";

const EVENT_TYPES = new Set(["view_page", "view_record", "view_document", "download_document", "export", "print"]);

const PAGE_EVENTS: Record<string, { label: string; permission?: { module: string; action: string } }> = {
  dashboard: { label: "Opened Dashboard" },
  work_orders_register: { label: "Opened Work Orders Register", permission: { module: "work_orders", action: "view" } },
  ra_bills_register: { label: "Opened RA Bills Register", permission: { module: "ra_bills", action: "view" } },
  invoices_register: { label: "Opened Invoice Register", permission: { module: "invoices", action: "view" } },
  payments_register: { label: "Opened Payments Register", permission: { module: "payments", action: "view" } },
  debit_notes_register: { label: "Opened Debit Notes Register", permission: { module: "debit_notes", action: "view" } },
  vendors_register: { label: "Opened Vendors Register", permission: { module: "vendors", action: "view" } },
  employees_register: { label: "Opened Employees Register", permission: { module: "hr_employees", action: "view" } },
  labour_workers_register: { label: "Opened Labour Workers Register", permission: { module: "labour_workers", action: "view" } },
  labour_workspace: { label: "Opened Labour Workspace", permission: { module: "labour_workers", action: "view" } },
  labour_registration: { label: "Opened Labour Registration", permission: { module: "labour_workers", action: "view" } },
  labour_import: { label: "Opened Labour Import", permission: { module: "labour_workers", action: "view" } },
  labour_attendance: { label: "Opened Labour Attendance", permission: { module: "labour_attendance", action: "view" } },
  employee_attendance: { label: "Opened HR Attendance", permission: { module: "hr_attendance", action: "view" } },
  organizations: { label: "Opened Organizations", permission: { module: "organizations", action: "view" } },
  companies: { label: "Opened Companies", permission: { module: "companies", action: "view" } },
  sites: { label: "Opened Sites", permission: { module: "sites", action: "view" } },
  users: { label: "Opened Users", permission: { module: "admin_users", action: "view" } },
  roles: { label: "Opened Roles", permission: { module: "admin_roles", action: "view" } },
  reports: { label: "Opened Reports", permission: { module: "reports", action: "view" } },
  settings: { label: "Opened Settings", permission: { module: "settings", action: "view" } },
};

const ENTITIES: Record<string, { table: string; module: string; label: (row: any) => string; scope?: (row: any) => Record<string, string | null> }> = {
  work_order: { table: "work_orders", module: "work_orders", label: row => row.wo_number || row.id, scope: row => ({ organizationId: row.organization_id, companyId: row.company_id, siteId: row.site_id }) },
  ra_bill: { table: "ra_bills", module: "ra_bills", label: row => row.ra_bill_number || row.bill_number || row.id, scope: row => ({ organizationId: row.organization_id, companyId: row.company_id, siteId: row.site_id }) },
  invoice: { table: "invoices", module: "invoices", label: row => row.invoice_number || row.id, scope: row => ({ organizationId: row.organization_id, companyId: row.company_id, siteId: row.site_id }) },
  payment: { table: "payments", module: "payments", label: row => row.payment_number || row.id, scope: row => ({ organizationId: row.organization_id, companyId: row.company_id, siteId: row.site_id }) },
  debit_note: { table: "debit_notes", module: "debit_notes", label: row => row.debit_note_number || row.note_number || row.id, scope: row => ({ organizationId: row.organization_id, companyId: row.company_id, siteId: row.site_id }) },
  vendor: { table: "vendors", module: "vendors", label: row => row.vendor_name || row.id, scope: row => ({ organizationId: row.organization_id, companyId: row.company_id, siteId: row.site_id }) },
  employee: { table: "hr_employees", module: "hr_employees", label: row => row.employee_code || row.employee_name || row.id, scope: row => ({ organizationId: row.organization_id, companyId: row.company_id, siteId: row.site_id }) },
  labour_worker: { table: "labour_workers", module: "labour_workers", label: row => row.labour_code || row.labour_name || row.id, scope: row => ({ organizationId: row.organization_id, companyId: row.company_id, siteId: row.site_id }) },
  organization: { table: "organizations", module: "organizations", label: row => row.name || row.organization_name || row.code || row.id, scope: row => ({ organizationId: row.id, companyId: null, siteId: null }) },
  company: { table: "companies", module: "companies", label: row => row.company_name || row.name || row.company_code || row.id, scope: row => ({ organizationId: row.organization_id, companyId: row.id, siteId: null }) },
  site: { table: "sites", module: "sites", label: row => row.site_name || row.name || row.site_code || row.id, scope: row => ({ organizationId: row.organization_id, companyId: row.company_id, siteId: row.id }) },
  user: { table: "profiles", module: "admin_users", label: row => row.full_name || row.email || row.id },
  role: { table: "roles", module: "admin_roles", label: row => row.role_name || row.name || row.role_code || row.id },
  company_bank_account: { table: "company_bank_accounts", module: "company_bank_accounts", label: row => row.account_name || row.bank_name || row.id, scope: row => ({ organizationId: row.organization_id, companyId: row.company_id, siteId: null }) },
  labour_attendance: { table: "labour_attendance_periods", module: "labour_attendance", label: row => row.period_month || row.id, scope: row => ({ organizationId: row.organization_id, companyId: row.company_id, siteId: row.site_id }) },
  employee_attendance: { table: "hr_attendance_periods", module: "hr_attendance", label: row => row.period_month || row.id, scope: row => ({ organizationId: row.organization_id, companyId: row.company_id, siteId: row.site_id }) },
};

const DOCUMENTS: Record<string, { table: string; parentField: string; fileLabel: (row: any) => string }> = {
  work_order: { table: "work_order_documents", parentField: "work_order_id", fileLabel: row => row.file_name || row.id },
  ra_bill: { table: "ra_bill_documents", parentField: "ra_bill_id", fileLabel: row => row.file_name || row.id },
  invoice: { table: "invoice_documents", parentField: "invoice_id", fileLabel: row => row.file_name || row.id },
  debit_note: { table: "debit_note_documents", parentField: "debit_note_id", fileLabel: row => row.file_name || row.id },
  employee: { table: "employee_documents", parentField: "employee_id", fileLabel: row => row.document_name || row.id },
  vendor: { table: "vendor_documents", parentField: "vendor_id", fileLabel: row => row.file_name || row.id },
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function allowedInScope(context: any, scope: Record<string, string | null>) {
  if (context.roleCodes?.includes("platform_owner")) return true;
  return (!scope.organizationId || context.organizations?.includes(scope.organizationId)) &&
    (!scope.companyId || context.companies?.includes(scope.companyId)) &&
    (!scope.siteId || context.sites?.includes(scope.siteId));
}

export async function POST(request: Request) {
  try {
    const context = await loadPermissionContext(request);
    if ("response" in context) return context.response;
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const body = await request.json().catch(() => ({}));
    const eventType = String(body.event_type || "");
    const entityType = String(body.entity_type || "");
    if (!EVENT_TYPES.has(eventType)) return jsonError("Unsupported audit event.", 400);

    if (eventType === "view_page") {
      const page = PAGE_EVENTS[String(body.page_key || "")];
      if (!page) return jsonError("Unsupported page event.", 400);
      if (page.permission && !hasServerPermission(context, page.permission.module, page.permission.action)) {
        return jsonError("You do not have permission to record this activity.", 403);
      }
      await recordAuditEvent(admin, context.user, {
        moduleCode: "navigation",
        entityType: "page",
        action: "view_page",
        actionCategory: "other",
        activityLabel: page.label,
        description: `${page.label}.`,
        metadata: { source: typeof body.source === "string" ? body.source.slice(0, 120) : null },
      }, request);
      return NextResponse.json({ accepted: true });
    }

    const entity = ENTITIES[entityType];
    if (!entity) return jsonError("Unsupported audit entity.", 400);
    if (!hasServerPermission(context, entity.module, eventType === "export" ? "export" : "view")) {
      return jsonError("You do not have permission to record this activity.", 403);
    }

    const recordId = String(body.record_id || "").trim();
    let record: any = null;
    let document: any = null;
    if (eventType === "view_document" || eventType === "download_document") {
      const documentConfig = DOCUMENTS[entityType];
      if (!documentConfig || !body.document_id || !recordId) return jsonError("Document context is invalid.", 400);
      const documentResult = await admin.from(documentConfig.table).select("*").eq("id", body.document_id).eq(documentConfig.parentField, recordId).maybeSingle();
      if (documentResult.error || !documentResult.data) return jsonError("Document not found.", 404);
      document = documentResult.data;
    }
    if (recordId) {
      const recordResult = await admin.from(entity.table).select("*").eq("id", recordId).maybeSingle();
      if (recordResult.error || !recordResult.data) return jsonError("Record not found.", 404);
      record = recordResult.data;
    }
    if (!record && eventType !== "export") return jsonError("Record context is required.", 400);
    const scope = entity.scope?.(record || {}) || {};
    if (!allowedInScope(context, scope)) return jsonError("Record is outside your access scope.", 403);

    const label = record ? entity.label(record) : null;
    const activityLabel = eventType === "view_record" ? `Viewed ${entityType.replace(/_/g, " ")}`
      : eventType === "view_document" ? `Viewed ${entityType.replace(/_/g, " ")} Document`
      : eventType === "download_document" ? `Downloaded ${entityType.replace(/_/g, " ")} Document`
      : eventType === "export" ? `Exported ${entityType.replace(/_/g, " ")}` : `Printed ${entityType.replace(/_/g, " ")}`;
    await recordAuditEvent(admin, context.user, {
      ...scope,
      moduleCode: entity.module,
      entityType,
      recordId: record?.id || recordId || null,
      recordNumber: label,
      action: eventType,
      actionCategory: eventType.includes("document") ? "document" : "other",
      activityLabel,
      description: document ? `${activityLabel}: ${documentConfigLabel(entityType, document)}.` : `${activityLabel}${label ? `: ${label}` : ""}.`,
      parentEntityType: document ? entityType : null,
      parentRecordId: document ? record?.id || recordId : null,
      metadata: { source: typeof body.source === "string" ? body.source.slice(0, 120) : null, context: body.context || null },
    }, request);
    return NextResponse.json({ accepted: true });
  } catch (error) {
    console.error("Client audit event failed", error);
    return jsonError("Unable to record activity.", 500);
  }
}

function documentConfigLabel(entityType: string, document: any) {
  return DOCUMENTS[entityType]?.fileLabel(document) || document.id;
}
