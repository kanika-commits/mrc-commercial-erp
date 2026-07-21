import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/serverPermissions";
import type { ServerPermissionContext } from "@/lib/serverPermissions";
import {
  canAccessHrEmployee,
  HR_EMPLOYEES_MODULE_CODE,
  hrAdminClient,
} from "../../_shared";
import { insertErpAuditLog } from "@/lib/serverAudit";

const DOCUMENT_BUCKET = "employee-documents";
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_FILENAME_LENGTH = 180;
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);
const EMPLOYEE_DOCUMENT_TYPES = [
  "Employee Photo",
  "Aadhaar Card",
  "PAN Card",
  "Passport",
  "Driving Licence",
  "Voter ID",
  "ESIC Card",
  "PF Document",
  "Bank Proof",
  "Cancelled Cheque",
  "Employment Contract",
  "Offer Letter",
  "Appointment Letter",
  "Confirmation Letter",
  "Resignation Letter",
  "Relieving Letter",
  "Experience Letter",
  "Educational Certificate",
  "Professional Certificate",
  "Police Verification",
  "Medical Certificate",
  "Visa",
  "Work Permit",
  "Other",
] as const;
const EMPLOYEE_DOCUMENT_TYPE_SET = new Set<string>(EMPLOYEE_DOCUMENT_TYPES);

type EmployeeDocumentRow = {
  id: string;
  employee_id: string;
  document_type: string | null;
  document_name: string | null;
  storage_path: string | null;
  file_url: string | null;
  document_number?: string | null;
  metadata?: Record<string, unknown> | null;
  issue_date?: string | null;
  expiry_date?: string | null;
  issuing_authority?: string | null;
  issue_country?: string | null;
  issue_state?: string | null;
  remarks?: string | null;
  version?: number | null;
  is_active?: boolean | null;
  replaced_by_document_id?: string | null;
  mime_type?: string | null;
  file_size?: number | null;
  uploaded_by_name?: string | null;
  uploaded_by_email?: string | null;
  uploaded_at: string | null;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function safeFileName(value: string) {
  return String(value || "document")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 160) || "document";
}

function originalFileName(value: string) {
  return String(value || "").trim();
}

function cleanText(value: FormDataEntryValue | null) {
  return String(value || "").trim() || null;
}

function cleanDate(value: FormDataEntryValue | null) {
  return String(value || "").trim() || null;
}

function isAfterDate(left: string, right: string) {
  return new Date(`${left}T00:00:00Z`).getTime() > new Date(`${right}T00:00:00Z`).getTime();
}

function validateDocumentMetadata(documentType: string, values: {
  documentNumber?: string | null;
  issueDate?: string | null;
  expiryDate?: string | null;
  issueCountry?: string | null;
  issueState?: string | null;
  metadata: Record<string, string | null>;
}) {
  const number = values.documentNumber || "";

  if (documentType === "PAN Card" && number && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(number.toUpperCase())) {
    return "PAN number must be in valid PAN format.";
  }

  if (documentType === "Aadhaar Card" && number && !/^[0-9]{12}$/.test(number.replace(/\s+/g, ""))) {
    return "Aadhaar number must be 12 digits.";
  }

  if (documentType === "Passport" && number && !/^[A-Z][0-9]{7}$/.test(number.toUpperCase())) {
    return "Passport number must be in valid Indian passport format.";
  }

  if (documentType === "Driving Licence" && number && !/^[A-Z0-9 -]{6,30}$/i.test(number)) {
    return "Driving licence number format is invalid.";
  }

  if (values.issueDate && values.expiryDate && isAfterDate(values.issueDate, values.expiryDate)) {
    return "Expiry date cannot be before issue date.";
  }

  if (documentType === "Passport" && !values.issueCountry) {
    return "Passport issue country is required.";
  }

  if (documentType === "Driving Licence" && !values.issueState) {
    return "Driving licence issue state is required.";
  }

  if (documentType === "Educational Certificate" && !values.metadata.qualification) {
    return "Qualification is required for educational certificates.";
  }

  if (documentType === "Bank Proof") {
    if (!values.metadata.bank_name) return "Bank name is required for bank proof.";
    if (!values.metadata.account_number) return "Account number is required for bank proof.";
    if (values.metadata.ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(values.metadata.ifsc.toUpperCase())) {
      return "IFSC format is invalid.";
    }
  }

  if (documentType === "Other" && !values.metadata.title) {
    return "Title is required for Other documents.";
  }

  return null;
}

