import { NextResponse } from "next/server";
import { applyCompanySiteScope, audit, jsonError, loadScopedLabourImportBatch, requireLabourPermission, validateLabourCompanySiteIndependent } from "@/app/api/labour/_shared";
import { normalizeLookup } from "@/lib/labour/constants";
import { LABOUR_IMPORT_DOCUMENT_FIELDS, labourImportDocumentReferenceValue, labourImportMasterLookupKeys, maskAadhaarForImport, normalizeLabourImportFilename, normalizedPersonKey, validateLabourImportDailyRate } from "@/lib/labour/import";
import { validateAadhaar } from "@/lib/utils/aadhaar";
import { downloadDriveFile, extractGoogleDriveFileId, googleDriveFileUrl } from "@/src/lib/googleDrive";

const MAX_LABOUR_IMPORT_DRIVE_FILE_BYTES = 10 * 1024 * 1024;
const SUPPORTED_LABOUR_IMPORT_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

const MASTER_MAPPING_KEY = "__master_mappings";
const WORK_ORDER_MAPPING_KEY = "__work_order_mappings";
const DOCUMENT_FOLDER_KEY = "__document_folder";
type MasterGroup = "companies" | "sites" | "contractors" | "trades";

function masterMappingValue(mapping: any, group: MasterGroup, sourceValue: unknown) {
  const groupMapping = mapping?.[MASTER_MAPPING_KEY]?.[group] || {};
  const sourceKeys = labourImportMasterLookupKeys(sourceValue, masterLookupOptions(group));
  for (const sourceKey of sourceKeys) {
    const mappedId = String(groupMapping[sourceKey] || "").trim();
    if (mappedId) return mappedId;
  }
  return "";
}

function workOrderMappingValue(mapping: any, vendorId: string | null | undefined, siteId: string | null | undefined) {
  if (!vendorId || !siteId) return "";
  return String(mapping?.[WORK_ORDER_MAPPING_KEY]?.[`${vendorId}:${siteId}`] || "").trim();
}

function fieldLabel(group: MasterGroup) {
  if (group === "companies") return "Company";
  if (group === "sites") return "Site";
  if (group === "contractors") return "Labour Contractor";
  return "Labour Category";
}

function masterLookupOptions(group: MasterGroup) {
  return group === "contractors" ? { splitCompound: true, stripParenthetical: true } : {};
}

function resolveMasterValue<T extends Record<string, any>>({
  sourceValue,
  group,
  mapping,
  candidates,
  idFor,
  labelsFor,
}: {
  sourceValue: unknown;
  group: MasterGroup;
  mapping: any;
  candidates: T[];
  idFor: (candidate: T) => string | null | undefined;
  labelsFor: (candidate: T) => Array<unknown>;
}) {
  const label = fieldLabel(group);
  const rawSource = String(sourceValue || "").trim();
  const sourceKeys = new Set(labourImportMasterLookupKeys(rawSource, masterLookupOptions(group)));
  const mappedId = masterMappingValue(mapping, group, rawSource);
  if (mappedId) {
    const mappedRecord = candidates.find((candidate) => String(idFor(candidate) || "") === mappedId);
    if (mappedRecord) return { status: "resolved", record: mappedRecord, method: "mapped", mappedId };
    return { status: "not_found", record: null, method: "mapped", mappedId, error: `Mapped ${label} "${rawSource}" was not found.` };
  }
  if (sourceKeys.size === 0) return { status: "not_found", record: null, method: "auto", mappedId: "", error: `${label} is required.` };
  const matches = candidates.filter((candidate) =>
    labelsFor(candidate).some((value) => labourImportMasterLookupKeys(value, masterLookupOptions(group)).some((key) => sourceKeys.has(key)))
  );
  if (matches.length === 0) return { status: "not_found", record: null, method: "auto", mappedId: "", error: `${label} "${rawSource}" was not found.` };
  if (matches.length > 1) return { status: "ambiguous", record: null, method: "auto", mappedId: "", error: `${label} "${rawSource}" matches multiple records. Please map it from ERP Master Value Mapping.` };
  return { status: "resolved", record: matches[0], method: "auto", mappedId: "" };
}

