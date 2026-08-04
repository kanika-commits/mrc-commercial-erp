import { NextResponse } from "next/server";
import { actorFields, audit, jsonError, loadScopedContractor, requireLabourPermission } from "@/app/api/labour/_shared";
import { CONTRACTOR_STATUSES, isValidActionValue, normalizeIdentifier, normalizeText } from "@/lib/labour/constants";

const MODULE = "labour_contractors";

function text(value: unknown) {
  const next = normalizeText(value);
  return next || null;
}

function primaryContact(contacts: any[] | undefined) {
  const rows = contacts || [];
  return rows.find((contact) => contact.is_primary) || rows[0] || null;
}

function daysUntil(dateValue: string | null | undefined) {
  if (!dateValue) return null;
  const today = new Date();
  const current = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const target = new Date(`${dateValue}T00:00:00+05:30`);
  if (Number.isNaN(target.getTime())) return null;
  return Math.ceil((target.getTime() - current.getTime()) / 86400000);
}

function complianceWarnings(row: any) {
  const warnings: Array<{ tone: "red" | "orange"; label: string }> = [];
  const licenceDays = daysUntil(row.labour_licence_valid_to);
  if (licenceDays !== null && licenceDays < 0) warnings.push({ tone: "red", label: "Expired" });
  else if (licenceDays !== null && licenceDays <= 30) warnings.push({ tone: "orange", label: `Expires in ${licenceDays} days` });
  return warnings;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireLabourPermission(request, MODULE, "view");
    if ("response" in access) return access.response;
    const { id } = await context.params;
    const contractor = await loadScopedContractor(access, id);
    if (!contractor) return jsonError("Labour contractor not found.", 404);

    const [
      { data: contacts, error: contactsError },
      { data: workers, error: workersError },
      { data: deployments, error: deploymentsError },
      { data: documents, error: documentsError },
      { data: activityLogs, error: activityError },
    ] = await Promise.all([
      access.admin
        .from("vendor_contacts")
        .select("id, vendor_id, contact_name, contact_number, email, designation, is_primary")
        .eq("vendor_id", contractor.vendor_id)
        .order("is_primary", { ascending: false }),
      access.admin
        .from("labour_workers")
        .select("id, labour_code, worker_name, current_company_id, current_site_id, trade, skill_level, status, companies:current_company_id(company_name), sites:current_site_id(site_name)")
        .eq("current_contractor_profile_id", id)
        .neq("status", "deleted")
        .order("worker_name"),
      access.admin
        .from("labour_deployments")
        .select("id, company_id, site_id, commercial_model, status")
        .eq("contractor_profile_id", id)
        .eq("status", "active"),
      access.admin
        .from("labour_contractor_documents")
        .select("id, document_type, document_name, document_number, issue_date, expiry_date, version, is_active, original_file_name, mime_type, size_bytes, uploaded_at, uploaded_by_name")
        .eq("contractor_profile_id", id)
        .order("uploaded_at", { ascending: false }),
      access.admin
        .from("erp_audit_logs")
        .select("id, action, description, old_values, new_values, created_by_name, created_by_email, created_at")
        .eq("module_code", MODULE)
        .eq("entity_type", "labour_contractor_profile")
        .eq("record_id", id)
        .order("created_at", { ascending: false }),
    ]);
    if (contactsError) throw contactsError;
    if (workersError) throw workersError;
    if (deploymentsError) throw deploymentsError;
    if (documentsError) throw documentsError;
    if (activityError) throw activityError;
    const activeWorkers = (workers || []).filter((worker: any) => worker.status === "active");
    const activeDeployments = deployments || [];
    return NextResponse.json({
      contractor: {
        ...contractor,
        primary_contact: primaryContact(contacts || []),
        compliance_warnings: complianceWarnings(contractor),
      },
      summary: {
        active_labour_count: activeWorkers.length,
        daily_wage_labour_count: activeDeployments.filter((deployment: any) => deployment.commercial_model === "daily_wage").length,
        contract_basis_labour_count: activeDeployments.filter((deployment: any) => deployment.commercial_model === "contract_basis").length,
        active_site_count: new Set(activeDeployments.map((deployment: any) => deployment.site_id).filter(Boolean)).size || new Set(activeWorkers.map((worker: any) => worker.current_site_id).filter(Boolean)).size,
      },
      workers: workers || [],
      documents: documents || [],
      activity_logs: activityLogs || [],
    });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load labour contractor.", 500);
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireLabourPermission(request, MODULE, "edit");
    if ("response" in access) return access.response;
    const { id } = await context.params;
    const current = await loadScopedContractor(access, id);
    if (!current) return jsonError("Labour contractor not found.", 404);
    const payload = await request.json().catch(() => ({}));
    const contractorStatus = text(payload.contractor_status) || current.contractor_status;
    if (!isValidActionValue(CONTRACTOR_STATUSES, contractorStatus)) return jsonError("Invalid contractor status.");
    const contractorCode = normalizeIdentifier(payload.contractor_code);
    if (!contractorCode) return jsonError("Contractor code is required.");
    if (contractorCode) {
      const { data: existingCode, error: existingCodeError } = await access.admin
        .from("labour_contractor_profiles")
        .select("id")
        .eq("organization_id", current.organization_id)
        .eq("contractor_code", contractorCode)
        .neq("id", id)
        .maybeSingle();
      if (existingCodeError) throw existingCodeError;
      if (existingCode) return jsonError("Contractor code already exists within this organization.", 409);
    }
    const codeChanged = (current.contractor_code || null) !== contractorCode;
    const changeReason = text(payload.change_reason);
    if (codeChanged) {
      const [{ count: workerCount, error: workerCountError }, { count: deploymentCount, error: deploymentCountError }] = await Promise.all([
        access.admin
          .from("labour_workers")
          .select("id", { count: "exact", head: true })
          .eq("current_contractor_profile_id", id)
          .eq("status", "active"),
        access.admin
          .from("labour_deployments")
          .select("id", { count: "exact", head: true })
          .eq("contractor_profile_id", id)
          .eq("status", "active"),
      ]);
      if (workerCountError) throw workerCountError;
      if (deploymentCountError) throw deploymentCountError;
      if ((workerCount || 0) + (deploymentCount || 0) > 0 && !changeReason) {
        return jsonError("Reason is required to change contractor code when active labourers or deployments exist.");
      }
      if ((workerCount || 0) + (deploymentCount || 0) > 0 && (changeReason || "").length < 10) {
        return jsonError("Reason must be at least 10 characters to change contractor code when active labourers or deployments exist.");
      }
    }

    const updatePayload = {
      contractor_code: contractorCode,
      contractor_status: contractorStatus,
      labour_licence_number: text(payload.labour_licence_number),
      labour_licence_valid_from: text(payload.labour_licence_valid_from),
      labour_licence_valid_to: text(payload.labour_licence_valid_to),
      epf_registration_number: text(payload.epf_registration_number),
      esi_registration_number: text(payload.esi_registration_number),
      principal_employer_name: text(payload.principal_employer_name),
      default_supervisor_name: text(payload.default_supervisor_name),
      default_supervisor_phone: text(payload.default_supervisor_phone),
      maximum_labour_capacity: payload.maximum_labour_capacity ? Number(payload.maximum_labour_capacity) : null,
      remarks: text(payload.remarks),
      updated_at: new Date().toISOString(),
      ...actorFields(access.auth, "updated"),
    };

    const { error } = await access.admin.from("labour_contractor_profiles").update(updatePayload).eq("id", id);
    if (error) throw error;

    await audit(access, request, {
      moduleCode: MODULE,
      action: "update",
      entityType: "labour_contractor_profile",
      recordId: id,
      organizationId: current.organization_id,
      description: "Updated labour contractor profile.",
      oldValues: {
        contractor_code: current.contractor_code,
        contractor_status: current.contractor_status,
        labour_licence_number: current.labour_licence_number,
        labour_licence_valid_to: current.labour_licence_valid_to,
        epf_registration_number: current.epf_registration_number,
        esi_registration_number: current.esi_registration_number,
        remarks: current.remarks,
      },
      newValues: { ...updatePayload, change_reason: changeReason },
    });

    return NextResponse.json({ contractor_profile_id: id });
  } catch (error: any) {
    return jsonError(error.message || "Failed to update labour contractor.", 500);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireLabourPermission(request, MODULE, "delete");
    if ("response" in access) return access.response;
    const { id } = await context.params;
    const contractor = await loadScopedContractor(access, id);
    if (!contractor) return jsonError("Labour contractor not found.", 404);
    const { error } = await access.admin
      .from("labour_contractor_profiles")
      .update({ contractor_status: "inactive", updated_at: new Date().toISOString(), ...actorFields(access.auth, "updated") })
      .eq("id", id);
    if (error) throw error;
    await audit(access, request, {
      moduleCode: MODULE,
      action: "delete",
      entityType: "labour_contractor_profile",
      recordId: id,
      organizationId: contractor.organization_id,
      description: "Marked labour contractor profile inactive.",
      oldValues: contractor,
    });
    return NextResponse.json({ deleted: true });
  } catch (error: any) {
    return jsonError(error.message || "Failed to delete labour contractor.", 500);
  }
}
