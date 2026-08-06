import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { loadActiveAccountContext } from "@/lib/serverAccountAccess";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;
const FETCH_LIMIT = 2000;
const ACTIVITY_LIMIT_PER_USER = 100;
const ONLINE_THRESHOLD_MS = 10 * 60 * 1000;
const SENSITIVE_KEY_PATTERN = /(password|token|access_token|refresh_token|secret|service_role|authorization|api_key)/i;
const HIDDEN_KEY_PATTERN = /(^id$|_id$|uuid|active_deployment|closed_deployment|organization_id|company_id|site_id|created_by|updated_by|deleted_by|deployment_update|snapshot)/i;

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function text(value: unknown) {
  return String(value || "").trim();
}

function normalized(value: unknown) {
  return text(value).toLowerCase();
}

function numberParam(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function safeLike(value: string) {
  return value.replace(/[,%()]/g, " ").trim();
}

function unique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => text(value)).filter(Boolean)));
}

function normalizedEmail(value: unknown) {
  const email = normalized(value);
  return email.includes("@") ? email : "";
}

function canonicalFallbackName(value: unknown) {
  return normalized(value).replace(/\s+/g, " ");
}

function startOfDayIso(value: string) {
  return `${value}T00:00:00.000Z`;
}

function endOfDayIso(value: string) {
  return `${value}T23:59:59.999Z`;
}

function readableLabel(key: string) {
  const labels: Record<string, string> = {
    approval_status: "Approval Status",
    previous_approval_status: "Approval Status",
    suspended_approval_status: "Approval Status",
    previous_status: "Status",
    suspended_status: "Status",
    status: "Status",
    transition_reason: "Reason",
    send_back_reason: "Reason",
    rejection_reason: "Reason",
    remarks: "Remarks",
    deletion_reason: "Reason",
    labour_worker_id: "Labour",
    contractor_profile_id: "Contractor",
    site_id: "Site",
    company_id: "Company",
    effective_from: "Effective From",
    effective_to: "Effective To",
    wage_rate: "Wage Rate",
    daily_rate: "Wage Rate",
    commercial_model: "Commercial Model",
    labour_code: "Labour Code",
    worker_name: "Labour Name",
    employee_code: "Employee Code",
    employee_name: "Employee Name",
    department: "Department",
    department_name: "Department",
    designation: "Designation",
    designation_name: "Designation",
    wo_number: "Work Order",
    wo_type: "Work Order Type",
    wo_value: "Work Order Value",
    ra_bill_number: "RA Bill",
    ra_number: "RA Bill",
    invoice_number: "Invoice",
    payment_number: "Payment",
    debit_note_number: "Debit Note",
    vendor_name: "Vendor",
    attendance_date: "Attendance Date",
    document_number: "Document Number",
    description: "Description",
  };
  return labels[key] || key.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function cleanValue(value: unknown): unknown {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 5).map(cleanValue);
  const object = value as Record<string, unknown>;
  const meaningfulKeys = ["contractor", "contractor_name", "vendor_name", "site", "site_name", "trade", "trade_name", "wage_rate", "daily_rate", "status", "approval_status", "effective_from", "effective_to", "labour_code", "worker_name", "employee_code", "employee_name", "department", "department_name", "designation", "designation_name", "wo_number", "wo_type", "ra_bill_number", "ra_number", "invoice_number", "payment_number", "debit_note_number", "document_number", "description", "reason", "remarks", "attendance_date", "site_name", "contractor_name"];
  const picked = Object.fromEntries(
    meaningfulKeys
      .filter((key) => object[key] !== undefined && object[key] !== null && object[key] !== "")
      .map((key) => [readableLabel(key), cleanValue(object[key])]),
  );
  return Object.keys(picked).length ? picked : null;
}

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function summarizeObjectChanges(oldObject: Record<string, unknown>, newObject: Record<string, unknown>) {
  const keys = Array.from(new Set([...Object.keys(oldObject), ...Object.keys(newObject)]));
  return keys
    .filter((key) => !SENSITIVE_KEY_PATTERN.test(key) && !HIDDEN_KEY_PATTERN.test(key))
    .map((key) => {
      const before = cleanValue(oldObject[key]);
      const after = cleanValue(newObject[key]);
      if (before === null && after === null) return null;
      if (JSON.stringify(before) === JSON.stringify(after)) return null;
      return { label: readableLabel(key), before, after };
    })
    .filter(Boolean);
}

function summarizeChanges(oldValues: unknown, newValues: unknown) {
  return summarizeObjectChanges(objectValue(oldValues), objectValue(newValues));
}

function summarizeSnapshot(snapshot: unknown) {
  const source = objectValue(snapshot);
  const previous = objectValue(source.previous);
  const updated = objectValue(source.updated);
  const changes = updated && Object.keys(updated).length ? summarizeObjectChanges(previous, { ...previous, ...updated }) : [];
  if (source.previous_status || source.suspended_status) {
    changes.push({ label: "Status", before: source.previous_status || null, after: source.suspended_status || source.status || null });
  }
  if (source.previous_approval_status || source.suspended_approval_status) {
    changes.push({ label: "Approval Status", before: source.previous_approval_status || null, after: source.suspended_approval_status || source.approval_status || null });
  }
  return changes.filter((change: any) => change?.before !== change?.after);
}

