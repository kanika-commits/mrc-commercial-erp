import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/serverPermissions";
import type { ServerPermissionContext } from "@/lib/serverPermissions";
import {
  canAccessHrEmployee,
  HR_EMPLOYEES_MODULE_CODE,
  hrAdminClient,
} from "../../../_shared";
import { insertErpAuditLog } from "@/lib/serverAudit";

const DOCUMENT_BUCKET = "employee-documents";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function normalizeStoragePath(value: string | null | undefined) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (!raw.startsWith("http")) return raw.replace(/^\/+/, "");

  const marker = `/storage/v1/object/public/${DOCUMENT_BUCKET}/`;
  const markerIndex = raw.indexOf(marker);

  if (markerIndex >= 0) {
    return decodeURIComponent(raw.slice(markerIndex + marker.length));
  }

  return raw;
}

async function loadEmployeeForAccess(
  admin: ReturnType<typeof hrAdminClient>,
  auth: ServerPermissionContext,
  employeeId: string,
) {
  const { data: employee, error } = await admin
    .from("hr_employees")
    .select("id, organization_id, company_id, site_id, status")
    .eq("id", employeeId)
    .neq("status", "deleted")
    .maybeSingle();

  if (error) throw error;

  if (!employee) {
    return { error: "Employee was not found.", status: 404 } as const;
  }

  if (!(await canAccessHrEmployee(admin, auth, employee))) {
    return { error: "You do not have access to this employee.", status: 403 } as const;
  }

  return { employee } as const;
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; docId: string }> },
) {
  try {
    const auth = await requirePermission(request, HR_EMPLOYEES_MODULE_CODE, "edit");
    if ("response" in auth) return auth.response;

    const { id, docId } = await context.params;
    const admin = hrAdminClient();
    const employeeResult = await loadEmployeeForAccess(admin, auth, id);

    if ("error" in employeeResult) {
      return jsonError(employeeResult.error || "You do not have access to this employee.", employeeResult.status || 403);
    }

    const { employee } = employeeResult;
    const { data: document, error: documentError } = await admin
      .from("employee_documents")
      .select("id, organization_id, employee_id, document_type, document_name, storage_path, file_url")
      .eq("id", docId)
      .eq("employee_id", id)
      .maybeSingle();

    if (documentError) throw documentError;

    if (!document) {
      return jsonError("Employee document was not found.", 404);
    }

    if (document.organization_id !== employee.organization_id) {
      return jsonError("You do not have access to this document.", 403);
    }

    const path = normalizeStoragePath(document.storage_path || document.file_url);
    if (path) {
      const { error: storageError } = await admin.storage.from(DOCUMENT_BUCKET).remove([path]);
      if (storageError) {
        return jsonError("Could not delete the stored employee document file. No database record was removed.", 500);
      }
    }

    const { error } = await admin
      .from("employee_documents")
      .delete()
      .eq("id", docId)
      .eq("employee_id", id);

    if (error) throw error;

    await insertErpAuditLog(admin, auth.user, {
      organizationId: employee.organization_id,
      companyId: employee.company_id,
      siteId: employee.site_id,
      moduleCode: "hr_employees",
      entityType: "employee_document",
      recordId: docId,
      parentEntityType: "hr_employee",
      parentRecordId: id,
      action: "document_delete",
      description: `${document.document_type || "Employee"} document deleted.`,
      oldValues: document,
      newValues: null,
      source: "system",
    }, request);

    return NextResponse.json({ deleted: true });
  } catch (error: unknown) {
    return jsonError(errorMessage(error, "Failed to delete employee document."), 500);
  }
}
