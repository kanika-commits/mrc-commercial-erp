const HIDDEN_FIELDS = new Set([
  "id", "organization_id", "created_at", "updated_at", "created_by", "created_by_email", "created_by_name",
  "photo_storage_key", "photo_storage_bucket", "photo_storage_provider", "__audit",
]);

const FIELD_LABELS: Record<string, string> = {
  date_of_joining: "Date of Joining",
  labour_code: "Labour Code",
  worker_name: "Labour Name",
  photo_status: "Photo Status",
  aadhaar_status: "Aadhaar Status",
  current_site_id: "Site",
  current_company_id: "Company",
  labour_trades: "Trade / Labour Category",
  trade: "Trade / Labour Category",
  contractor_name: "Contractor",
  status: "Status",
};

export type LabourAuditReferenceMaps = {
  sites?: Map<string, string>;
  companies?: Map<string, string>;
  labour?: Map<string, string>;
  actors?: Map<string, string>;
};

export function resolveLabourIdentity(recordId: unknown, oldValues: unknown, newValues: unknown, maps: LabourAuditReferenceMaps = {}, action?: string) {
  const before = oldValues && typeof oldValues === "object" ? oldValues as Record<string, unknown> : {};
  const after = newValues && typeof newValues === "object" ? newValues as Record<string, unknown> : {};
  const name = after.worker_name || after.labour_name || before.worker_name || before.labour_name;
  const code = after.labour_code || before.labour_code;
  const mapped = maps.labour?.get(String(recordId || ""));
  const display = String(name || mapped || (/^(import|batch_import)$/i.test(String(action || "")) ? "Batch Import" : "Unavailable"));
  const codeDisplay = code && String(code) !== display ? String(code) : mapped && String(mapped) !== display && !String(mapped).includes(" ") ? String(mapped) : null;
  return { display, code: codeDisplay };
}

function isAadhaarField(field: string) {
  return /aadhaar|aadhar/i.test(field);
}

export function maskSensitiveAuditValue(value: unknown, field = "") {
  const text = String(value ?? "").replace(/\D/g, "");
  if (!isAadhaarField(field) || !text) return String(value ?? "");
  return text.length >= 4 ? `•••• •••• ${text.slice(-4)}` : "••••";
}

export function labelForAuditField(field: string) {
  return FIELD_LABELS[field] || field.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function readableDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export function formatAuditValue(value: unknown, field = "", maps: LabourAuditReferenceMaps = {}) : string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (field === "current_site_id" && maps.sites?.get(String(value))) return maps.sites.get(String(value))!;
  if (field === "current_company_id" && maps.companies?.get(String(value))) return maps.companies.get(String(value))!;
  if (field === "created_by" && maps.actors?.get(String(value))) return maps.actors.get(String(value))!;
  if (typeof value === "string") {
    if (isAadhaarField(field)) return maskSensitiveAuditValue(value, field);
    if (/^\d{4}-\d{2}-\d{2}(T|$)/.test(value)) return readableDate(value) || value;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return "—";
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => formatAuditValue(item, field, maps)).filter((item) => item !== "—").join(", ") || "—";
  if (typeof value === "object") {
    const item = value as Record<string, unknown>;
    const direct = item.name ?? item.label ?? item.trade_name ?? item.module_name ?? item.code;
    if (direct !== undefined) return formatAuditValue(direct, field, maps);
    return Object.entries(item).filter(([key]) => !HIDDEN_FIELDS.has(key)).map(([key, itemValue]) => `${labelForAuditField(key)}: ${formatAuditValue(itemValue, key, maps)}`).join(", ") || "—";
  }
  return String(value);
}

export function presentAuditChanges(oldValues: unknown, newValues: unknown, maps: LabourAuditReferenceMaps = {}) {
  const before = oldValues && typeof oldValues === "object" ? oldValues as Record<string, unknown> : {};
  const after = newValues && typeof newValues === "object" ? newValues as Record<string, unknown> : {};
  return Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
    .filter((field) => !HIDDEN_FIELDS.has(field))
    .filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]))
    .map((field) => ({ field, label: labelForAuditField(field), before: Object.prototype.hasOwnProperty.call(before, field) ? formatAuditValue(before[field], field, maps) : "Not recorded", after: Object.prototype.hasOwnProperty.call(after, field) ? formatAuditValue(after[field], field, maps) : "Not recorded", bothSnapshotsPresent: Object.prototype.hasOwnProperty.call(before, field) && Object.prototype.hasOwnProperty.call(after, field) }))
    .sort((left, right) => auditFieldPriority(right.field) - auditFieldPriority(left.field));
}

function auditFieldPriority(field: string) {
  if (/aadhaar|aadhar|rate|wage|salary|pay|bank|account|ifsc|site|company|deployment|transfer/i.test(field)) return 3;
  if (/date_of_joining|employment|contractor|status/i.test(field)) return 2;
  return 1;
}

export function conciseAuditSummary(changes: Array<{ label: string; before: string; after: string }>, limit = 3) {
  const visible = changes.slice(0, limit).map((change) => `${change.label}: ${change.before} → ${change.after}`);
  return changes.length > limit ? `${visible.join(" · ")} · + ${changes.length - limit} more changes` : visible.join(" · ");
}

export function deriveAuditEvent(action: string, changes: Array<{ field: string; label: string; bothSnapshotsPresent?: boolean }>) {
  const fields = changes.filter((change) => change.bothSnapshotsPresent !== false).map((change) => change.field);
  if (fields.some((field) => /aadhaar|aadhar/i.test(field))) return "Aadhaar Updated";
  if (fields.some((field) => /rate|wage|salary|pay/i.test(field))) return "Rate Revised";
  if (fields.some((field) => /bank|account|ifsc|payment/i.test(field))) return "Bank Details Updated";
  if (fields.some((field) => /site|company|deployment|transfer/i.test(field))) return "Transferred";
  if (action === "activate") return "Activated";
  if (action === "deactivate") return "Deactivated";
  if (action === "employment_change") return "Employment Changed";
  return action === "update" ? "Profile Updated" : action;
}
