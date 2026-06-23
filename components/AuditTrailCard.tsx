"use client";

type AuditTrailCardProps = {
  title?: string;
  createdBy?: string | null;
  createdAt?: string | null;
  updatedBy?: string | null;
  updatedAt?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  rejectedBy?: string | null;
  rejectedAt?: string | null;
  rejectReason?: string | null;
};

function clean(value: string | null | undefined) {
  const text = String(value || "").trim();
  return text || "-";
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";

  return parsed.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 break-words font-medium text-slate-950">{value}</p>
    </div>
  );
}

export default function AuditTrailCard({
  title = "Audit Trail / Record History",
  createdBy,
  createdAt,
  updatedBy,
  updatedAt,
  approvedBy,
  approvedAt,
  rejectedBy,
  rejectedAt,
  rejectReason,
}: AuditTrailCardProps) {
  return (
    <section className="rounded-2xl border bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-xl font-semibold text-slate-950">{title}</h2>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Created By" value={clean(createdBy)} />
        <Field label="Created At" value={formatDateTime(createdAt)} />
        <Field label="Last Updated By" value={clean(updatedBy)} />
        <Field label="Last Updated At" value={formatDateTime(updatedAt)} />
        <Field label="Approved By" value={clean(approvedBy)} />
        <Field label="Approved At" value={formatDateTime(approvedAt)} />
        <Field label="Rejected By" value={clean(rejectedBy)} />
        <Field label="Rejected At" value={formatDateTime(rejectedAt)} />
        <Field label="Reject Reason" value={clean(rejectReason)} />
      </div>
    </section>
  );
}