function masterStatus(sourceValue: unknown, resolution: any, resolvedName: string | null) {
  return {
    source_value: String(sourceValue || "").trim(),
    resolved_id: resolution?.record ? String(resolution.record.id || resolution.record.vendor_id || "") : resolution?.mappedId || "",
    resolved_name: resolvedName,
    method: resolution?.method || "auto",
    status: resolution?.status || "not_found",
    error: resolution?.error || null,
  };
}

function aadhaarLookupValues(digits: string) {
  return Array.from(new Set([
    digits,
    `${digits.slice(0, 4)}-${digits.slice(4, 8)}-${digits.slice(8, 12)}`,
    `${digits.slice(0, 4)} ${digits.slice(4, 8)} ${digits.slice(8, 12)}`,
  ].filter(Boolean)));
}

async function loadExistingWorkersByAadhaar(access: any, organizationId: string, digits: string) {
  const rpcResult = await access.admin.rpc("find_labour_worker_by_aadhaar", {
    p_organization_id: organizationId,
    p_aadhaar_digits: digits,
    p_exclude_worker_id: null,
  });
  if (!rpcResult.error && rpcResult.data?.[0] && "status" in rpcResult.data[0] && "current_work_order_id" in rpcResult.data[0]) return rpcResult.data;
  const { data, error } = await access.admin
    .from("labour_workers")
    .select("id, labour_code, worker_name, father_or_husband_name, aadhaar_number, mobile_number, status, current_company_id, current_site_id, current_work_order_id, current_contractor_profile_id, labour_trade_id, labour_trades(trade_name, trade_code), companies:current_company_id(company_name, company_code), sites:current_site_id(site_name, site_code), labour_contractor_profiles(id, vendor_id, contractor_code, vendors(vendor_name))")
    .eq("organization_id", organizationId)
    .in("aadhaar_number", aadhaarLookupValues(digits))
    .limit(2);
  if (error) throw error;
  return data || [];
}

function commercialModelForWorkOrderType(woType: unknown) {
  return woType === "Daily Wage" ? "daily_wage" : "contract_basis";
}

async function loadCurrentAssignment(access: any, workerId: string) {
  const { data: deployments, error } = await access.admin
    .from("labour_deployments")
    .select("company_id, site_id, contractor_profile_id, work_order_id, effective_to, status")
    .eq("labour_worker_id", workerId)
    .eq("status", "active")
    .is("effective_to", null);
  if (error) throw error;
  if ((deployments || []).length !== 1) return { deployment: null, model: null };
  const deployment = deployments[0];
  const { data: workOrder, error: workOrderError } = await access.admin
    .from("work_orders")
    .select("id, wo_type")
    .eq("id", deployment.work_order_id)
    .maybeSingle();
  if (workOrderError) throw workOrderError;
  return { deployment, model: workOrder ? commercialModelForWorkOrderType(workOrder.wo_type) : null };
}

function resolveEffectiveAadhaarAvailability(normalized: Record<string, any>) {
  const explicit = normalizeLookup(normalized.aadhaar_available);
  const hasAadhaarNumber = Boolean(normalized.aadhaar_number);
  const hasNoAadhaarReason = Boolean(normalized.no_aadhaar_reason);
  if (explicit === "YES") return { value: "yes" as const, error: "" };
  if (explicit === "NO") return { value: "no" as const, error: "" };
  if (explicit) return { value: "invalid" as const, error: "Aadhaar Available must be Yes or No." };
  if (hasAadhaarNumber) return { value: "yes" as const, error: "" };
  if (hasNoAadhaarReason) return { value: "no" as const, error: "" };
  return { value: "invalid" as const, error: "Specify Aadhaar Available as Yes or No, or provide Aadhaar details." };
}

async function loadBatch(access: any, batchId: string) {
  return loadScopedLabourImportBatch(access, batchId);
}

