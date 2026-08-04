import { NextResponse } from "next/server";
import { POST as registerWorker } from "@/app/api/labour/workers/register/route";
import { POST as uploadWorkerDocument } from "@/app/api/labour/workers/[id]/documents/route";
import {
  audit,
  jsonError,
  requireLabourPermission,
  resolveOrganizationId,
  validateLabourCompanySiteIndependent,
} from "@/app/api/labour/_shared";
import { normalizeText } from "@/lib/labour/constants";
import { validateAadhaar } from "@/lib/utils/aadhaar";

const MAX_BATCH_ROWS = 5;

function safeMessage(message: unknown) {
  return normalizeText(message).replace(/[0-9]{4}\s?[0-9]{4}\s?[0-9]{4}/g, "**** **** ****") || "Registration failed.";
}

function parseRows(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return [];
  const rows = JSON.parse(value);
  return Array.isArray(rows) ? rows : [];
}

async function parsePayload(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

function copyAuthHeaders(request: Request) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const authorization = request.headers.get("authorization");
  if (authorization) headers.authorization = authorization;
  return headers;
}

export async function POST(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_workers", "add");
    if ("response" in access) return access.response;
    const formData = await request.formData();
    const rows = parseRows(formData.get("rows"));
    if (!rows.length) return jsonError("No reviewed labour rows were provided.");
    if (rows.length > MAX_BATCH_ROWS) return jsonError("Maximum 5 labourers can be saved at once.");

    const assignment = {
      organization_id: normalizeText(formData.get("organization_id")),
      company_id: normalizeText(formData.get("company_id")),
      site_id: normalizeText(formData.get("site_id")),
      vendor_id: normalizeText(formData.get("vendor_id")),
      work_order_id: normalizeText(formData.get("work_order_id")),
      effective_from: normalizeText(formData.get("effective_from")),
    };
    const organizationId = await resolveOrganizationId(access, assignment.organization_id);
    if (!organizationId) return jsonError("You cannot register labour outside your organization.", 403);
    if (!assignment.company_id || !assignment.site_id || !assignment.vendor_id || !assignment.effective_from) {
      return jsonError("Company, site, labour contractor and site joining date are required.");
    }
    const scopeCheck = await validateLabourCompanySiteIndependent(access, organizationId, assignment.company_id, assignment.site_id);
    if ("error" in scopeCheck) return jsonError(scopeCheck.error || "Selected company/site is not available.", 403);

    const results = [];
    const origin = new URL(request.url).origin;
    const aadhaarRows = new Map<string, number[]>();
    rows.forEach((row: any, index: number) => {
      const validation = validateAadhaar(row?.aadhaar_number);
      if (validation.valid) {
        aadhaarRows.set(validation.digits, [...(aadhaarRows.get(validation.digits) || []), index + 1]);
      }
    });
    for (const row of rows) {
      const rowId = normalizeText(row?.id);
      if (!rowId) continue;
      const rowNumber = rows.indexOf(row) + 1;
      const aadhaarValidation = normalizeText(row.aadhaar_number) ? validateAadhaar(row.aadhaar_number) : null;
      const batchDuplicateRows = aadhaarValidation?.valid ? aadhaarRows.get(aadhaarValidation.digits) || [] : [];
      const rowPayload = {
        organization_id: organizationId,
        company_id: assignment.company_id,
        site_id: assignment.site_id,
        vendor_id: assignment.vendor_id,
        work_order_id: assignment.work_order_id,
        effective_from: assignment.effective_from,
        labour_trade_id: normalizeText(row.labour_trade_id),
        worker_name: normalizeText(row.worker_name),
        father_or_husband_name: normalizeText(row.father_or_husband_name),
        date_of_birth: normalizeText(row.date_of_birth),
        aadhaar_number: aadhaarValidation?.valid ? aadhaarValidation.formatted : normalizeText(row.aadhaar_number),
        mobile_number: normalizeText(row.mobile_number),
        wage_rate: normalizeText(row.wage_rate),
        remarks: normalizeText(row.remarks),
        existing_worker_id: normalizeText(row.existing_worker_id),
      };
      if (aadhaarValidation && !aadhaarValidation.valid) {
        results.push({ id: rowId, status: "failed", error: aadhaarValidation.error });
        continue;
      }
      if (batchDuplicateRows.length > 1) {
        results.push({
          id: rowId,
          status: "failed",
          error: `Duplicate Aadhaar in this batch. Also used in rows ${batchDuplicateRows.filter((item) => item !== rowNumber).join(" and ")}.`,
        });
        continue;
      }
      if (!rowPayload.labour_trade_id || !rowPayload.worker_name) {
        results.push({ id: rowId, status: "failed", error: "Labour Category and Name are required." });
        continue;
      }
      try {
        const registrationResponse = await registerWorker(new Request(`${origin}/api/labour/workers/register`, {
          method: "POST",
          headers: copyAuthHeaders(request),
          body: JSON.stringify(rowPayload),
        }));
        const registrationPayload = await parsePayload(registrationResponse);
        if (!registrationResponse.ok) {
          results.push({ id: rowId, status: "failed", error: registrationResponse.status === 409 ? registrationPayload.error || "This Aadhaar Number is already registered." : safeMessage(registrationPayload.error || registrationPayload.message) });
          continue;
        }
        let labourCode = "";
        if (registrationPayload.labour_worker_id) {
          const { data: worker } = await access.admin
            .from("labour_workers")
            .select("labour_code")
            .eq("id", registrationPayload.labour_worker_id)
            .maybeSingle();
          labourCode = worker?.labour_code || "";
        }

        const documentFailures: string[] = [];
        const documentUploads = [
          { field: `aadhaar_front_file_${rowId}`, type: "Aadhaar Front", fallbackName: "Aadhaar Front" },
          { field: `aadhaar_back_file_${rowId}`, type: "Aadhaar Back", fallbackName: "Aadhaar Back" },
          { field: `aadhaar_file_${rowId}`, type: "Aadhaar Card", fallbackName: "Aadhaar Card" },
        ];
        for (const upload of documentUploads) {
          const aadhaarFile = formData.get(upload.field);
          if (!(aadhaarFile instanceof File) || aadhaarFile.size <= 0 || !registrationPayload.labour_worker_id) continue;
          const documentForm = new FormData();
          documentForm.set("file", aadhaarFile);
          documentForm.set("document_type", upload.type);
          documentForm.set("document_name", upload.fallbackName);
          if (rowPayload.aadhaar_number) documentForm.set("document_number", rowPayload.aadhaar_number);
          const documentResponse = await uploadWorkerDocument(
            new Request(`${origin}/api/labour/workers/${registrationPayload.labour_worker_id}/documents`, {
              method: "POST",
              headers: request.headers.get("authorization") ? { authorization: request.headers.get("authorization") as string } : {},
              body: documentForm,
            }),
            { params: Promise.resolve({ id: registrationPayload.labour_worker_id }) },
          );
          const documentPayload = await parsePayload(documentResponse);
          if (!documentResponse.ok) {
            documentFailures.push(`${upload.fallbackName}: ${safeMessage(documentPayload.error || "Aadhaar document upload failed.")}`);
          }
        }
        const document_warning = documentFailures.join(" ");

        results.push({
          id: rowId,
          status: "success",
          action: registrationPayload.action || "registered",
          labour_worker_id: registrationPayload.labour_worker_id,
          deployment_id: registrationPayload.deployment_id || null,
          labour_code: labourCode,
          message: registrationPayload.message || "Saved.",
          document_warning,
        });
      } catch (error: any) {
        results.push({ id: rowId, status: "failed", error: safeMessage(error.message) });
      }
    }

    await audit(access, request, {
      moduleCode: "labour_workers",
      action: "batch_register",
      entityType: "labour_registration_batch",
      recordId: crypto.randomUUID(),
      organizationId,
      companyId: assignment.company_id,
      siteId: assignment.site_id,
      description: `Processed Labour Registration batch with ${rows.length} row(s).`,
      newValues: {
        attempted: rows.length,
        succeeded: results.filter((row) => row.status === "success").length,
        failed: results.filter((row) => row.status !== "success").length,
      },
    } as any);

    return NextResponse.json({ results });
  } catch (error: any) {
    return jsonError(safeMessage(error.message) || "Failed to save Labour Registration batch.", 500);
  }
}