function findValueByKeys(source: unknown, keys: string[]): unknown {
  if (!source || typeof source !== "object") return null;
  if (Array.isArray(source)) {
    for (const item of source) {
      const found = findValueByKeys(item, keys);
      if (found) return found;
    }
    return null;
  }
  const object = source as Record<string, unknown>;
  for (const key of keys) {
    if (object[key]) return object[key];
  }
  for (const value of Object.values(object)) {
    if (value && typeof value === "object") {
      const found = findValueByKeys(value, keys);
      if (found) return found;
    }
  }
  return null;
}

function recordLabelFromDescription(description: unknown) {
  const value = text(description);
  if (!value) return "";
  const patterns = [
    /\bLAB\d+\b/i,
    /\bEMP\d+\b/i,
    /\b[A-Z]+\/[A-Z0-9]+\/\d+(?:-R\d+)?\b/i,
    /\b(?:RA|RB|INV|PAY)[-\/]?[A-Z0-9-]+\b/i,
    /\b\d{4}-\d{2}-\d{2}\b/,
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[0]) return match[0];
  }
  const labourMatch = value.match(/labourer\s+([A-Z0-9-]+)/i);
  if (labourMatch?.[1]) return labourMatch[1];
  return "";
}

function isAuthenticationEvent(row: any) {
  const source = normalized([
    row.module_code,
    row.module,
    row.entity_type,
    row.document_type,
    row.technical?.entity_type,
    row.action,
    row.description,
  ].filter(Boolean).join(" "));

  return (
    source.includes("authentication") ||
    source.includes("user_session") ||
    source.includes("session refresh") ||
    source.includes("session refreshed") ||
    source.includes("session expired") ||
    ["login", "logout", "heartbeat", "session_expired"].includes(normalized(row.action))
  );
}

function authenticationActivityLabel(action: string) {
  const labels: Record<string, string> = {
    login: "User Logged In",
    logout: "User Logged Out",
    heartbeat: "Session Refreshed",
    session_expired: "Session Expired",
  };
  return labels[normalized(action)] || "";
}

function authenticationDescription(action: string) {
  const descriptions: Record<string, string> = {
    login: "User signed in successfully.",
    logout: "User signed out.",
    heartbeat: "User session is active.",
    session_expired: "User session expired.",
  };
  return descriptions[normalized(action)] || "—";
}

function recordLabel(row: any) {
  if (isAuthenticationEvent(row)) return "—";
  if (row.document_number) return row.document_number;
  const sources = [row.new_values, row.old_values, row.record_snapshot, row.related_snapshot, row.file_snapshot].filter(Boolean);
  const keys = ["document_number", "wo_number", "ra_bill_number", "ra_number", "invoice_number", "payment_number", "debit_note_number", "employee_code", "labour_code", "vendor_name", "employee_name", "worker_name", "attendance_date"];
  for (const source of sources) {
    const value = findValueByKeys(source, keys);
    if (value) {
      const label = String(value);
      if (/^\d{4}-\d{2}-\d{2}$/.test(label)) return `Attendance · ${label}`;
      return label;
    }
  }
  const descriptionLabel = recordLabelFromDescription(row.description || row.deletion_reason);
  if (descriptionLabel) return descriptionLabel;
  return "Record details";
}

function extractReason(...sources: unknown[]) {
  const keys = ["deletion_reason", "transition_reason", "send_back_reason", "rejection_reason", "remarks"];
  for (const source of sources) {
    const found = findValueByKeys(source, keys);
    if (found) return text(found);
  }
  return "";
}

function deletedDisplayAction(row: any) {
  const documentType = normalized(row.document_type);
  const reason = normalized(row.deletion_reason);
  const snapshotAction = normalized(row.record_snapshot?.action);
  if (documentType.includes("correction") || snapshotAction.includes("correction")) return "corrected";
  if (documentType.includes("suspension") || reason.includes("suspended") || snapshotAction.includes("suspended")) return "suspended";
  return "delete";
}

function workflowEvidence(values: unknown, fallbackText = "") {
  const source = objectValue(values);
  const textSource = normalized(fallbackText);
  return Boolean(
    source.approval_status ||
    source.previous_approval_status ||
    source.suspended_approval_status ||
    objectValue(source.previous).approval_status ||
    ["submitted", "finalized", "sent_back", "reopened", "suspended", "approved", "pending"].some((word) => textSource.includes(word)),
  );
}

function workflowStageFromValues(values: unknown, fallbackText = "") {
  const source = objectValue(values);
  const textSource = normalized(fallbackText);
  const status = normalized(source.status);
  const approvalStatus = normalized(source.approval_status);
  const previousApproval = normalized(source.previous_approval_status || objectValue(source.previous).approval_status);
  const nextApproval = normalized(source.suspended_approval_status || source.approval_status);
  if (textSource.includes("before approval")) return "Before Approval";
  if (textSource.includes("from approval workflow") || textSource.includes("during approval")) return "During Approval";
  if (previousApproval === "pending" || approvalStatus === "pending") return "Pending Approval";
  if (previousApproval === "approved" || approvalStatus === "approved") return "After Approval";
  if (nextApproval === "suspended" || status === "suspended") return "Suspended";
  if (status === "submitted" || approvalStatus === "submitted") return "Submitted";
  if (status === "finalized" || approvalStatus === "finalized") return "Finalized";
  if (status.includes("sent_back") || approvalStatus.includes("sent_back")) return "Sent Back";
  if (status === "reopened" || approvalStatus === "reopened") return "Reopened";
  if (status === "draft" || approvalStatus === "draft") return "Not Applicable";
  return workflowEvidence(values, fallbackText) ? "Not Available" : "Not Applicable";
}

