import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/serverPermissions";
import type { ServerPermissionContext } from "@/lib/serverPermissions";
import {
  canAccessHrEmployee,
  HR_EMPLOYEES_MODULE_CODE,
  hrAdminClient,
} from "../../_shared";
import { insertErpAuditLog } from "@/lib/serverAudit";

const PHOTO_BUCKET = "employee-photos";
const MAX_PHOTO_SIZE = 3 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

type EmployeePhotoRow = {
  id: string;
  organization_id: string;
  company_id?: string | null;
  site_id?: string | null;
  status?: string | null;
  photo_storage_path?: string | null;
  photo_updated_at?: string | null;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

async function loadEmployeeForAccess(
  admin: ReturnType<typeof hrAdminClient>,
  auth: ServerPermissionContext,
  employeeId: string,
) {
  const { data: employee, error } = await admin
    .from("hr_employees")
    .select("id, organization_id, company_id, site_id, status, photo_storage_path, photo_updated_at")
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

  return { employee: employee as EmployeePhotoRow } as const;
}

async function signedPhotoUrl(admin: ReturnType<typeof hrAdminClient>, storagePath?: string | null) {
  if (!storagePath) return null;

  const { data, error } = await admin.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(storagePath, 60 * 10);

  if (error) throw error;
  return data?.signedUrl || null;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requirePermission(request, HR_EMPLOYEES_MODULE_CODE, "view");
    if ("response" in auth) return auth.response;

    const { id } = await context.params;
    const admin = hrAdminClient();
    const employeeResult = await loadEmployeeForAccess(admin, auth, id);

    if ("error" in employeeResult) {
      return jsonError(employeeResult.error || "You do not have access to this employee.", employeeResult.status || 403);
    }

    return NextResponse.json({
      photo_storage_path: employeeResult.employee.photo_storage_path || null,
      photo_updated_at: employeeResult.employee.photo_updated_at || null,
      photo_signed_url: await signedPhotoUrl(admin, employeeResult.employee.photo_storage_path),
    });
  } catch (error: unknown) {
    return jsonError(errorMessage(error, "Failed to load employee photo."), 500);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requirePermission(request, HR_EMPLOYEES_MODULE_CODE, "edit");
    if ("response" in auth) return auth.response;

    const { id } = await context.params;
    const admin = hrAdminClient();
    const employeeResult = await loadEmployeeForAccess(admin, auth, id);

    if ("error" in employeeResult) {
      return jsonError(employeeResult.error || "You do not have access to this employee.", employeeResult.status || 403);
    }

    const formData = await request.formData();
    const file = formData.get("photo");

    if (!(file instanceof File) || file.size === 0) {
      return jsonError("Profile photo is required.", 400);
    }

    const extension = ALLOWED_PHOTO_TYPES.get(file.type);
    if (!extension) {
      return jsonError("Only JPG, PNG and WEBP profile photos are allowed.", 400);
    }

    if (file.size > MAX_PHOTO_SIZE) {
      return jsonError("Profile photo must be 3MB or smaller.", 400);
    }

    const employee = employeeResult.employee;
    const previousPath = employee.photo_storage_path || null;
    const nextPath = `${employee.organization_id}/${id}/profile-${Date.now()}.${extension}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await admin.storage
      .from(PHOTO_BUCKET)
      .upload(nextPath, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) throw uploadError;

    const { error: updateError } = await admin
      .from("hr_employees")
      .update({
        photo_storage_path: nextPath,
        photo_updated_at: new Date().toISOString(),
        updated_by: auth.user.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (updateError) {
      await admin.storage.from(PHOTO_BUCKET).remove([nextPath]);
      throw updateError;
    }

    if (previousPath && previousPath !== nextPath) {
      await admin.storage.from(PHOTO_BUCKET).remove([previousPath]);
    }

    await insertErpAuditLog(admin, auth.user, {
      organizationId: employee.organization_id,
      companyId: employee.company_id,
      siteId: employee.site_id,
      moduleCode: "hr_employees",
      entityType: "hr_employee",
      recordId: id,
      action: previousPath ? "photo_replace" : "photo_upload",
      description: previousPath ? "Employee profile photo replaced." : "Employee profile photo uploaded.",
      oldValues: { photo_storage_path: previousPath },
      newValues: { photo_storage_path: nextPath },
      source: "system",
    }, request);

    return NextResponse.json({
      photo_storage_path: nextPath,
      photo_signed_url: await signedPhotoUrl(admin, nextPath),
    });
  } catch (error: unknown) {
    return jsonError(errorMessage(error, "Failed to upload employee photo."), 500);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requirePermission(request, HR_EMPLOYEES_MODULE_CODE, "edit");
    if ("response" in auth) return auth.response;

    const { id } = await context.params;
    const admin = hrAdminClient();
    const employeeResult = await loadEmployeeForAccess(admin, auth, id);

    if ("error" in employeeResult) {
      return jsonError(employeeResult.error || "You do not have access to this employee.", employeeResult.status || 403);
    }

    const storagePath = employeeResult.employee.photo_storage_path || null;
    if (storagePath) {
      const { error: storageError } = await admin.storage.from(PHOTO_BUCKET).remove([storagePath]);
      if (storageError) {
        return jsonError("Could not delete the stored employee photo. No database path was removed.", 500);
      }
    }

    const { error: updateError } = await admin
      .from("hr_employees")
      .update({
        photo_storage_path: null,
        photo_updated_at: new Date().toISOString(),
        updated_by: auth.user.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (updateError) throw updateError;

    await insertErpAuditLog(admin, auth.user, {
      organizationId: employeeResult.employee.organization_id,
      companyId: employeeResult.employee.company_id,
      siteId: employeeResult.employee.site_id,
      moduleCode: "hr_employees",
      entityType: "hr_employee",
      recordId: id,
      action: "photo_replace",
      description: "Employee profile photo removed.",
      oldValues: { photo_storage_path: storagePath },
      newValues: { photo_storage_path: null },
      source: "system",
    }, request);

    return NextResponse.json({ removed: true });
  } catch (error: unknown) {
    return jsonError(errorMessage(error, "Failed to remove employee photo."), 500);
  }
}
