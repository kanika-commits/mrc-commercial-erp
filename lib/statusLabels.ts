const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  inactive: "Inactive",
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  completed: "Completed",
  suspended: "Suspended",
  terminated: "Terminated",
  yet_to_start: "Yet to Start",
};

export function formatStatusLabel(value: string | null | undefined) {
  const raw = String(value || "").trim();
  if (!raw) return "-";

  const normalized = raw.toLowerCase();
  if (STATUS_LABELS[normalized]) return STATUS_LABELS[normalized];

  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
