import {
  actorFields,
  audit,
  jsonError,
  loadScopedWorker,
  requireLabourPermission,
} from "@/app/api/labour/_shared";
import { isoDate } from "@/lib/labour/operations";
import { normalizeText } from "@/lib/labour/constants";

const MODULE = "labour_workers";
const INACTIVE_STATUS = "inactive";

function text(value: unknown) {
  const next = normalizeText(value);
  return next || null;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function statusPermissionModule(source: string | null) {
  return source === "labour_attendance" ? "labour_attendance" : source === "labour_worker_detail" ? MODULE : null;
}

export function normalizeInactiveStatusPayload(payload: any) {
  const nextStatus = text(payload.status);
  const reason = text(payload.reason);
  const requestedDate = isoDate(payload.effective_date);
  return { nextStatus, reason, requestedDate };
}

async function loadBlockingAttendancePeriod(access: any, workerId: string, attendanceDate: string) {
  const { data: rows, error: attendanceError } = await access.admin
    .from("labour_attendance")
    .select("id, period_id, attendance_date")
    .eq("labour_worker_id", workerId)
    .eq("attendance_date", attendanceDate);
  if (attendanceError) throw attendanceError;
  const periodIds = Array.from(new Set((rows || []).map((row: any) => row.period_id).filter(Boolean)));
  if (!periodIds.length) return null;
  const { data: periods, error: periodError } = await access.admin
    .from("labour_attendance_periods")
    .select("id, status")
    .in("id", periodIds);
  if (periodError) throw periodError;
  return (periods || []).find((period: any) => ["submitted", "finalized"].includes(period.status)) || null;
}

export async function validateInactiveWorkerStatusUpdate(access: any, input: {
  workerId: string;
  status: string | null;
  reason: string | null;
  requestedDate: string | null;
}) {
  const worker = await loadScopedWorker(access, input.workerId);
  if (!worker) return { error: "Labourer not found.", status: 404 };

  if (input.status !== INACTIVE_STATUS) return { error: "Only marking a labourer inactive is supported here." };
  if (!input.reason || input.reason.length < 10) return { error: "Reason must be at least 10 characters." };
  if (worker.status === INACTIVE_STATUS) {
    return { worker, unchanged: true, effectiveDate: input.requestedDate || todayIso(), activeDeployment: null };
  }
  if (worker.status !== "active") {
    return { error: `Only active labourers can be marked inactive from this page. Current status: ${worker.status}.`, status: 409 };
  }

  const today = todayIso();
  const effectiveDate = input.requestedDate && input.requestedDate >= today ? input.requestedDate : today;
  const blockingPeriod = await loadBlockingAttendancePeriod(access, input.workerId, effectiveDate);
  if (blockingPeriod) {
    return { error: "Attendance is already submitted or approved for this date. Mark the labourer inactive from the next permitted date.", status: 409 };
  }

  return { worker, unchanged: false, effectiveDate };
}

export async function applyInactiveWorkerStatusUpdate(access: any, request: Request, input: {
  workerId: string;
  reason: string;
  source: string;
  requestedDate: string | null;
  validation: any;
}) {
  if (input.validation.unchanged) {
    return {
      labour_worker_id: input.workerId,
      status: INACTIVE_STATUS,
      unchanged: true,
      effective_date: input.validation.effectiveDate,
      affected_deployment_id: null,
    };
  }

  const now = new Date().toISOString();
  const worker = input.validation.worker;
  const effectiveDate = input.validation.effectiveDate;
  const actorName = access.auth.user.user_metadata?.full_name || access.auth.user.user_metadata?.name || access.auth.user.email || "Unknown User";
  const { data: result, error: workerError } = await access.admin.rpc("inactivate_labour_worker_atomic", {
    p_worker_id: input.workerId,
    p_organization_id: worker.organization_id,
    p_effective_date: effectiveDate,
    p_reason: input.reason,
    p_actor_id: access.auth.user.id,
    p_actor_name: actorName,
    p_actor_email: access.auth.user.email || null,
  });
  if (workerError) throw workerError;

  await audit(access, request, {
    moduleCode: MODULE,
    action: "update",
    entityType: "labour_worker",
    recordId: input.workerId,
    organizationId: worker.organization_id,
    companyId: worker.current_company_id,
    siteId: worker.current_site_id,
    description: `Marked labourer ${worker.labour_code} inactive.`,
    oldValues: {
      status: worker.status,
      active_deployment: "closed atomically by inactivation RPC",
    },
    newValues: {
      status: INACTIVE_STATUS,
      effective_date: effectiveDate,
      requested_effective_date: input.requestedDate || null,
      reason: input.reason,
      source: input.source,
      closed_deployments: result?.closed_deployments ?? null,
    },
  });

  return {
    labour_worker_id: input.workerId,
    status: INACTIVE_STATUS,
    effective_date: effectiveDate,
    affected_deployment_id: null,
    closed_deployments: result?.closed_deployments ?? 0,
  };
}

export async function requireWorkerStatusAccess(request: Request, source: string | null) {
  const permissionModule = statusPermissionModule(source);
  if (!permissionModule) return { response: jsonError("Invalid status update source.") };
  return requireLabourPermission(request, permissionModule, "edit");
}
