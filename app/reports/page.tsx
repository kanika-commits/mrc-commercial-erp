"use client";

import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  BriefcaseBusiness,
  LayoutDashboard,
  Library,
  Save,
  SlidersHorizontal,
} from "lucide-react";
import { useMemo } from "react";
import { useAccessContext } from "@/components/AccessContext";
import { can, hasGlobalAccess } from "@/lib/accessControl";
import {
  REPORT_CATEGORIES,
  REPORT_DATASETS,
  STANDARD_REPORT_TEMPLATES,
  type ReportCategory,
} from "@/lib/reports/reportCatalog";

const categoryOrder: ReportCategory[] = ["commercial", "hr", "labour"];

export default function ReportsLandingPage() {
  const { access, loading } = useAccessContext();

  const visibleDatasets = useMemo(() => {
    const permissions = access?.permissions || [];
    const globalAccess = hasGlobalAccess(access);
    const canViewReports = globalAccess || can(permissions, "reports", "view");
    if (!canViewReports) return [];

    return REPORT_DATASETS.filter(
      (dataset) =>
        globalAccess ||
        can(permissions, dataset.sourceModule, dataset.requiredAction),
    );
  }, [access]);

  const visibleDatasetCodes = new Set(visibleDatasets.map((dataset) => dataset.code));
  const visibleTemplates = STANDARD_REPORT_TEMPLATES.filter((template) =>
    visibleDatasetCodes.has(template.datasetCode),
  );

  if (loading) {
    return <p className="text-sm text-slate-500">Loading reports...</p>;
  }

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Reports
        </p>
        <h1 className="text-2xl font-bold text-slate-950">Reports</h1>
        <p className="mt-1 text-sm text-slate-500">
          Create, analyse and visualize ERP reports from existing ConstructIQ data.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Link
          href="/reports/builder"
          className="group rounded-2xl border border-slate-200 bg-slate-950 p-6 text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10">
            <SlidersHorizontal className="h-6 w-6" aria-hidden="true" />
          </span>
          <div className="mt-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">
              Primary
            </p>
            <h2 className="mt-1 text-2xl font-bold">Create Custom Report</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
              Choose a dataset, fields, filters, grouping, measures and visualization before previewing the report.
            </p>
          </div>
          <span className="mt-6 inline-flex items-center gap-2 text-sm font-semibold">
            Open Builder
            <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden="true" />
          </span>
        </Link>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
          <ComingLaterCard
            icon={Save}
            title="Saved Reports"
            description="User-saved report definitions will be added after report execution is approved."
          />
          <ComingLaterCard
            icon={LayoutDashboard}
            title="Dashboards"
            description="Custom dashboard layouts and KPI cards are planned for a later phase."
          />
        </div>
      </div>

      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Standard Reports</h2>
            <p className="text-sm text-slate-500">
              Predefined templates will open through the same report-builder model.
            </p>
          </div>
          <button
            type="button"
            disabled
            className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-400"
          >
            Browse Standard Reports
          </button>
        </div>
        {visibleTemplates.length > 0 ? (
          <div className="mt-4 divide-y rounded-xl border">
            {visibleTemplates.map((template) => (
              <div key={template.code} className="flex items-start gap-3 p-3">
                <Library className="mt-0.5 h-4 w-4 text-slate-400" aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold text-slate-900">{template.title}</p>
                  <p className="text-sm text-slate-500">{template.description}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-4 rounded-xl border border-dashed p-4 text-sm text-slate-500">
            No standard report templates are available for your current permissions.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Available Data Sources</h2>
          <p className="text-sm text-slate-500">
            Dataset categories only. Report variations should be created through filters and grouping.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {categoryOrder.map((category) => {
            const datasets = visibleDatasets.filter((dataset) => dataset.category === category);
            const meta = REPORT_CATEGORIES[category];
            return (
              <article key={category} className="rounded-2xl border bg-white p-5 shadow-sm">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                    {category === "commercial" ? (
                      <BriefcaseBusiness className="h-5 w-5" aria-hidden="true" />
                    ) : category === "hr" ? (
                      <BarChart3 className="h-5 w-5" aria-hidden="true" />
                    ) : (
                      <SlidersHorizontal className="h-5 w-5" aria-hidden="true" />
                    )}
                  </span>
                  <div>
                    <h3 className="text-base font-semibold text-slate-950">{meta.title}</h3>
                    <p className="mt-1 text-sm text-slate-500">{meta.description}</p>
                  </div>
                </div>
                <p className="mt-4 text-sm font-medium text-slate-700">
                  {datasets.length} accessible dataset{datasets.length === 1 ? "" : "s"}
                </p>
              </article>
            );
          })}
        </div>
      </section>
    </section>
  );
}

function ComingLaterCard({
  icon: Icon,
  title,
  description,
}: {
  icon: any;
  title: string;
  description: string;
}) {
  return (
    <article className="rounded-2xl border bg-white p-5 shadow-sm">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <h2 className="mt-4 text-base font-semibold text-slate-950">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
      <span className="mt-4 inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">
        Coming later
      </span>
    </article>
  );
}
