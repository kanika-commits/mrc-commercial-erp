const legacyTitle = "Finalized attendance — historical snapshot unavailable";

export function MonthlyLegacyAttendanceNotice({ dates }: { dates: string[] }) {
  if (!dates.length) return null;
  return <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{legacyTitle} for {dates.join(", ")}.</div>;
}

export function MonthlyLegacyAttendanceLegend() {
  return <span><b className="text-amber-700">L</b> = {legacyTitle}</span>;
}

export function monthlyLegacyDayLabel(day: string, month: string, dates: string[]) {
  const date = `${month}-${day.padStart(2, "0")}`;
  const legacy = dates.includes(date);
  return { label: day.padStart(2, "0"), legacy, title: legacy ? legacyTitle : undefined };
}
