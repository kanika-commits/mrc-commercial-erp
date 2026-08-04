"use client";

import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Building2,
  CheckCircle2,
  CreditCard,
  FileCheck2,
  FileText,
  Landmark,
  ReceiptText,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useMemo } from "react";
import { useAccessContext } from "@/components/AccessContext";
import { can, hasGlobalAccess } from "@/lib/accessControl";
import { DEFAULT_MODULE_NAVIGATION } from "@/lib/defaultModuleNavigation";

type ModuleRow = {
  id: string;
  module_group: string;
  module_code: string;
  module_name: string;
  route: string;
  sort_order: number;
};

type ModulePageProps = {
  groupCode: string;
  title: string;
  description: string;
};

const pageMeta: Record<
  string,
  {
    icon: any;
    className: string;
    description: string;
  }
> = {
  organizations: {
    icon: Landmark,
    className: "from-blue-50 to-white border-blue-100 text-blue-700",
    description: "Manage organization-level setup.",
  },
  users: {
    icon: Users,
    className: "from-indigo-50 to-white border-indigo-100 text-indigo-700",
    description: "Manage ERP users and access.",
  },
  roles: {
    icon: ShieldCheck,
    className: "from-purple-50 to-white border-purple-100 text-purple-700",
    description: "Manage designation templates.",
  },
  permissions: {
    icon: Settings,
    className: "from-slate-50 to-white border-slate-200 text-slate-700",
    description: "Configure access permissions.",
  },
  companies: {
    icon: Building2,
    className: "from-emerald-50 to-white border-emerald-100 text-emerald-700",
    description: "Manage company master data.",
  },
  sites: {
    icon: Landmark,
    className: "from-teal-50 to-white border-teal-100 text-teal-700",
    description: "Manage project sites.",
  },
  vendors: {
    icon: Users,
    className: "from-cyan-50 to-white border-cyan-100 text-cyan-700",
    description: "Manage contractors and suppliers.",
  },
  work_orders: {
    icon: FileText,
    className: "from-amber-50 to-white border-amber-100 text-amber-700",
    description: "Create and manage work orders.",
  },
  wo_approval: {
    icon: CheckCircle2,
    className: "from-green-50 to-white border-green-100 text-green-700",
    description: "Review and approve work orders.",
  },
  ra_bills: {
    icon: ReceiptText,
    className: "from-orange-50 to-white border-orange-100 text-orange-700",
    description: "Create and track RA bills.",
  },
  ra_approval: {
    icon: FileCheck2,
    className: "from-lime-50 to-white border-lime-100 text-lime-700",
    description: "Approve submitted RA bills.",
  },
  invoices: {
    icon: FileText,
    className: "from-rose-50 to-white border-rose-100 text-rose-700",
    description: "Upload and manage invoices.",
  },
  itc_claims: {
    icon: FileCheck2,
    className: "from-yellow-50 to-white border-yellow-100 text-yellow-700",
    description: "Review ITC claim status.",
  },
  payments: {
    icon: CreditCard,
    className: "from-blue-50 to-white border-blue-100 text-blue-700",
    description: "Record and track payments.",
  },
  debit_notes: {
    icon: ReceiptText,
    className: "from-red-50 to-white border-red-100 text-red-700",
    description: "Create and manage debit notes.",
  },
  reports: {
    icon: BarChart3,
    className: "from-violet-50 to-white border-violet-100 text-violet-700",
    description: "View reports and exports.",
  },
  hr_departments: {
    icon: Building2,
    className: "from-sky-50 to-white border-sky-100 text-sky-700",
    description: "Maintain department master records.",
  },
  hr_designations: {
    icon: Users,
    className: "from-indigo-50 to-white border-indigo-100 text-indigo-700",
    description: "Maintain designation master records.",
  },
  labour_workers: {
    icon: Users,
    className: "from-amber-50 to-white border-amber-100 text-amber-700",
    description: "Register labourers for site muster.",
  },
  labour_attendance: {
    icon: CheckCircle2,
    className: "from-green-50 to-white border-green-100 text-green-700",
    description: "Mark labour attendance.",
  },
  labour_trades: {
    icon: Users,
    className: "from-cyan-50 to-white border-cyan-100 text-cyan-700",
    description: "Maintain labour category masters.",
  },
  labour_attendance_policy: {
    icon: Settings,
    className: "from-slate-50 to-white border-slate-200 text-slate-700",
    description: "Configure Labour Attendance lock, overtime, entry and photo rules.",
  },
  labour_muster_configuration: {
    icon: Settings,
    className: "from-slate-50 to-white border-slate-200 text-slate-700",
    description: "Configure Labour Attendance workflow, lock rules and approval authorities.",
  },
  settings_password: {
    icon: Settings,
    className: "from-slate-50 to-white border-slate-200 text-slate-700",
    description: "Change account password.",
  },
};