function deletedStage(row: any, action: string) {
  const reason = text(row.deletion_reason);
  if (action === "corrected" && normalized(row.record_snapshot?.previous?.approval_status) === "pending") return "Before Approval";
  if (action === "suspended" && normalized(row.record_snapshot?.previous_approval_status) === "pending") return "During Approval";
  return workflowStageFromValues(row.record_snapshot, reason);
}

function auditStage(row: any) {
  const stage = workflowStageFromValues(row.new_values, text(row.description));
  if (stage !== "Not Applicable" && stage !== "Not Available") return stage;
  const oldStage = workflowStageFromValues(row.old_values, text(row.description));
  if (oldStage !== "Not Applicable" && oldStage !== "Not Available") return oldStage;
  if (workflowEvidence(row.new_values, row.description) || workflowEvidence(row.old_values, row.description)) return stage === "Not Available" || oldStage === "Not Available" ? "Not Available" : "Not Applicable";
  return "Not Applicable";
}

function actionVerb(action: string) {
  const labels: Record<string, string> = {
    login: "User Logged In",
    logout: "User Logged Out",
    heartbeat: "Session Refreshed",
    session_expired: "Session Expired",
    corrected: "Corrected",
    suspended: "Suspended",
    delete: "Deleted",
    update: "Edited",
    edit: "Edited",
    create: "Added",
    add: "Added",
    approve: "Approved",
    reject: "Rejected",
    submit: "Submitted",
    send_back: "Sent Back",
    reopen: "Reopened",
    finalize: "Finalized",
    upload: "Uploaded",
    document_upload: "Uploaded Document",
    permission_change: "Changed Permissions",
  };
  return labels[action] || readableLabel(action);
}

function sourceText(row: any) {
  return normalized([
    row.module,
    row.module_code,
    row.entity_type,
    row.document_type,
    row.technical?.entity_type,
    row.description,
    row.deletion_reason,
  ].filter(Boolean).join(" "));
}

function entityDisplayName(row: any) {
  if (isAuthenticationEvent(row)) return "Authentication";
  const source = sourceText(row);
  if (source.includes("organization")) return "Organization";
  if (source.includes("company_bank_account")) return "Company Bank Account";
  if (source.includes("company")) return "Company";
  if (source.includes("site")) return "Site";
  if (source.includes("work_order") || source.includes("work order") || source.includes("wo_")) return "Work Order";
  if (source.includes("labour") || source.includes("worker")) return "Labour";
  if (source.includes("attendance")) return "Attendance";
  if (source.includes("itc")) return "Invoice ITC";
  if (source.includes("invoice")) return "Invoice";
  if (source.includes("payment")) return "Payment";
  if (source.includes("ra_bill") || source.includes("ra bill")) return "RA Bill";
  if (source.includes("debit")) return "Debit Note";
  if (source.includes("employee")) return "Employee";
  if (source.includes("permission")) return "Permissions";
  if (source.includes("role")) return "Role";
  if (source.includes("user")) return "User";
  if (source.includes("vendor")) return "Vendor";
  if (source.includes("document")) return "Document";
  return "Record";
}

function valueByAnyKey(row: any, keys: string[]) {
  return findValueByKeys(row.new_values, keys) ?? findValueByKeys(row.old_values, keys) ?? findValueByKeys(row.record_snapshot, keys);
}

function changedKey(row: any, keys: string[]) {
  const oldValues = objectValue(row.old_values || objectValue(row.record_snapshot).previous);
  const newValues = objectValue(row.new_values || objectValue(row.record_snapshot).updated || row.record_snapshot);
  return keys.some((key) => JSON.stringify(cleanValue(oldValues[key])) !== JSON.stringify(cleanValue(newValues[key])) && (oldValues[key] !== undefined || newValues[key] !== undefined));
}

function statusTransition(row: any) {
  const oldValues = objectValue(row.old_values || objectValue(row.record_snapshot).previous);
  const newValues = objectValue(row.new_values || objectValue(row.record_snapshot).updated || row.record_snapshot);
  const before = normalized(oldValues.status || oldValues.previous_status || objectValue(row.record_snapshot).previous_status);
  const after = normalized(newValues.status || newValues.suspended_status || objectValue(row.record_snapshot).suspended_status || objectValue(row.record_snapshot).status);
  return { before, after };
}