function userName(auth: ServerPermissionContext) {
  return (
    auth.user.user_metadata?.full_name ||
    auth.user.user_metadata?.name ||
    auth.user.email ||
    "System"
  );
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

async function signedDocument(admin: ReturnType<typeof hrAdminClient>, document: EmployeeDocumentRow) {
  const path = normalizeStoragePath(document.storage_path || document.file_url);
  let signed_url: string | null = null;
  let signed_url_error: string | null = null;

  if (path) {
    const { data, error } = await admin.storage
      .from(DOCUMENT_BUCKET)
      .createSignedUrl(path, 60 * 10);

    signed_url = data?.signedUrl || null;
    signed_url_error = error?.message || null;
  }

  return {
    id: document.id,
    employee_id: document.employee_id,
    document_type: document.document_type,
    document_name: document.document_name,
    file_name: document.document_name,
    document_number: document.document_number,
    metadata: document.metadata || {},
    issue_date: document.issue_date,
    expiry_date: document.expiry_date,
    issuing_authority: document.issuing_authority,
    issue_country: document.issue_country,
    issue_state: document.issue_state,
    remarks: document.remarks,
    version: document.version || 1,
    is_active: document.is_active ?? true,
    replaced_by_document_id: document.replaced_by_document_id,
    mime_type: document.mime_type,
    file_size: document.file_size,
    uploaded_by_name: document.uploaded_by_name,
    uploaded_by_email: document.uploaded_by_email,
    uploaded_at: document.uploaded_at,
    signed_url,
    signed_url_error,
  };
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

    const { data, error } = await admin
      .from("employee_documents")
      .select("id, organization_id, employee_id, document_type, document_name, storage_path, file_url, document_number, metadata, issue_date, expiry_date, issuing_authority, issue_country, issue_state, remarks, version, is_active, replaced_by_document_id, mime_type, file_size, uploaded_by_name, uploaded_by_email, uploaded_at")
      .eq("employee_id", id)
      .order("document_type", { ascending: true })
      .order("version", { ascending: false });

    if (error) throw error;

    const documents = await Promise.all((data || []).map((doc) => signedDocument(admin, doc)));
    return NextResponse.json({ documents });
  } catch (error: unknown) {
    return jsonError(errorMessage(error, "Failed to load employee documents."), 500);
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

    const { employee } = employeeResult;
    const formData = await request.formData();
    const documentType = String(formData.get("document_type") || "").trim();
    const documentNumber = cleanText(formData.get("document_number"));
    const issueDate = cleanDate(formData.get("issue_date"));
    const expiryDate = cleanDate(formData.get("expiry_date"));
    const issuingAuthority = cleanText(formData.get("issuing_authority"));
    const issueCountry = cleanText(formData.get("issue_country"));
    const issueState = cleanText(formData.get("issue_state"));
    const remarks = cleanText(formData.get("remarks"));
    const metadata = {
      qualification: cleanText(formData.get("qualification")),
      university: cleanText(formData.get("university")),
      passing_year: cleanText(formData.get("passing_year")),
      bank_name: cleanText(formData.get("bank_name")),
      account_number: cleanText(formData.get("account_number")),
      ifsc: cleanText(formData.get("ifsc")),
      document_date: cleanDate(formData.get("document_date")),
      title: cleanText(formData.get("title")),
    };
    const files = formData
      .getAll("files")
      .concat(formData.getAll("file"))
      .filter((entry): entry is File => entry instanceof File && entry.size > 0);

    if (!documentType) {
      return jsonError("Document category is required.", 400);
    }

    if (!EMPLOYEE_DOCUMENT_TYPE_SET.has(documentType)) {
      return jsonError("Select a valid employee document category.", 400);
    }

    const metadataError = validateDocumentMetadata(documentType, {
      documentNumber,
      issueDate,
      expiryDate,
      issueCountry,
      issueState,
      metadata,
    });
    if (metadataError) {
      return jsonError(metadataError, 400);
    }

    if (files.length === 0) {
      return jsonError("At least one employee document file is required.", 400);
    }

    for (const file of files) {
      if (!originalFileName(file.name)) {
        return jsonError("Every employee document must have a filename.", 400);
      }

      if (!ALLOWED_MIME_TYPES.has(file.type)) {
        return jsonError("Only JPEG, PNG, WEBP, and PDF files are allowed.", 400);
      }

      if (file.size > MAX_FILE_SIZE) {
        return jsonError("Each employee document must be 10MB or smaller.", 400);
      }

      if (file.name.length > MAX_FILENAME_LENGTH) {
        return jsonError(`File names must be ${MAX_FILENAME_LENGTH} characters or fewer.`, 400);
      }
    }

    if (files.length > 1) {
      return jsonError("Upload one compliance document at a time.", 400);
    }

    const insertedDocuments: EmployeeDocumentRow[] = [];
    const uploadedPaths: string[] = [];

    try {
      for (const file of files) {
        const fileName = originalFileName(file.name);
        const { data: existingVersions, error: versionError } = await admin
          .from("employee_documents")
          .select("id, version")
          .eq("employee_id", id)
          .eq("document_type", documentType)
          .order("version", { ascending: false });

        if (versionError) throw versionError;

        const nextVersion = Math.max(0, ...(existingVersions || []).map((doc) => Number(doc.version || 1))) + 1;
        const path = `${employee.organization_id}/${id}/${Date.now()}-${crypto.randomUUID()}-${safeFileName(file.name)}`;
        const buffer = Buffer.from(await file.arrayBuffer());
        const { error: uploadError } = await admin.storage
          .from(DOCUMENT_BUCKET)
          .upload(path, buffer, {
            contentType: file.type,
            upsert: false,
          });

        if (uploadError) throw uploadError;
        uploadedPaths.push(path);

        const { data: document, error: insertError } = await admin
          .from("employee_documents")
          .insert({
            organization_id: employee.organization_id,
            employee_id: id,
            document_type: documentType,
            document_name: fileName,
            storage_path: path,
            file_url: path,
            document_number: documentNumber,
            metadata,
            issue_date: issueDate,
            expiry_date: expiryDate,
            issuing_authority: issuingAuthority,
            issue_country: issueCountry,
            issue_state: issueState,
            remarks,
            version: nextVersion,
            is_active: true,
            mime_type: file.type,
            file_size: file.size,
            uploaded_by: auth.user.id,
            uploaded_by_name: userName(auth),
            uploaded_by_email: auth.user.email || null,
          })
          .select("id, organization_id, employee_id, document_type, document_name, storage_path, file_url, document_number, metadata, issue_date, expiry_date, issuing_authority, issue_country, issue_state, remarks, version, is_active, replaced_by_document_id, mime_type, file_size, uploaded_by_name, uploaded_by_email, uploaded_at")
          .single();

        if (insertError) throw insertError;

        const previousActiveIds = (existingVersions || []).map((doc) => doc.id);
        if (previousActiveIds.length > 0) {
          const { error: deactivateError } = await admin
            .from("employee_documents")
            .update({
              is_active: false,
              replaced_by_document_id: document.id,
              updated_by: auth.user.id,
              updated_by_name: userName(auth),
              updated_by_email: auth.user.email || null,
              updated_at: new Date().toISOString(),
            })
            .in("id", previousActiveIds);
          if (deactivateError) throw deactivateError;
        }

        await insertErpAuditLog(admin, auth.user, {
          organizationId: employee.organization_id,
          companyId: employee.company_id,
          siteId: employee.site_id,
          moduleCode: "hr_employees",
          entityType: "employee_document",
          recordId: document.id,
          parentEntityType: "hr_employee",
          parentRecordId: id,
          action: previousActiveIds.length > 0 ? "document_replace" : "document_upload",
          description: `${documentType} document ${previousActiveIds.length > 0 ? "replaced" : "uploaded"}.`,
          oldValues: previousActiveIds.length > 0 ? { replaced_document_ids: previousActiveIds } : null,
          newValues: document,
          source: "system",
        }, request);

        insertedDocuments.push(document);
      }
    } catch (error) {
      if (uploadedPaths.length > 0) {
        await admin.storage.from(DOCUMENT_BUCKET).remove(uploadedPaths);
      }
      throw error;
    }

    const documents = await Promise.all(insertedDocuments.map((doc) => signedDocument(admin, doc)));
    return NextResponse.json({ documents });
  } catch (error: unknown) {
    return jsonError(errorMessage(error, "Failed to upload employee documents."), 500);
  }
}