export default function ModulePage({
  groupCode,
  title,
  description,
}: ModulePageProps) {
  const { access, moduleNavigation, loading } = useAccessContext();
  const pages = useMemo(() => {
    const permissions = access?.permissions || [];
    const globalAccess = hasGlobalAccess(access);
    const effectiveNavigation =
      globalAccess && (moduleNavigation.modules || []).length === 0
        ? DEFAULT_MODULE_NAVIGATION
        : moduleNavigation;

    const moduleRows = ((effectiveNavigation.modules || []) as ModuleRow[])
      .filter((module: ModuleRow) => module.module_group === groupCode)
      .filter(
        (page: ModuleRow) =>
          globalAccess || can(permissions, page.module_code, "view"),
      )
      .sort((first, second) => first.sort_order - second.sort_order);

    if (groupCode !== "settings" || (!globalAccess && !can(permissions, "hr_employee_attendance_policy", "view"))) {
      return moduleRows;
    }

    const hasEmployeeAttendancePolicy = moduleRows.some(
      (page) => page.route === "/settings/policies/employee-attendance",
    );
    if (hasEmployeeAttendancePolicy) return moduleRows;

    return [
      ...moduleRows,
      {
        id: "settings-employee-attendance-policy",
        module_group: "settings",
        module_code: "hr_employee_attendance_policy",
        module_name: "Employee Attendance Policy",
        route: "/settings/policies/employee-attendance",
        sort_order: 8,
      },
    ].sort((first, second) => first.sort_order - second.sort_order);
  }, [access, groupCode, moduleNavigation]);

  if (loading) {
    return <p className="text-sm text-gray-500">Loading module...</p>;
  }

  return (
    <section className="space-y-5">
      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Module
        </p>
        <h1 className="text-2xl font-bold text-slate-950">{title}</h1>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>

      {pages.length === 0 ? (
        <div className="rounded-2xl border bg-white p-6 text-sm text-slate-500 shadow-sm">
          No accessible pages found in this module.
        </div>
      ) : groupCode === "settings" ? (
        <SettingsSections pages={pages} />
      ) : (
        <CompactPageGrid pages={pages} />
      )}
    </section>
  );
}

function CompactPageGrid({ pages }: { pages: ModuleRow[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {pages.map((page) => (
        <ModulePageCard key={page.id} page={page} />
      ))}
    </div>
  );
}

function SettingsSections({ pages }: { pages: ModuleRow[] }) {
  const sections = [
    {
      title: "Masters",
      codes: ["companies", "vendors", "sites", "hr_departments", "hr_designations", "labour_trades", "company_bank_accounts"],
    },
    {
      title: "Policies",
      codes: ["hr_employee_attendance_policy", "labour_muster_configuration"],
    },
    {
      title: "Change Password",
      codes: ["settings_password"],
    },
  ];

  return (
    <div className="space-y-5">
      {sections.map((section) => {
        const sectionPages = pages.filter((page) => section.codes.includes(page.module_code));
        if (sectionPages.length === 0) return null;

        return (
          <section key={section.title} className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              {section.title}
            </h2>
            <CompactPageGrid pages={sectionPages} />
          </section>
        );
      })}
    </div>
  );
}

function ModulePageCard({ page }: { page: ModuleRow }) {
  const metaKey =
    page.route === "/hr/departments"
      ? "hr_departments"
      : page.route === "/hr/designations"
        ? "hr_designations"
        : page.module_code;
  const meta = pageMeta[metaKey] ?? {
    icon: FileText,
    className: "from-slate-50 to-white border-slate-200 text-slate-700",
    description: "Open module page.",
  };

  const Icon = meta.icon;

  return (
    <Link key={page.id} href={page.route}>
      <div
        className={`group rounded-xl border bg-gradient-to-br p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${meta.className}`}
      >
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-white/80 p-2 shadow-sm">
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-sm font-bold leading-5 text-slate-950">
                {page.module_name}
              </h2>
              <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 opacity-40 transition group-hover:translate-x-1 group-hover:opacity-100" />
            </div>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
              {meta.description}
            </p>
          </div>
        </div>
      </div>
    </Link>
  );
}