async function loadRegistrationContractors(access: any, organizationId: string, companyId: string, siteId: string) {
  let workOrderQuery = access.admin
    .from("work_orders")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("company_id", companyId)
    .eq("site_id", siteId)
    .eq("status", "active");
  workOrderQuery = applyCompanySiteScope(workOrderQuery, access.assignments);
  const { data: workOrders, error: workOrderError } = workOrderQuery ? await workOrderQuery : { data: [], error: null };
  if (workOrderError) throw workOrderError;
  const workOrderIds = Array.from(new Set((workOrders || []).map((workOrder: any) => workOrder.id).filter(Boolean)));
  const { data: links, error: linksError } = workOrderIds.length
    ? await access.admin.from("work_order_vendors").select("vendor_id").in("work_order_id", workOrderIds)
    : { data: [], error: null };
  if (linksError) throw linksError;

  let manpowerQuery = access.admin
    .from("manpower_work_orders")
    .select("contractor_profile_id")
    .eq("organization_id", organizationId)
    .eq("company_id", companyId)
    .eq("site_id", siteId)
    .in("status", ["draft", "pending", "submitted", "approved"]);
  manpowerQuery = applyCompanySiteScope(manpowerQuery, access.assignments);
  const { data: manpowerWorkOrders, error: manpowerError } = manpowerQuery ? await manpowerQuery : { data: [], error: null };
  if (manpowerError) throw manpowerError;

  const profileIds = Array.from(new Set((manpowerWorkOrders || []).map((workOrder: any) => workOrder.contractor_profile_id).filter(Boolean)));
  const commercialVendorIds = Array.from(new Set((links || []).map((link: any) => link.vendor_id).filter(Boolean)));
  const [{ data: profilesByVendor, error: profilesByVendorError }, { data: profilesById, error: profilesByIdError }] = await Promise.all([
    commercialVendorIds.length
      ? access.admin.from("labour_contractor_profiles").select("id, vendor_id, contractor_code, contractor_status").in("vendor_id", commercialVendorIds).eq("organization_id", organizationId).eq("contractor_status", "active")
      : Promise.resolve({ data: [], error: null }),
    profileIds.length
      ? access.admin.from("labour_contractor_profiles").select("id, vendor_id, contractor_code, contractor_status").in("id", profileIds).eq("organization_id", organizationId).eq("contractor_status", "active")
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (profilesByVendorError) throw profilesByVendorError;
  if (profilesByIdError) throw profilesByIdError;
  const profileMap = new Map<string, any>();
  for (const profile of [...(profilesByVendor || []), ...(profilesById || [])]) {
    if (profile?.id) profileMap.set(profile.id, profile);
  }
  const vendorIds = Array.from(new Set([...commercialVendorIds, ...Array.from(profileMap.values()).map((profile: any) => profile.vendor_id).filter(Boolean)]));
  const { data: vendors, error: vendorsError } = vendorIds.length
    ? await access.admin.from("vendors").select("id, vendor_name, status").in("id", vendorIds).eq("organization_id", organizationId).eq("status", "active")
    : { data: [], error: null };
  if (vendorsError) throw vendorsError;
  const profileByVendor = new Map<string, any>();
  for (const profile of profileMap.values()) {
    if (profile.vendor_id) profileByVendor.set(profile.vendor_id, profile);
  }
  return (vendors || []).map((vendor: any) => ({
    id: profileByVendor.get(vendor.id)?.id || null,
    vendor_id: vendor.id,
    contractor_code: profileByVendor.get(vendor.id)?.contractor_code || null,
    vendors: vendor,
  }));
}

async function verifyDriveDocument(link: string, label: string) {
  const driveFileId = extractGoogleDriveFileId(link);
  if (!driveFileId) throw new Error(`${label} must be a valid Google Drive file link.`);
  const driveFile = await downloadDriveFile({ fileId: driveFileId, maxSizeBytes: MAX_LABOUR_IMPORT_DRIVE_FILE_BYTES });
  if (!SUPPORTED_LABOUR_IMPORT_MIME_TYPES.has(String(driveFile.mime_type || "").toLowerCase())) {
    throw new Error(`${label} must point to a PDF or image file.`);
  }
  return {
    storage_provider: "google_drive",
    storage_bucket: "google_drive",
    storage_key: driveFile.file_id,
    drive_file_id: driveFile.file_id,
    drive_file_url: googleDriveFileUrl(driveFile.file_id),
    source_url: link,
    original_file_name: driveFile.file_name,
    mime_type: driveFile.mime_type,
    size_bytes: driveFile.size_bytes,
    checksum: null,
  };
}

function folderFilesByName(mapping: any) {
  const files = mapping?.[DOCUMENT_FOLDER_KEY]?.files || [];
  const byName = new Map<string, any[]>();
  for (const file of files) {
    const key = normalizeLabourImportFilename(file?.file_name);
    if (!key) continue;
    byName.set(key, [...(byName.get(key) || []), file]);
  }
  return byName;
}

function manifestEntryFromFolderFile(file: any, sourceFilename: string) {
  return {
    storage_provider: "google_drive",
    storage_bucket: "google_drive",
    storage_key: file.file_id,
    drive_file_id: file.file_id,
    drive_file_url: file.file_url || googleDriveFileUrl(file.file_id),
    source_url: file.file_url || googleDriveFileUrl(file.file_id),
    source_filename: sourceFilename,
    original_file_name: file.file_name,
    mime_type: file.mime_type,
    size_bytes: file.size_bytes,
    checksum: null,
  };
}

async function verifyRowDriveDocuments(normalized: Record<string, any>, mapping: any) {
  const manifest: Record<string, any> = {};
  const errors: string[] = [];
  const warnings: string[] = [];
  const byName = folderFilesByName(mapping);
  await Promise.all(LABOUR_IMPORT_DOCUMENT_FIELDS.map(async ({ field, filenameField, label, documentType }) => {
    const fieldValue = labourImportDocumentReferenceValue(normalized[field]);
    const filenameValue = labourImportDocumentReferenceValue(normalized[filenameField]);
    const displayName = labourImportDocumentReferenceValue(normalized[`${field}_display_name`]);
    const fieldValueIsDirectLink = Boolean(fieldValue && extractGoogleDriveFileId(fieldValue));
    const filenameIsDirectLink = Boolean(filenameValue && extractGoogleDriveFileId(filenameValue));
    const link = fieldValueIsDirectLink ? fieldValue : filenameIsDirectLink ? filenameValue : "";
    const filename = displayName || (filenameValue && !filenameIsDirectLink ? filenameValue : fieldValue && !fieldValueIsDirectLink ? fieldValue : "");
    if (link) {
      try {
        manifest[field] = { ...(await verifyDriveDocument(link, label)), document_type: documentType, source_filename: filename || null, display_name: displayName || null };
      } catch (error: any) {
        warnings.push(error.message || `${label} could not be verified.`);
      }
      return;
    }
    if (!filename) return;
    const key = normalizeLabourImportFilename(filename);
    const matches = byName.get(key) || [];
    if (!byName.size) {
      warnings.push(`${label}: "${filename}" is not a Google Drive file link.`);
      return;
    }
    if (matches.length === 0) {
      warnings.push(`${label}: "${filename}" was not found in the verified folder.`);
      return;
    }
    if (matches.length > 1) {
      errors.push(`${label}: "${filename}" matches multiple files in the verified folder.`);
      return;
    }
    const file = matches[0];
    if (!SUPPORTED_LABOUR_IMPORT_MIME_TYPES.has(String(file.mime_type || "").toLowerCase())) {
      warnings.push(`${label}: "${filename}" must be a PDF or image file.`);
      return;
    }
    try {
      manifest[field] = { ...manifestEntryFromFolderFile(file, filename), document_type: documentType };
    } catch (error: any) {
      warnings.push(error.message || `${label} could not be verified.`);
    }
  }));
  return { manifest, errors, warnings };
}

function documentReferenceValue(normalized: Record<string, any>, field: string, filenameField: string) {
  return labourImportDocumentReferenceValue(normalized[filenameField], normalized[field]);
}

export async function POST(request: Request) {
  try {
    const access = await requireLabourPermission(request, "labour_workers", "import");
    if ("response" in access) return access.response;
    const { batch_id } = await request.json().catch(() => ({}));
    if (!batch_id) return jsonError("Batch ID is required.");
    const batch = await loadBatch(access, batch_id);
    if (!batch) return jsonError("Import batch not found.", 404);

    const [{ data: rows, error: rowsError }, { data: companies, error: companiesError }, { data: sites, error: sitesError }, { data: trades, error: tradesError }] = await Promise.all([
      access.admin.from("labour_import_rows").select("*").eq("batch_id", batch_id).order("source_row_number"),
      access.admin.from("companies").select("id, company_name, company_code").eq("organization_id", batch.organization_id),
      access.admin.from("sites").select("id, site_name, site_code, company_id").eq("organization_id", batch.organization_id),
      access.admin.from("labour_trades").select("id, trade_name, trade_code, status").eq("organization_id", batch.organization_id).eq("status", "active"),
    ]);
    for (const result of [{ error: rowsError }, { error: companiesError }, { error: sitesError }, { error: tradesError }]) {
      if (result.error) throw result.error;
    }

    const scopedRows = rows || [];
    const workbookKeys = new Map<string, number[]>();
    for (const row of scopedRows) {
      const normalized = row.normalized_data || {};
      const aadhaarValidation = validateAadhaar(normalized.aadhaar_number);
      const key = aadhaarValidation.valid
        ? `AADHAAR:${aadhaarValidation.digits}`
        : normalized.aadhaar_number
          ? ""
          : `NOAADHAAR:${normalizedPersonKey(normalized, normalized.site_id || row.matched_site_id || null, normalized.contractor_profile_id || row.matched_contractor_profile_id || null)}`;
      if (key) workbookKeys.set(key, [...(workbookKeys.get(key) || []), row.source_row_number]);
    }
    const existingWorkersByAadhaar = new Map<string, any[]>();
    await Promise.all(Array.from(new Set(
      scopedRows
        .map((row: any) => validateAadhaar(row.normalized_data?.aadhaar_number).valid ? validateAadhaar(row.normalized_data?.aadhaar_number).digits : "")
        .filter(Boolean)
    )).map(async (digits) => {
      existingWorkersByAadhaar.set(digits, await loadExistingWorkersByAadhaar(access, batch.organization_id, digits));
    }));
    const contractorCache = new Map<string, any[]>();
    const workOrderCache = new Map<string, any>();
    const updates = [];

    for (const row of scopedRows) {
      const normalized = row.normalized_data || {};
      const errors: string[] = [];
      const warnings: string[] = [];
      const companyResolution: any = batch.selected_company_id
        ? { status: "resolved", record: (companies || []).find((item: any) => item.id === batch.selected_company_id) || null, method: "batch", mappedId: "" }
        : resolveMasterValue({
          sourceValue: normalized.company_text,
          group: "companies",
          mapping: batch.mapping || {},
          candidates: companies || [],
          idFor: (item: any) => item.id,
          labelsFor: (item: any) => [item.company_name, item.company_code],
        });
      const siteResolution: any = batch.selected_site_id
        ? { status: "resolved", record: (sites || []).find((item: any) => item.id === batch.selected_site_id) || null, method: "batch", mappedId: "" }
        : resolveMasterValue({
          sourceValue: normalized.site_text,
          group: "sites",
          mapping: batch.mapping || {},
          candidates: sites || [],
          idFor: (item: any) => item.id,
          labelsFor: (item: any) => [item.site_name, item.site_code],
        });
      const companyId = companyResolution.record?.id || null;
      const siteId = siteResolution.record?.id || null;
      if (!normalized.worker_name) errors.push("Worker name is required.");
      if (!normalized.labour_code && !normalized.aadhaar_number) warnings.push("Labour code and Aadhaar are blank; duplicate detection will use name/father/site/contractor.");
      if (!companyId) errors.push(companyResolution.error || "Company could not be resolved.");
      if (!siteId) errors.push(siteResolution.error || "Site could not be resolved.");
      if (companyId && siteId) {
        const scopeCheck = await validateLabourCompanySiteIndependent(access, batch.organization_id, companyId, siteId);
        if ("error" in scopeCheck) errors.push(scopeCheck.error || "Resolved company/site is outside your scope.");
      }

      let matchedContractor = null as any;
      let contractorResolution: any = { status: "not_found", record: null, method: "auto", mappedId: "", error: "Labour Contractor is required." };
      if (companyId && siteId) {
        const cacheKey = `${companyId}:${siteId}`;
        if (!contractorCache.has(cacheKey)) {
          contractorCache.set(cacheKey, await loadRegistrationContractors(access, batch.organization_id, companyId, siteId));
        }
        contractorResolution = resolveMasterValue({
          sourceValue: normalized.contractor_text,
          group: "contractors",
          mapping: batch.mapping || {},
          candidates: contractorCache.get(cacheKey) || [],
          idFor: (item: any) => item.vendor_id,
          labelsFor: (item: any) => [item.vendors?.vendor_name, item.contractor_code, item.vendor_id],
        });
        matchedContractor = contractorResolution.record;
      }
      if (!matchedContractor) errors.push(contractorResolution.error || "Labour Contractor could not be resolved from Contractor Name.");
      const mappedWorkOrderId = workOrderMappingValue(batch.mapping || {}, matchedContractor?.vendor_id, siteId);
      let matchedWorkOrder = null as any;
      if (mappedWorkOrderId && matchedContractor && companyId && siteId) {
        if (!workOrderCache.has(mappedWorkOrderId)) {
          const { data: workOrder, error: workOrderError } = await access.admin
            .from("work_orders")
            .select("id, organization_id, company_id, site_id, wo_number, wo_type, status")
            .eq("id", mappedWorkOrderId)
            .maybeSingle();
          if (workOrderError) throw workOrderError;
          workOrderCache.set(mappedWorkOrderId, workOrder || null);
        }
        matchedWorkOrder = workOrderCache.get(mappedWorkOrderId);
        if (
          !matchedWorkOrder ||
          matchedWorkOrder.organization_id !== batch.organization_id ||
          matchedWorkOrder.company_id !== companyId ||
          matchedWorkOrder.site_id !== siteId ||
          matchedWorkOrder.status !== "active"
        ) {
          errors.push("Selected Work Order is not available for this contractor and site.");
        } else {
          const { data: links, error: linkError } = await access.admin
            .from("work_order_vendors")
            .select("id")
            .eq("work_order_id", mappedWorkOrderId)
            .eq("vendor_id", matchedContractor.vendor_id)
            .limit(1);
          if (linkError) throw linkError;
          if (!(links || []).length) errors.push("Selected Work Order is not linked to this contractor.");
        }
      }
      const tradeResolution = resolveMasterValue({
        sourceValue: normalized.trade,
        group: "trades",
        mapping: batch.mapping || {},
        candidates: trades || [],
        idFor: (item: any) => item.id,
        labelsFor: (item: any) => [item.trade_name, item.trade_code],
      });
      const matchedTrade = tradeResolution.record as any;
      if (!matchedTrade) errors.push(tradeResolution.error || "Labour Category could not be resolved from Labour Category name.");
      if (!normalized.worker_name) errors.push("Labour name is required.");
      const commercialModel = matchedWorkOrder?.wo_type === "Daily Wage" ? "daily_wage" : "contract_basis";
      const requiresDailyRate = commercialModel === "daily_wage";
      const rateError = requiresDailyRate ? validateLabourImportDailyRate(normalized.wage_rate) : "";
      if (rateError) errors.push(rateError);
      if (!normalized.date_of_joining) errors.push("Effective/Joining Date is required.");
      const aadhaarValidation = validateAadhaar(normalized.aadhaar_number);
      const effectiveAadhaarAvailability = resolveEffectiveAadhaarAvailability(normalized);
      if (effectiveAadhaarAvailability.error) errors.push(effectiveAadhaarAvailability.error);
      if (effectiveAadhaarAvailability.value === "yes" && !aadhaarValidation.valid) errors.push(aadhaarValidation.error);
      if (effectiveAadhaarAvailability.value === "no" && normalized.aadhaar_number) errors.push("Aadhaar Number must be blank when Aadhaar Available is No.");
      if (effectiveAadhaarAvailability.value === "no" && !normalized.no_aadhaar_reason) errors.push("No-Aadhaar Reason is required when Aadhaar Available is No.");

      const workerMatches = aadhaarValidation.valid ? existingWorkersByAadhaar.get(aadhaarValidation.digits) || [] : [];
      if (workerMatches.length > 1) errors.push("Multiple existing labourers match this row.");
      let existingAction = "create";
      let existingMessage = "";
      let requiresReactivation = false;
      let currentDailyRate: number | null = null;
      if (workerMatches.length === 1) {
        const existingWorker = workerMatches[0] as any;
        const currentAssignment = existingWorker.status === "active" ? await loadCurrentAssignment(access, existingWorker.id) : { deployment: null, model: null };
        const currentDeployment = currentAssignment.deployment as any;
        currentDailyRate = currentDeployment?.commercial_model === "daily_wage" ? currentDeployment.wage_rate : null;
        const sameAssignment = existingWorker.status === "active" &&
          currentDeployment?.company_id === companyId &&
          currentDeployment?.site_id === siteId &&
          currentDeployment?.contractor_profile_id === matchedContractor?.id &&
          currentDeployment?.work_order_id === (mappedWorkOrderId || null) &&
          currentAssignment.model === commercialModel;
        if (existingWorker.status === "inactive") {
          existingAction = "update_review";
          requiresReactivation = true;
          existingMessage = "Existing labourer is inactive. Reactivation is required before import.";
        } else if (sameAssignment) {
          existingAction = "skip";
          existingMessage = "Existing labourer already has this assignment; row will be skipped.";
        } else {
          existingAction = "update_review";
          existingMessage = "Existing active labourer has a different assignment. Confirming the import will transfer the labourer to the mapped assignment.";
          if (!/^\d{4}-\d{2}-\d{2}$/.test(String(normalized.date_of_joining || "").trim())) errors.push("Valid transfer effective date is required.");
          if (commercialModel === "daily_wage") {
            const rateError = validateLabourImportDailyRate(normalized.wage_rate);
            if (rateError) errors.push(rateError);
          }
        }
        warnings.push(existingMessage);
      }

      const key = aadhaarValidation.valid ? `AADHAAR:${aadhaarValidation.digits}` : `NOAADHAAR:${normalizedPersonKey(normalized, siteId, matchedContractor?.id || null)}`;
      const workbookDuplicateRows = key ? workbookKeys.get(key) || [] : [];
      if (key && workbookDuplicateRows.length > 1) errors.push(`Duplicate Aadhaar in this workbook. Also found in rows ${workbookDuplicateRows.filter((item) => item !== row.source_row_number).join(" and ")}.`);

      const { manifest: documentManifest, errors: documentErrors, warnings: documentWarnings } = await verifyRowDriveDocuments(normalized, batch.mapping || {});
      errors.push(...documentErrors);
      warnings.push(...documentWarnings);
      const documentLinks = LABOUR_IMPORT_DOCUMENT_FIELDS.map(({ field, filenameField }) => documentReferenceValue(normalized, field, filenameField)).filter(Boolean);
      const docsFound = Object.keys(documentManifest).length;
      const hasAadhaarFrontBack = Boolean(documentManifest.aadhaar_front_drive_url && documentManifest.aadhaar_back_drive_url);
      const hasCombinedAadhaar = Boolean(documentManifest.aadhaar_combined_drive_url);
      if (effectiveAadhaarAvailability.value === "yes" && !hasAadhaarFrontBack && !hasCombinedAadhaar) {
        warnings.push("Aadhaar document not uploaded. Upload later to complete verification.");
      }

      const status = errors.length || requiresReactivation ? "blocked" : workerMatches.length ? "warning" : warnings.length ? "warning" : "ready";
      const maskedAadhaar = maskAadhaarForImport(normalized.aadhaar_number);
      const existingWorker = workerMatches[0] as any;
      updates.push({
        id: row.id,
        matched_contractor_profile_id: matchedContractor?.id || null,
        matched_company_id: companyId,
        matched_site_id: siteId,
        matched_work_order_id: mappedWorkOrderId || null,
        matched_labour_worker_id: workerMatches.length === 1 ? workerMatches[0].id : null,
        validation_status: status,
        validation_errors: errors,
        validation_warnings: warnings,
        selected_action: existingAction,
        normalized_data: {
          ...normalized,
          aadhaar_number: aadhaarValidation.valid ? aadhaarValidation.formatted : normalized.aadhaar_number,
          masked_aadhaar: maskedAadhaar,
          company_name: companyResolution.record?.company_name || normalized.company_text || null,
          site_name: siteResolution.record?.site_name || normalized.site_text || null,
          contractor_name: matchedContractor?.vendors?.vendor_name || normalized.contractor_text || null,
          work_order_id: mappedWorkOrderId || null,
          work_order_name: matchedWorkOrder ? `${matchedWorkOrder.wo_number || "WO"} — ${matchedWorkOrder.wo_type || "Work Order"}` : null,
          commercial_model: commercialModel,
          payment_model: commercialModel === "daily_wage" ? "Daily Wage" : "Contractual Labour",
          wage_rate: requiresDailyRate ? normalized.wage_rate : null,
          current_daily_rate: currentDailyRate,
          trade_name: matchedTrade?.trade_name || normalized.trade || null,
          contractor_vendor_id: matchedContractor?.vendor_id || null,
          labour_trade_id: matchedTrade?.id || null,
          master_mapping_status: {
            company: masterStatus(normalized.company_text, companyResolution, companyResolution.record?.company_name || null),
            site: masterStatus(normalized.site_text, siteResolution, siteResolution.record?.site_name || null),
            contractor: masterStatus(normalized.contractor_text, contractorResolution, matchedContractor?.vendors?.vendor_name || null),
            trade: masterStatus(normalized.trade, tradeResolution, matchedTrade?.trade_name || null),
          },
          document_manifest: documentManifest,
          documents_found: docsFound,
          documents_expected: documentLinks.length,
          existing_worker_summary: existingWorker ? {
            labour_code: existingWorker.labour_code,
            worker_name: existingWorker.worker_name,
            company_name: existingWorker.companies?.company_name || null,
            site_name: existingWorker.sites?.site_name || null,
            contractor_name: existingWorker.labour_contractor_profiles?.vendors?.vendor_name || null,
            trade_name: existingWorker.labour_trades?.trade_name || null,
            current_wage_rate: null,
          } : null,
        },
        updated_at: new Date().toISOString(),
      });
    }

    for (const update of updates) {
      const { id, ...payload } = update;
      const { error } = await access.admin.from("labour_import_rows").update(payload).eq("id", id).eq("batch_id", batch_id);
      if (error) throw error;
    }
    const summary = {
      ...(batch.summary || {}),
      total_rows: updates.length,
      ready_rows: updates.filter((row) => row.validation_status === "ready" || row.validation_status === "warning").length,
      blocked_rows: updates.filter((row) => row.validation_status === "blocked").length,
      warnings: updates.filter((row) => row.validation_status === "warning").length,
      documents_found: updates.reduce((sum, row) => sum + Number(row.normalized_data.documents_expected || 0), 0),
      matched_documents: updates.reduce((sum, row) => sum + Number(row.normalized_data.documents_found || 0), 0),
      missing_documents: updates.reduce((sum, row) => sum + Math.max(0, Number(row.normalized_data.documents_expected || 0) - Number(row.normalized_data.documents_found || 0)), 0),
      extra_documents: 0,
    };
    await access.admin.from("labour_import_batches").update({ status: "validated", summary, updated_at: new Date().toISOString() }).eq("id", batch_id);
    await audit(access, request, {
      moduleCode: "labour_import",
      action: "validate",
      entityType: "labour_import_batch",
      recordId: batch_id,
      organizationId: batch.organization_id,
      companyId: batch.selected_company_id,
      siteId: batch.selected_site_id,
      description: `Validated Labour Import batch ${batch.file_name}.`,
      importBatchId: batch_id,
      newValues: summary,
    } as any);
    return NextResponse.json({ summary });
  } catch (error: any) {
    return jsonError(error.message || "Failed to validate labour import.", 500);
  }
}