function businessActivityLabel(row: any, action: string) {
  const entity = entityDisplayName(row);
  const description = normalized(row.description || row.deletion_reason);
  const transition = statusTransition(row);

  if (entity === "Authentication") {
    return authenticationActivityLabel(action) || actionVerb(action);
  }

  if (entity === "Labour") {
    if (action === "create") return "Registered Labour";
    if (transition.before === "active" && transition.after === "inactive") return "Marked Labour Inactive";
    if (transition.before === "inactive" && transition.after === "active") return "Marked Labour Active";
    if (changedKey(row, ["contractor_profile_id", "contractor", "contractor_name", "site_id", "site", "site_name", "manpower_work_order_id", "wo_number"])) return "Transferred Labour";
    if (changedKey(row, ["wage_rate", "daily_rate"])) return "Changed Labour Wage Rate";
    return action === "update" || action === "edit" ? "Updated Labour" : `${actionVerb(action)} Labour`;
  }

  if (entity === "Work Order") {
    if (action === "create" || action === "add") return "Created Work Order";
    if (action === "corrected") return "Corrected Work Order";
    if (action === "suspended") return "Suspended Work Order";
    if (action === "approve") return "Approved Work Order";
    if (action === "send_back") return "Sent Back Work Order";
    if (transition.after === "completed" || description.includes("completed")) return "Completed Work Order";
    if (transition.after === "terminated" || description.includes("terminated")) return "Terminated Work Order";
    if (action === "update" || action === "edit") return "Updated Work Order";
  }

  if (entity === "Attendance") {
    if (action === "submit") return "Submitted Attendance";
    if (action === "approve") return "Approved Attendance";
    if (action === "finalize") return "Finalized Attendance";
    if (action === "send_back") return "Sent Back Attendance";
    if (action === "reopen") return "Reopened Attendance";
    if (action === "update" || action === "edit" || action === "create") return "Updated Attendance";
  }

  if (entity === "Invoice ITC") {
    if (action === "reject" || description.includes("reject")) return "Rejected Invoice ITC";
    return "Claimed Invoice ITC";
  }

  if (entity === "Invoice") {
    if (action === "create" || action === "add") return "Created Invoice";
    if (action === "approve" || action === "finalize") return "Approved Invoice";
    if (action === "reject") return "Rejected Invoice";
    if (action === "update" || action === "edit") return "Updated Invoice";
  }

  if (entity === "Payment") {
    if (action === "create" || action === "add") return "Created Payment";
    if (action === "delete") return "Deleted Payment";
    if (action === "update" || action === "edit") return "Updated Payment";
  }

  if (entity === "RA Bill") {
    if (action === "create" || action === "add") return "Created RA Bill";
    if (action === "submit") return "Submitted RA Bill";
    if (action === "approve" || action === "finalize") return "Approved RA Bill";
    if (action === "reject") return "Rejected RA Bill";
    if (action === "delete") return "Deleted RA Bill";
    if (action === "update" || action === "edit") return "Updated RA Bill";
  }

  if (entity === "Employee") {
    if (action === "create" || action === "add") return "Added Employee";
    if (changedKey(row, ["department_id", "department", "department_name"])) return "Changed Employee Department";
    if (changedKey(row, ["designation_id", "designation", "designation_name"])) return "Changed Employee Designation";
    if (changedKey(row, ["salary", "salary_amount", "wage_rate", "ctc"])) return "Updated Employee Salary";
    if (description.includes("document") || action.includes("document")) return "Uploaded Employee Document";
    if (action === "update" || action === "edit") return "Updated Employee";
  }

  if (entity === "User") {
    if (action === "create" || action === "add") return "Created User";
    if (description.includes("role") || changedKey(row, ["role_id", "role", "roles"])) return "Changed User Role";
    if (description.includes("password") || action.includes("password")) return "Changed Password";
    if (action === "update" || action === "edit") return "Updated User";
  }

  if (entity === "Permissions" || description.includes("permission")) return "Changed Permissions";

  if (entity === "Vendor") {
    if (action === "create" || action === "add") return "Created Vendor";
    if (changedKey(row, ["bank_account", "bank_name", "account_number", "ifsc"])) return "Updated Vendor Bank Details";
    if (changedKey(row, ["contact_person", "phone", "email", "mobile"])) return "Updated Vendor Contact";
    if (changedKey(row, ["gstin", "gst_number", "gst_status"])) return "Updated Vendor GST";
    if (action === "update" || action === "edit") return "Updated Vendor";
  }

  if (description.includes("upload") || action.includes("upload")) return "Uploaded Document";
  if (action === "create" || action === "add") return `Added ${entity}`;
  if (action === "update" || action === "edit" || action === "corrected") return `Updated ${entity}`;
  if (action === "approve" || action === "finalize") return `Approved ${entity}`;
  if (action === "reject") return `Rejected ${entity}`;
  if (action === "delete") return `Deleted ${entity}`;
  if (action === "submit") return `Submitted ${entity}`;
  if (action === "send_back") return `Sent Back ${entity}`;
  if (action === "suspended") return `Suspended ${entity}`;
  if (action === "reopen") return `Reopened ${entity}`;
  return `${actionVerb(action)} ${entity}`;
}

