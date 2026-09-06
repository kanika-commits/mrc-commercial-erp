import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/serverPermissions";
import type { ServerPermissionContext } from "@/lib/serverPermissions";
import { createPrivateStorageAdapter, safeObjectKey } from "@/lib/storage/privateStorage";
import { getEmployeeSignatureBlock } from "@/lib/hr/employeeSignature";
import {
  canAccessHrEmployee,
  HR_EMPLOYEES_MODULE_CODE,
  hrAdminClient,
} from "../../_shared";
import { insertErpAuditLog } from "@/lib/serverAudit";

const SIGNATURE_BUCKET = "employee-signatures";
const MAX_SIGNATURE_SIZE = 2 * 1024 * 1024;
const ALLOWED_SIGNATURE_TYPES = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
]);

type EmployeeSignatureAccessRow = {
  id: string;
  organization_id: string;
  company_id?: string | null;
  site_id?: string | null;
  status?: string | null;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function userName(auth: ServerPermissionContext) {
  return (
    auth.user.user_metadata?.full_name ||
    auth.user.user_metadata?.name ||
    auth.user.email ||
    "HR User"
  );
}

function cleanText(value: FormDataEntryValue | null) {
  return String(value || "").trim() || null;
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
  if (!employee) return { error: "Employee was not found.", status: 404 } as const;
  if (!(await canAccessHrEmployee(admin, auth, employee))) {
    return { error: "You do not have access to this employee.", status: 403 } as const;
  }

  return { employee: employee as EmployeeSignatureAccessRow } as const;
}

async function loadActiveSignature(admin: ReturnType<typeof hrAdminClient>, employeeId: string) {
  const { data, error } = await admin
    .from("employee_signature_profiles")
    .select("*")
    .eq("employee_id", employeeId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function signatureResponse(admin: ReturnType<typeof hrAdminClient>, employeeId: string) {
  const [signature, block] = await Promise.all([
    loadActiveSignature(admin, employeeId),
    getEmployeeSignatureBlock(admin, { employeeId }),
  ]);

  return NextResponse.json({ signature, signatureBlock: block });
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

    return signatureResponse(admin, id);
  } catch (error: unknown) {
    return jsonError(errorMessage(error, "Failed to load employee signature."), 500);
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
    const file = formData.get("signature");
    if (!(file instanceof File) || file.size === 0) {
      return jsonError("Signature image is required.", 400);
    }

    const extension = ALLOWED_SIGNATURE_TYPES.get(file.type);
    if (!extension) {
      return jsonError("Only PNG, JPG and WEBP signature images are allowed.", 400);
    }

    if (file.size > MAX_SIGNATURE_SIZE) {
      return jsonError("Signature image must be 2MB or smaller.", 400);
    }

    const employee = employeeResult.employee;
    const currentSignature = await loadActiveSignature(admin, id);
    const storage = createPrivateStorageAdapter(admin);
    const key = safeObjectKey([employee.organization_id, id, `signature-${crypto.randomUUID()}.${extension}`]);
    const stored = await storage.upload({ bucket: SIGNATURE_BUCKET, key, file });
    const actorName = userName(auth);
    const patch = {
      organization_id: employee.organization_id,
      employee_id: id,
      storage_provider: stored.provider,
      storage_bucket: stored.bucket,
      storage_key: stored.key,
      original_file_name: stored.originalFileName,
      mime_type: stored.mimeType,
      size_bytes: stored.sizeBytes,
      initials: cleanText(formData.get("initials")),
      display_title: cleanText(formData.get("display_title")),
      is_active: true,
      updated_by: auth.user.id,
      updated_by_name: actorName,
      updated_by_email: auth.user.email || null,
      updated_at: new Date().toISOString(),
    };
    let signatureRecordId = currentSignature?.id || null;

    try {
      if (currentSignature) {
        const { error: updateError } = await admin
          .from("employee_signature_profiles")
          .update(patch)
          .eq("id", currentSignature.id);
        if (updateError) throw updateError;
      } else {
        const { data: insertedSignature, error: insertError } = await admin
          .from("employee_signature_profiles")
          .insert({
            ...patch,
            created_by: auth.user.id,
            created_by_name: actorName,
            created_by_email: auth.user.email || null,
          })
          .select("id")
          .single();
        if (insertError) throw insertError;
        signatureRecordId = insertedSignature.id;
      }
    } catch (error) {
      await storage.delete({ bucket: stored.bucket, key: stored.key });
      throw error;
    }

    if (currentSignature?.storage_bucket && currentSignature?.storage_key && currentSignature.storage_key !== stored.key) {
      await storage.delete({ bucket: currentSignature.storage_bucket, key: currentSignature.storage_key });
    }

    await insertErpAuditLog(admin, auth.user, {
      organizationId: employee.organization_id,
      companyId: employee.company_id,
      siteId: employee.site_id,
      moduleCode: HR_EMPLOYEES_MODULE_CODE,
      entityType: "employee_signature_profile",
      recordId: signatureRecordId || id,
      parentEntityType: "hr_employee",
      parentRecordId: id,
      action: currentSignature ? "document_replace" : "document_upload",
      description: currentSignature ? "Employee signature replaced." : "Employee signature uploaded.",
      oldValues: currentSignature ? { storage_bucket: currentSignature.storage_bucket, storage_key: currentSignature.storage_key } : null,
      newValues: { storage_bucket: stored.bucket, storage_key: stored.key },
      source: "system",
    }, request);

    return signatureResponse(admin, id);
  } catch (error: unknown) {
    return jsonError(errorMessage(error, "Failed to save employee signature."), 500);
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return POST(request, context);
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

    const currentSignature = await loadActiveSignature(admin, id);
    if (!currentSignature) {
      return NextResponse.json({ removed: true, signature: null, signatureBlock: await getEmployeeSignatureBlock(admin, { employeeId: id }) });
    }

    const storage = createPrivateStorageAdapter(admin);
    if (currentSignature.storage_bucket && currentSignature.storage_key) {
      await storage.delete({ bucket: currentSignature.storage_bucket, key: currentSignature.storage_key });
    }

    const { error: updateError } = await admin
      .from("employee_signature_profiles")
      .update({
        is_active: false,
        updated_by: auth.user.id,
        updated_by_name: userName(auth),
        updated_by_email: auth.user.email || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", currentSignature.id);

    if (updateError) throw updateError;

    await insertErpAuditLog(admin, auth.user, {
      organizationId: employeeResult.employee.organization_id,
      companyId: employeeResult.employee.company_id,
      siteId: employeeResult.employee.site_id,
      moduleCode: HR_EMPLOYEES_MODULE_CODE,
      entityType: "employee_signature_profile",
      recordId: currentSignature.id,
      parentEntityType: "hr_employee",
      parentRecordId: id,
      action: "document_delete",
      description: "Employee signature removed.",
      oldValues: { storage_bucket: currentSignature.storage_bucket, storage_key: currentSignature.storage_key },
      newValues: { is_active: false },
      source: "system",
    }, request);

    return NextResponse.json({ removed: true, signature: null, signatureBlock: await getEmployeeSignatureBlock(admin, { employeeId: id }) });
  } catch (error: unknown) {
    return jsonError(errorMessage(error, "Failed to remove employee signature."), 500);
  }
}
