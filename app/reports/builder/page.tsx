"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3, PieChart, RotateCcw, SlidersHorizontal, Table2 } from "lucide-react";
import { useAccessContext } from "@/components/AccessContext";
import { can, hasGlobalAccess } from "@/lib/accessControl";
import { supabase } from "@/lib/supabase";
import { REPORT_DATASETS } from "@/lib/reports/reportCatalog";
import {
  WORK_ORDER_DATASET_CODE,
  WORK_ORDER_FIELDS,
  WORK_ORDER_FILTERS,
  WORK_ORDER_GROUPS,
  WORK_ORDER_MEASURES,
  WORK_ORDER_VISUALIZATIONS,
  type ReportVisualization,
} from "@/lib/reports/workOrderDataset";

type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: any };

type MetadataState =
  | { status: "idle" | "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: any };

const defaultFields = ["wo_number", "wo_date", "company", "site", "vendor", "wo_type", "status", "basic_value"];

function money(value: unknown) {
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 0,
    style: "currency",
    currency: "INR",
  }).format(Number(value || 0));
}

function isMoneyColumn(code: string) {
  return WORK_ORDER_FIELDS.find((field) => field.code === code)?.type === "money";
}

export default function ReportBuilderPage() {
  const { access, loading } = useAccessContext();
  const [dataset, setDataset] = useState(WORK_ORDER_DATASET_CODE);
  const [fields, setFields] = useState<string[]>(defaultFields);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [groupBy, setGroupBy] = useState("");
  const [measure, setMeasure] = useState("record_count");
  const [visualization, setVisualization] = useState<ReportVisualization>("table");
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
  const [metadata, setMetadata] = useState<MetadataState>({ status: "idle" });

  const permissions = access?.permissions || [];
  const globalAccess = hasGlobalAccess(access);
  const visibleDatasets = useMemo(() => {
    const canViewReports = globalAccess || can(permissions, "reports", "view");
    if (!canViewReports) return [];
    return REPORT_DATASETS.filter(
      (item) => globalAccess || can(permissions, item.sourceModule, item.requiredAction),
    );
  }, [globalAccess, permissions]);
  const canUseWorkOrders = visibleDatasets.some((item) => item.code === WORK_ORDER_DATASET_CODE);
  const compatibleVisualizations = WORK_ORDER_VISUALIZATIONS.filter((item) => {
    if (item.code === "table") return fields.length > 0;
    if (item.code === "kpi") return !groupBy;
    return Boolean(groupBy);
  });
  const canRun =
    dataset === WORK_ORDER_DATASET_CODE &&
    canUseWorkOrders &&
    compatibleVisualizations.some((item) => item.code === visualization) &&
    (visualization !== "table" || fields.length > 0) &&
    (visualization === "table" || visualization === "kpi" || Boolean(groupBy));

  useEffect(() => {
    let cancelled = false;
    async function loadMetadata() {
      if (!canUseWorkOrders) {
        setMetadata({ status: "idle" });
        return;
      }
      setMetadata({ status: "loading" });
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        setMetadata({ status: "error", message: "You must be signed in to load report options." });
        return;
      }
      const response = await fetch(`/api/reports/run?dataset=${WORK_ORDER_DATASET_CODE}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json().catch(() => ({}));
      if (cancelled) return;
      if (!response.ok) {
        setMetadata({ status: "error", message: body.error || "Failed to load report options." });
        return;
      }
      setMetadata({ status: "ready", data: body.metadata });
    }
    loadMetadata();
    return () => {
      cancelled = true;
    };
  }, [canUseWorkOrders]);

  function reset() {
    setDataset(WORK_ORDER_DATASET_CODE);
    setFields(defaultFields);
    setFilters({});
    setGroupBy("");
    setMeasure("record_count");
    setVisualization("table");
    setPreview({ status: "idle" });
  }

  function updateFilter(code: string, value: string) {
    setFilters((current) => ({ ...current, [code]: value }));
  }

  function toggleField(code: string) {
    setFields((current) =>
      current.includes(code)
        ? current.filter((field) => field !== code)
        : [...current, code],
    );
  }

  async function runReport() {
    setPreview({ status: "loading" });
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setPreview({ status: "error", message: "You must be signed in to run reports." });
      return;
    }

    const payloadFilters = Object.fromEntries(
      Object.entries(filters).filter(([, value]) => String(value || "").trim()),
    );
    const response = await fetch("/api/reports/run", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dataset,
        fields,
        filters: payloadFilters,
        groupBy: groupBy || null,
        measure,
        visualization,
        page: 1,
        pageSize: 25,
        sort: { field: "wo_number", direction: "asc" },
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setPreview({ status: "error", message: body.error || "Failed to run report." });
      return;
    }
    setPreview({ status: "ready", data: body });
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Loading report builder...</p>;
  }

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Reports
        </p>
        <h1 className="text-2xl font-bold text-slate-950">Custom Report Builder</h1>
        <p className="mt-1 text-sm text-slate-500">
          First proof of concept: live Work Order reports using existing ERP data and permissions.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
        <aside className="space-y-4">
          <Panel title="Dataset">
            <select
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
              value={dataset}
              onChange={(event) => setDataset(event.target.value)}
            >
              {visibleDatasets.map((item) => (
                <option key={item.code} value={item.code} disabled={item.code !== WORK_ORDER_DATASET_CODE}>
                  {item.title}{item.code !== WORK_ORDER_DATASET_CODE ? " (Coming later)" : ""}
                </option>
              ))}
            </select>
            {!canUseWorkOrders ? (
              <p className="mt-2 text-sm text-amber-700">
                Work Order reporting requires Reports and Work Orders view access.
              </p>
            ) : null}
          </Panel>

          <Panel title="Visualization">
            <div className="grid gap-2">
              {WORK_ORDER_VISUALIZATIONS.map((item) => {
                const disabled = !compatibleVisualizations.some((option) => option.code === item.code);
                return (
                  <label key={item.code} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${disabled ? "bg-slate-50 text-slate-400" : "bg-white text-slate-800"}`}>
                    <input
                      type="radio"
                      name="visualization"
                      value={item.code}
                      checked={visualization === item.code}
                      disabled={disabled}
                      onChange={() => setVisualization(item.code)}
                    />
                    {item.label}
                  </label>
                );
              })}
            </div>
          </Panel>

          <Panel title="Measures">
            <select
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
              value={measure}
              onChange={(event) => setMeasure(event.target.value)}
            >
              {WORK_ORDER_MEASURES.map((item) => (
                <option key={item.code} value={item.code}>{item.label}</option>
              ))}
            </select>
          </Panel>
        </aside>

        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Fields">
              <div className="grid gap-2 sm:grid-cols-2">
                {WORK_ORDER_FIELDS.map((field) => (
                  <label key={field.code} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={fields.includes(field.code)}
                      onChange={() => toggleField(field.code)}
                    />
                    {field.label}
                  </label>
                ))}
              </div>
            </Panel>

            <Panel title="Grouping">
              <select
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                value={groupBy}
                onChange={(event) => setGroupBy(event.target.value)}
              >
                <option value="">No grouping</option>
                {WORK_ORDER_GROUPS.map((item) => (
                  <option key={item.code} value={item.code}>{item.label}</option>
                ))}
              </select>
              <p className="mt-2 text-sm text-slate-500">One grouping is supported in this proof of concept.</p>
            </Panel>
          </div>

          <Panel title="Filters">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {WORK_ORDER_FILTERS.map((filter) => (
                <label key={filter.code} className="text-sm font-medium text-slate-700">
                  {filter.label}
                  {filter.type === "date" ? (
                    <input
                      type="date"
                      value={filters[filter.code] || ""}
                      onChange={(event) => updateFilter(filter.code, event.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                    />
                  ) : (
                    <select
                      value={filters[filter.code] || ""}
                      onChange={(event) => updateFilter(filter.code, event.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                    >
                      <option value="">All</option>
                      {filterOptions(metadata, filter.code).map((option: any) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  )}
                </label>
              ))}
            </div>
            {metadata.status === "loading" ? <p className="mt-3 text-sm text-slate-500">Loading filter options...</p> : null}
            {metadata.status === "error" ? <p className="mt-3 text-sm text-red-600">{metadata.message}</p> : null}
          </Panel>

          <section className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-950">Preview</h2>
                <p className="text-sm text-slate-500">
                  Filters and aggregation are applied server-side.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!canRun || preview.status === "loading"}
                  onClick={runReport}
                  className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                  Run Report
                </button>
                <button
                  type="button"
                  onClick={reset}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  Reset
                </button>
              </div>
            </div>
            <AppliedFilters filters={filters} groupBy={groupBy} measure={measure} visualization={visualization} />
            <Preview preview={preview} visualization={visualization} />
          </section>
        </div>
      </div>
    </section>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-base font-semibold text-slate-950">{title}</h2>
      {children}
    </section>
  );
}

function filterOptions(metadata: MetadataState, code: string) {
  if (metadata.status !== "ready") return [];
  return metadata.data?.filter_options?.[code] || [];
}

function AppliedFilters({ filters, groupBy, measure, visualization }: { filters: Record<string, string>; groupBy: string; measure: string; visualization: string }) {
  const activeFilters = Object.entries(filters).filter(([, value]) => String(value || "").trim());
  return (
    <div className="mt-4 flex flex-wrap gap-2 text-xs">
      <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-600">Visualization: {visualization}</span>
      <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-600">Measure: {measure}</span>
      {groupBy ? <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-600">Group: {groupBy}</span> : null}
      {activeFilters.length ? activeFilters.map(([key, value]) => (
        <span key={key} className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-600">{key}: {value}</span>
      )) : <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-600">No filters</span>}
    </div>
  );
}

function Preview({ preview, visualization }: { preview: PreviewState; visualization: ReportVisualization }) {
  if (preview.status === "idle") {
    return <div className="mt-5 rounded-xl border border-dashed bg-slate-50 p-8 text-center text-sm text-slate-500">Configure and run a Work Order report to preview results.</div>;
  }
  if (preview.status === "loading") {
    return <div className="mt-5 rounded-xl border bg-slate-50 p-8 text-center text-sm text-slate-500">Running report...</div>;
  }
  if (preview.status === "error") {
    return <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">{preview.message}</div>;
  }

  const result = preview.data.result;
  if (visualization === "table") return <TablePreview result={result} />;
  if (visualization === "kpi") return <KpiPreview result={result} />;
  if (visualization === "pie") return <PiePreview result={result} />;
  return <BarPreview result={result} />;
}

function TablePreview({ result }: { result: any }) {
  if (!result.rows?.length) return <EmptyPreview total={result.total} />;
  return (
    <div className="mt-5 overflow-x-auto rounded-xl border">
      <div className="border-b bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700">
        Total matching records: {result.total}
      </div>
      <table className="min-w-full divide-y text-sm">
        <thead className="bg-slate-50">
          <tr>
            {result.columns.map((column: any) => (
              <th key={column.code} className="px-3 py-2 text-left font-semibold text-slate-600">{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y bg-white">
          {result.rows.map((row: any, index: number) => (
            <tr key={index}>
              {result.columns.map((column: any) => (
                <td key={column.code} className="px-3 py-2 text-slate-700">
                  {isMoneyColumn(column.code) ? money(row[column.code]) : String(row[column.code] ?? "-")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KpiPreview({ result }: { result: any }) {
  const row = result.rows?.[0];
  if (!row) return <EmptyPreview total={result.total} />;
  return (
    <div className="mt-5 rounded-xl border bg-slate-50 p-6">
      <p className="text-sm font-semibold text-slate-500">{row.label}</p>
      <p className="mt-2 text-3xl font-bold text-slate-950">{row.label.includes("Value") || row.label.includes("Amount") ? money(row.value) : row.value}</p>
      <p className="mt-1 text-sm text-slate-500">Total matching records: {result.total}</p>
    </div>
  );
}

function PiePreview({ result }: { result: any }) {
  if (!result.rows?.length) return <EmptyPreview total={result.total} />;
  const total = result.rows.reduce((sum: number, row: any) => sum + Number(row.value || 0), 0);
  return (
    <div className="mt-5 grid gap-4 lg:grid-cols-[220px_1fr]">
      <div
        className="h-52 w-52 rounded-full border"
        style={{ background: pieGradient(result.rows, total) }}
        aria-label="Pie chart preview"
      />
      <ChartRows rows={result.rows} total={total} />
    </div>
  );
}

function BarPreview({ result }: { result: any }) {
  if (!result.rows?.length) return <EmptyPreview total={result.total} />;
  const max = Math.max(...result.rows.map((row: any) => Number(row.value || 0)), 1);
  return (
    <div className="mt-5 space-y-3 rounded-xl border p-4">
      {result.rows.map((row: any) => (
        <div key={row.label} className="grid gap-2 sm:grid-cols-[180px_1fr_120px] sm:items-center">
          <p className="truncate text-sm font-medium text-slate-700">{row.label}</p>
          <div className="h-3 rounded-full bg-slate-100">
            <div className="h-3 rounded-full bg-slate-950" style={{ width: `${Math.max(4, (Number(row.value || 0) / max) * 100)}%` }} />
          </div>
          <p className="text-sm text-slate-600">{row.value}</p>
        </div>
      ))}
    </div>
  );
}

function ChartRows({ rows, total }: { rows: any[]; total: number }) {
  return (
    <div className="rounded-xl border bg-white">
      {rows.map((row, index) => (
        <div key={row.label} className="flex items-center justify-between gap-4 border-b px-3 py-2 text-sm last:border-b-0">
          <span className="flex min-w-0 items-center gap-2">
            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: chartColor(index) }} />
            <span className="truncate font-medium text-slate-700">{row.label}</span>
          </span>
          <span className="text-slate-500">{total ? Math.round((Number(row.value || 0) / total) * 100) : 0}%</span>
        </div>
      ))}
    </div>
  );
}

function EmptyPreview({ total }: { total: number }) {
  return <div className="mt-5 rounded-xl border border-dashed bg-slate-50 p-8 text-center text-sm text-slate-500">No records matched this report. Total matching records: {total || 0}</div>;
}

function chartColor(index: number) {
  return ["#0f172a", "#2563eb", "#16a34a", "#f97316", "#9333ea", "#dc2626", "#0891b2", "#4f46e5", "#65a30d", "#be123c", "#a16207", "#475569"][index % 12];
}

function pieGradient(rows: any[], total: number) {
  if (!total) return "#e2e8f0";
  let current = 0;
  const slices = rows.map((row: any, index: number) => {
    const start = current;
    current += (Number(row.value || 0) / total) * 100;
    return `${chartColor(index)} ${start}% ${current}%`;
  });
  return `conic-gradient(${slices.join(", ")})`;
}