function titleCaseStatus(value: string) {
  if (!value) return "";
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function meaningfulStoredDescription(fallback: unknown, activity: string, record: string, reason = "") {
  const value = text(fallback);
  if (!value || value === reason || value === "No description recorded.") return "";
  const compactValue = normalized(value).replace(/[^a-z0-9]+/g, " ").trim();
  const compactActivity = normalized(activity).replace(/[^a-z0-9]+/g, " ").trim();
  const compactRecord = normalized(record).replace(/[^a-z0-9]+/g, " ").trim();
  if (compactActivity && compactRecord) {
    const duplicate = `${compactActivity} ${compactRecord}`.trim();
    if (compactValue === duplicate) return "";
    if (compactValue.includes(compactActivity) && compactValue.includes(compactRecord) && compactValue.length <= duplicate.length + 12) return "";
  }
  if (compactValue === compactActivity || (compactRecord && compactValue === compactRecord)) return "";
  return value;
}

function assignedSiteDescription(row: any) {
  const site = text(valueByAnyKey(row, ["site_name", "site", "assigned_site_name"]));
  return site ? `Registered and assigned to ${site}.` : "";
}

function businessDescription(row: any, action: string, record: string, fallback: unknown, reason = "", activity = "") {
  const entity = entityDisplayName(row);
  const label = activity || businessActivityLabel(row, action);
  const transition = statusTransition(row);

  if (entity === "Authentication") return authenticationDescription(action);

  if (entity === "Labour") {
    if (transition.before && transition.after && transition.before !== transition.after) {
      return `Status changed from ${titleCaseStatus(transition.before)} to ${titleCaseStatus(transition.after)}.`;
    }
    if (label === "Registered Labour") {
      const assigned = assignedSiteDescription(row);
      if (assigned) return assigned;
    }
  }

  if (entity === "Work Order" && action === "corrected") return "Pending Work Order details corrected before approval.";
  if (entity === "Work Order" && action === "suspended") return "Work Order suspended from approval workflow.";

  return meaningfulStoredDescription(fallback, label, record, reason) || "—";
}

function lastActivityDescription(activity: any) {
  const label = activity.display_activity || actionVerb(activity.action || "");
  if (activity.record && activity.record !== "Record details" && activity.record !== "—") return `${label} · ${activity.record}`;
  return label || activity.description || "—";
}

function summaryBucket(action: string) {
  if (action === "create" || action === "add") return "created";
  if (action === "update" || action === "edit" || action === "corrected") return "edited";
  if (action === "approve" || action === "finalize") return "approved";
  if (action === "reject") return "rejected";
  if (action === "delete") return "deleted";
  if (action === "suspended") return "suspended";
  if (action === "send_back" || action === "sent_back") return "sent_back";
  return null;
}

function buildSelectedSummary(activities: any[]) {
  const summary = {
    activities: activities.length,
    created: 0,
    edited: 0,
    approved: 0,
    rejected: 0,
    deleted: 0,
    suspended: 0,
    sent_back: 0,
  };
  for (const activity of activities) {
    const bucket = summaryBucket(activity.action);
    if (bucket && bucket in summary) summary[bucket as keyof typeof summary] += 1;
  }
  return summary;
}


function recordUrl(row: any, recordId: unknown) {
  if (isAuthenticationEvent(row)) return null;

  const id = text(recordId);
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const entity = entityDisplayName(row);
  const allowedEntities = new Set([
    "Work Order",
    "Vendor",
    "Employee",
    "Labour",
    "Company",
    "Site",
    "Organization",
    "User",
    "Role",
    "Permissions",
    "RA Bill",
    "Invoice",
    "Payment",
    "Debit Note",
  ]);
  if (!allowedEntities.has(entity)) return null;

  const routeByEntity: Record<string, string> = {
    "Work Order": "/work-orders",
    "Labour": "/labour/workers",
    "Employee": "/hr/employees",
    "Vendor": "/vendors",
    "Company": "/companies",
    "Site": "/sites",
    "Organization": "/organizations",
    "Invoice": "/invoices",
    "Invoice ITC": "/invoices",
    "RA Bill": "/ra-bills",
    "Payment": "/payments",
    "Debit Note": "/debit-notes",
    "User": "/admin/users",
    "Role": "/admin/roles",
    "Permissions": "/admin/permissions",
  };
  const base = routeByEntity[entity];
  return base ? `${base}/${id}` : null;
}

function mapAuditRow(row: any, resolveActor: (input: any) => any) {
  const authenticationEvent = isAuthenticationEvent(row);
  const record = recordLabel(row);
  const reason = extractReason(row.new_values, row.old_values) || "";
  const stage = authenticationEvent ? "—" : auditStage(row);
  const changes = summarizeChanges(row.old_values, row.new_values);
  if (!authenticationEvent && reason) changes.push({ label: "Reason", before: null, after: reason });
  if (!authenticationEvent && stage !== "Not Available") changes.push({ label: "Stage", before: null, after: stage });
  const actor = resolveActor({ id: row.created_by, email: row.created_by_email, name: row.created_by_name });
  const action = row.action || "other";
  const displayActivity = businessActivityLabel(row, action);
  return {
    id: row.id,
    actor_key: actor.key,
    user_id: actor.user_id,
    user_name: actor.user_name,
    user_email: actor.user_email,
    created_at: row.created_at,
    module: row.module_code || "-",
    action,
    display_activity: displayActivity,
    record,
    record_url: authenticationEvent ? null : recordUrl(row, row.record_id),
    stage,
    reason: authenticationEvent ? "—" : reason || "-",
    description: businessDescription(row, action, record, row.description || "No description recorded.", reason, displayActivity),
    changes,
    technical: {
      source_table: "erp_audit_logs",
      record_id: row.record_id || null,
      parent_record_id: row.parent_record_id || null,
      entity_type: row.entity_type || null,
      ip_address: row.ip_address || null,
      browser: row.browser || null,
      device_type: row.device_type || null,
    },
  };
}

function mapDeletedRow(row: any, resolveActor: (input: any) => any) {
  const action = deletedDisplayAction(row);
  const record = recordLabel(row);
  const reason = text(row.deletion_reason) || "";
  const stage = deletedStage(row, action);
  const changes = summarizeSnapshot(row.record_snapshot);
  if (reason) changes.push({ label: "Reason", before: null, after: reason });
  if (stage !== "Not Available") changes.push({ label: "Stage", before: null, after: stage });
  const actor = resolveActor({ email: row.deleted_by_email, name: row.deleted_by_name });
  const displayActivity = businessActivityLabel(row, action);
  return {
    id: row.id,
    actor_key: actor.key,
    user_id: actor.user_id,
    user_name: actor.user_name,
    user_email: actor.user_email,
    created_at: row.deleted_at || row.created_at,
    module: row.module_code || "-",
    action,
    display_activity: displayActivity,
    record,
    record_url: recordUrl(row, row.document_id),
    stage,
    reason: reason || "-",
    description: businessDescription(row, action, record, row.deletion_reason || "", reason, displayActivity),
    changes,
    technical: {
      source_table: "deleted_records_audit",
      record_id: row.document_id || null,
      entity_type: row.document_type || null,
      ip_address: null,
      browser: null,
      device_type: null,
    },
  };
}

async function loadActorResolver(admin: any, auditRows: any[], deletedRows: any[]) {
  const ids = unique(auditRows.map((row) => row.created_by));
  const emails = unique([
    ...auditRows.map((row) => normalizedEmail(row.created_by_email)),
    ...deletedRows.map((row) => normalizedEmail(row.deleted_by_email)),
  ]);
  const [profilesByIdResult, profilesByEmailResult] = await Promise.all([
    ids.length ? admin.from("profiles").select("id, email, full_name").in("id", ids) : Promise.resolve({ data: [], error: null }),
    emails.length ? admin.from("profiles").select("id, email, full_name").in("email", emails) : Promise.resolve({ data: [], error: null }),
  ]);
  if (profilesByIdResult.error) throw profilesByIdResult.error;
  if (profilesByEmailResult.error) throw profilesByEmailResult.error;
  type ActorProfile = { id: string; email: string | null; full_name: string | null };
  const byId = new Map<string, ActorProfile>((profilesByIdResult.data || []).map((profile: any) => [profile.id, profile as ActorProfile]));
  const byEmail = new Map<string, ActorProfile>((profilesByEmailResult.data || []).map((profile: any) => [normalizedEmail(profile.email), profile as ActorProfile]));
  return ({ id, email, name }: { id?: string | null; email?: string | null; name?: string | null }) => {
    const emailKey = normalizedEmail(email);
    const profile = (id ? byId.get(id) : null) || (emailKey ? byEmail.get(emailKey) : null);
    if (profile) {
      return {
        key: `profile:${profile.id}`,
        user_id: profile.id,
        user_name: profile.full_name || name || profile.email || "Unknown User",
        user_email: profile.email || email || null,
      };
    }
    if (id) return { key: `uuid:${id}`, user_id: id, user_name: name || email || "Unknown User", user_email: email || null };
    if (emailKey) return { key: `email:${emailKey}`, user_id: null, user_name: name || emailKey, user_email: emailKey };
    const nameKey = canonicalFallbackName(name);
    return { key: nameKey ? `name:${nameKey}` : "unknown", user_id: null, user_name: name || "Unknown User", user_email: email || null };
  };
}


function onlineCutoffIso() {
  return new Date(Date.now() - ONLINE_THRESHOLD_MS).toISOString();
}

function sessionIsOnline(session: any) {
  if (session.logout_at || !session.last_seen_at) return false;
  return new Date(session.last_seen_at).getTime() >= Date.now() - ONLINE_THRESHOLD_MS;
}

function latestSession(sessions: any[]) {
  return [...sessions].sort((a, b) => String(b.last_seen_at || b.login_at || "").localeCompare(String(a.last_seen_at || a.login_at || "")))[0] || null;
}

function earliestActiveSession(sessions: any[]) {
  return [...sessions].filter(sessionIsOnline).sort((a, b) => String(a.login_at || "").localeCompare(String(b.login_at || "")))[0] || null;
}

function presenceSummaryForSessions(sessions: any[]) {
  if (!sessions.length) {
    return { status: "offline", login_time: null, logout_time: null, last_seen_at: null, browser: null, device_type: null };
  }
  const active = sessions.filter(sessionIsOnline);
  if (active.length) {
    const loginSession = earliestActiveSession(active);
    const seenSession = latestSession(active);
    return {
      status: "online",
      login_time: loginSession?.login_at || null,
      logout_time: null,
      last_seen_at: seenSession?.last_seen_at || null,
      browser: seenSession?.browser || null,
      device_type: seenSession?.device_type || null,
    };
  }
  const latest = latestSession(sessions);
  return {
    status: "offline",
    login_time: latest?.login_at || null,
    logout_time: latest?.logout_at || null,
    last_seen_at: latest?.last_seen_at || null,
    browser: latest?.browser || null,
    device_type: latest?.device_type || null,
  };
}

async function loadPresence(admin: any, account: any, activityUsers: any[], userFilter = "") {
  const scopedOrganizations = account.roleCodes.includes("platform_owner") ? [] : account.organizations || [];
  if (!account.roleCodes.includes("platform_owner") && scopedOrganizations.length === 0) {
    return { byUser: new Map<string, any>(), onlineUsers: [], sessionUsers: [] };
  }

  let onlineQuery = admin
    .from("user_session_activity")
    .select("id, user_id, organization_id, session_id, login_at, last_seen_at, logout_at, browser, device_type")
    .is("logout_at", null)
    .gte("last_seen_at", onlineCutoffIso())
    .order("last_seen_at", { ascending: false })
    .limit(500);
  if (!account.roleCodes.includes("platform_owner")) onlineQuery = onlineQuery.in("organization_id", scopedOrganizations);

  let sessionQuery = admin
    .from("user_session_activity")
    .select("id, user_id, organization_id, session_id, login_at, last_seen_at, logout_at, browser, device_type")
    .order("last_seen_at", { ascending: false })
    .limit(FETCH_LIMIT);
  if (!account.roleCodes.includes("platform_owner")) sessionQuery = sessionQuery.in("organization_id", scopedOrganizations);

  const [onlineResult, sessionResult] = await Promise.all([onlineQuery, sessionQuery]);
  if (onlineResult.error) throw onlineResult.error;
  if (sessionResult.error) throw sessionResult.error;

  const sessions = [...(onlineResult.data || []), ...(sessionResult.data || [])];
  const uniqueSessions = Array.from(new Map(sessions.map((session: any) => [session.id, session])).values());
  const sessionsByUser = new Map<string, any[]>();
  for (const session of uniqueSessions) {
    if (!session.user_id) continue;
    const existing = sessionsByUser.get(session.user_id) || [];
    existing.push(session);
    sessionsByUser.set(session.user_id, existing);
  }

  const userIds = Array.from(sessionsByUser.keys());
  const profilesResult = userIds.length
    ? await admin.from("profiles").select("id, email, full_name").in("id", userIds)
    : { data: [], error: null };
  if (profilesResult.error) throw profilesResult.error;
  const profiles = new Map((profilesResult.data || []).map((profile: any) => [profile.id, profile]));
  const filter = normalized(userFilter);

  const byUser = new Map<string, any>();
  const sessionUsers = Array.from(sessionsByUser.entries())
    .map(([userId, userSessions]) => {
      const profile = profiles.get(userId) as any;
      const summary = presenceSummaryForSessions(userSessions);
      return {
        user_id: userId,
        user_name: profile?.full_name || profile?.email || "Unknown User",
        user_email: profile?.email || "-",
        ...summary,
      };
    })
    .filter((sessionUser) => {
      if (!filter) return true;
      return normalized(sessionUser.user_name).includes(filter) || normalized(sessionUser.user_email).includes(filter);
    });

  for (const sessionUser of sessionUsers) {
    byUser.set(sessionUser.user_id, {
      status: sessionUser.status,
      login_time: sessionUser.login_time,
      logout_time: sessionUser.logout_time,
      last_seen_at: sessionUser.last_seen_at,
      browser: sessionUser.browser,
      device_type: sessionUser.device_type,
    });
  }

  const onlineUsers = sessionUsers
    .filter((sessionUser) => sessionUser.status === "online")
    .sort((a, b) => String(b.last_seen_at || "").localeCompare(String(a.last_seen_at || "")));

  return { byUser, onlineUsers, sessionUsers };
}

function groupByUser(activities: any[]) {
  const groups = new Map<string, any>();
  for (const activity of activities) {
    const key = activity.actor_key;
    const existing = groups.get(key) || {
      user_id: activity.user_id,
      user_name: activity.user_name || activity.user_email || "Unknown User",
      user_email: activity.user_email || "-",
      login_time: null,
      logout_time: null,
      total_activities: 0,
      last_activity_at: null,
      last_activity_description: "-",
      activities: [],
    };
    existing.total_activities += 1;
    if (!existing.last_activity_at || String(activity.created_at) > String(existing.last_activity_at)) {
      existing.last_activity_at = activity.created_at;
      existing.last_activity_description = lastActivityDescription(activity);
    }
    if (existing.activities.length < ACTIVITY_LIMIT_PER_USER) existing.activities.push(activity);
    groups.set(key, existing);
  }
  return Array.from(groups.values()).sort((a, b) => String(b.last_activity_at || "").localeCompare(String(a.last_activity_at || "")));
}

function blankActivityUserFromSession(sessionUser: any) {
  return {
    user_id: sessionUser.user_id,
    user_name: sessionUser.user_name || sessionUser.user_email || "Unknown User",
    user_email: sessionUser.user_email || "-",
    login_time: null,
    logout_time: null,
    total_activities: 0,
    last_activity_at: null,
    last_activity_description: "-",
    activities: [],
  };
}

function mergeActivityAndSessionUsers(activityUsers: any[], presence: any) {
  const usersById = new Map<string, any>();
  const fallbackUsers: any[] = [];

  for (const activityUser of activityUsers) {
    if (activityUser.user_id) usersById.set(activityUser.user_id, activityUser);
    else fallbackUsers.push(activityUser);
  }

  for (const sessionUser of presence.sessionUsers || []) {
    if (!sessionUser.user_id || usersById.has(sessionUser.user_id)) continue;
    usersById.set(sessionUser.user_id, blankActivityUserFromSession(sessionUser));
  }

  return [...usersById.values(), ...fallbackUsers]
    .map((user) => ({
      ...user,
      ...(user.user_id && presence.byUser.get(user.user_id)
        ? presence.byUser.get(user.user_id)
        : { status: "offline", login_time: null, logout_time: null, last_seen_at: null, browser: null, device_type: null }),
    }))
    .sort((a, b) => {
      const aOnline = a.status === "online";
      const bOnline = b.status === "online";
      if (aOnline !== bOnline) return aOnline ? -1 : 1;
      if (aOnline && bOnline) return String(b.login_time || "").localeCompare(String(a.login_time || ""));
      const activityCompare = String(b.last_activity_at || "").localeCompare(String(a.last_activity_at || ""));
      if (activityCompare !== 0) return activityCompare;
      return String(a.user_name || "").localeCompare(String(b.user_name || ""));
    });
}

export async function GET(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const token = request.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return jsonError("Missing auth token.", 401);
    if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");

    const authClient = createClient(supabaseUrl, anonKey);
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: { user }, error: userError } = await authClient.auth.getUser(token);
    if (userError) throw userError;
    if (!user) return jsonError("User not found.", 401);

    const account = await loadActiveAccountContext(admin, user);
    if ("response" in account) return account.response;
    const allowed = account.roleCodes.includes("platform_owner") || account.roleCodes.includes("super_admin");
    if (!allowed) return jsonError("Only Platform Owner and Super Admin can view system activity.", 403);

    const { searchParams } = new URL(request.url);
    const page = numberParam(searchParams.get("page"), 1);
    const pageSize = Math.min(numberParam(searchParams.get("page_size"), DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
    const dateFrom = text(searchParams.get("date_from"));
    const dateTo = text(searchParams.get("date_to"));
    const userFilter = safeLike(text(searchParams.get("user")));
    const mode = text(searchParams.get("mode"));

    if (mode === "presence") {
      const userIds = unique(text(searchParams.get("user_ids")).split(","));
      const presence = await loadPresence(admin, account, userIds.map((user_id) => ({ user_id })));
      return NextResponse.json({
        online_users: presence.onlineUsers,
        users_presence: Object.fromEntries(Array.from(presence.byUser.entries())),
        login_logout_tracking_enabled: true,
        online_threshold_minutes: ONLINE_THRESHOLD_MS / 60000,
      });
    }

    let auditQuery = admin
      .from("erp_audit_logs")
      .select("id, organization_id, module_code, entity_type, record_id, parent_entity_type, parent_record_id, action, description, old_values, new_values, ip_address, browser, device_type, created_by, created_by_name, created_by_email, created_at")
      .order("created_at", { ascending: false })
      .limit(FETCH_LIMIT);

    if (!account.roleCodes.includes("platform_owner")) {
      if (!account.organizations.length) {
        const emptySummary = buildSelectedSummary([]);
        return NextResponse.json({ users: [], online_users: [], selected_summary: emptySummary, today_summary: emptySummary, total_users: 0, page, page_size: pageSize, has_more: false, login_logout_tracking_enabled: true, online_threshold_minutes: ONLINE_THRESHOLD_MS / 60000 });
      }
      auditQuery = auditQuery.in("organization_id", account.organizations);
    }
    if (dateFrom) auditQuery = auditQuery.gte("created_at", startOfDayIso(dateFrom));
    if (dateTo) auditQuery = auditQuery.lte("created_at", endOfDayIso(dateTo));
    if (userFilter) auditQuery = auditQuery.or(`created_by_name.ilike.%${userFilter}%,created_by_email.ilike.%${userFilter}%`);

    let deletedQuery = admin
      .from("deleted_records_audit")
      .select("id, organization_id, module_code, document_type, document_id, document_number, deleted_by_name, deleted_by_email, deleted_at, deletion_reason, record_snapshot, related_snapshot, file_snapshot, created_at")
      .order("deleted_at", { ascending: false })
      .limit(FETCH_LIMIT);
    if (!account.roleCodes.includes("platform_owner")) deletedQuery = deletedQuery.in("organization_id", account.organizations);
    if (dateFrom) deletedQuery = deletedQuery.gte("deleted_at", startOfDayIso(dateFrom));
    if (dateTo) deletedQuery = deletedQuery.lte("deleted_at", endOfDayIso(dateTo));
    if (userFilter) deletedQuery = deletedQuery.or(`deleted_by_name.ilike.%${userFilter}%,deleted_by_email.ilike.%${userFilter}%`);

    const [auditResult, deletedResult] = await Promise.all([auditQuery, deletedQuery]);
    if (auditResult.error) throw auditResult.error;
    if (deletedResult.error) throw deletedResult.error;

    const auditRows = auditResult.data || [];
    const deletedRows = (deletedResult.data || []) as any[];
    const resolveActor = await loadActorResolver(admin, auditRows, deletedRows);
    const activities = [
      ...auditRows.map((row: any) => mapAuditRow(row, resolveActor)),
      ...deletedRows.map((row: any) => mapDeletedRow(row, resolveActor)),
    ].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    const groupedUsers = groupByUser(activities);
    const presence = await loadPresence(admin, account, groupedUsers, userFilter);
    const selectedSummary = buildSelectedSummary(activities);
    const users = mergeActivityAndSessionUsers(groupedUsers, presence);
    const start = (page - 1) * pageSize;

    return NextResponse.json({
      users: users.slice(start, start + pageSize),
      online_users: presence.onlineUsers,
      selected_summary: selectedSummary,
      today_summary: selectedSummary,
      total_users: users.length,
      page,
      page_size: pageSize,
      has_more: start + pageSize < users.length,
      login_logout_tracking_enabled: true,
      online_threshold_minutes: ONLINE_THRESHOLD_MS / 60000,
    });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load system activity.", 500);
  }
}
