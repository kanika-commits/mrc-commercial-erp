"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Building2, Pencil } from "lucide-react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAccessContext } from "@/components/AccessContext";
import { can } from "@/lib/accessControl";
import { isOrganizationAllowed } from "@/lib/clientOrganizationScope";

type Site = {
  id: string;
  organization_id: string;
  site_name: string;
  site_code: string;
  location: string | null;
  state: string | null;
  status: string | null;
  created_at: string | null;
};

type WorkOrder = {
  id: string;
  wo_number: string | null;
  company_id: string | null;
  wo_value: number | string | null;
  status: string | null;
  approval_status: string | null;
};

type Company = {
  id: string;
  company_name: string | null;
  company_code: string | null;
};

function valueOrDash(value: string | null | undefined) {
  return value?.trim() || "-";
}

function formatDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatCurrency(value: number | string | null) {
  const amount = typeof value === "string" ? Number(value) : value;
  if (!amount || Number.isNaN(amount)) return "₹0";

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function statusBadgeClass(status: string | null) {
  const normalized = (status || "").toLowerCase();

  if (normalized === "active" || normalized === "approved" || normalized === "completed") {
    return "border-green-200 bg-green-100 text-green-800";
  }

  if (normalized === "pending" || normalized === "under construction") {
    return "border-amber-200 bg-amber-100 text-amber-800";
  }

  if (normalized === "inactive" || normalized === "rejected") {
    return "border-red-200 bg-red-50 text-red-700";
  }

  return "border-slate-200 bg-slate-100 text-slate-700";
}

export default function SiteDetailPage() {
  const { access, loading: accessLoading } = useAccessContext();
  const params = useParams<{ id: string }>();
  const siteId = params.id;
  const [site, setSite] = useState<Site | null>(null);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [companyMap, setCompanyMap] = useState<Map<string, Company>>(new Map());
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const canEditSite = can(access?.permissions || [], "sites", "edit");

  useEffect(() => {
    async function loadSite() {
      setLoading(true);
      setMessage("");

      const { data: siteData, error: siteError } = await supabase
        .from("sites")
        .select("id, organization_id, site_name, site_code, location, state, status, created_at")
        .eq("id", siteId)
        .single();

      if (siteError) {
        setMessage(siteError.message);
        setLoading(false);
        return;
      }

      if (!isOrganizationAllowed(access, siteData.organization_id)) {
        setMessage("Site not found.");
        setLoading(false);
        return;
      }

      const { data: workOrderData, error: workOrderError } = await supabase
        .from("work_orders")
        .select("id, wo_number, company_id, wo_value, status, approval_status")
        .eq("site_id", siteId)
        .order("created_at", { ascending: false });

      if (workOrderError) {
        setMessage(workOrderError.message);
        setSite(siteData as Site);
        setLoading(false);
        return;
      }

      const orders = (workOrderData || []) as WorkOrder[];
      const companyIds = Array.from(new Set(orders.map((order) => order.company_id).filter(Boolean)));
      let companies = new Map<string, Company>();

      if (companyIds.length) {
        const { data: companyData, error: companyError } = await supabase
          .from("companies")
          .select("id, company_name, company_code")
          .in("id", companyIds);

        if (companyError) {
          setMessage(companyError.message);
        } else {
          companies = new Map(((companyData || []) as Company[]).map((company) => [company.id, company]));
        }
      }

      setSite(siteData as Site);
      setWorkOrders(orders);
      setCompanyMap(companies);
      setLoading(false);
    }

    if (siteId && !accessLoading && access) {
      loadSite();
    }
  }, [access, accessLoading, siteId]);

  const totalValue = useMemo(
    () =>
      workOrders.reduce((sum, order) => {
        const amount = typeof order.wo_value === "string" ? Number(order.wo_value) : order.wo_value || 0;
        return sum + (Number.isNaN(amount) ? 0 : amount);
      }, 0),
    [workOrders],
  );

  if (loading) {
    return <div className="rounded-xl border bg-white p-6 text-slate-500">Loading site...</div>;
  }

  if (!site) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">
        {message || "Site not found."}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <nav className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <Link href="/sites" className="hover:text-slate-950">
              Sites
            </Link>
            <span>/</span>
            <span className="text-[#00658b]">Detail</span>
          </nav>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950 md:text-4xl">
            {site.site_name}
          </h1>
          <p className="mt-2 text-sm text-slate-600">Independent project site master record.</p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/sites"
            className="inline-flex items-center gap-2 rounded border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Sites
          </Link>
          {canEditSite && (
            <Link
              href={`/sites/${site.id}/edit`}
              className="inline-flex items-center gap-2 rounded bg-[#00658b] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#005174]"
            >
              <Pencil className="h-4 w-4" />
              Edit Site
            </Link>
          )}
        </div>
      </div>

      {message && (
        <div className="rounded border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          {message}
        </div>
      )}

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-3">
          <div className="mb-5 flex items-center gap-2">
            <Building2 className="h-5 w-5 text-[#00658b]" />
            <h2 className="text-lg font-semibold text-slate-950">Site Information</h2>
          </div>
          <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Info label="Site Name" value={site.site_name} />
            <Info label="Site Code" value={site.site_code} />
            <Info label="Location" value={valueOrDash(site.location)} />
            <Info label="State" value={valueOrDash(site.state)} />
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Status</dt>
              <dd className="mt-1">
                <span
                  className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${statusBadgeClass(
                    site.status,
                  )}`}
                >
                  {site.status || "active"}
                </span>
              </dd>
            </div>
            <Info label="Created At" value={formatDate(site.created_at)} />
          </dl>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Linked Work Orders
          </p>
          <p className="mt-3 text-3xl font-bold text-slate-950">{workOrders.length}</p>
          <p className="mt-2 text-sm text-slate-500">Total value: {formatCurrency(totalValue)}</p>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-[#f8fafc] px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-950">Work Orders at This Site</h2>
        </div>

        {workOrders.length === 0 ? (
          <div className="p-8 text-sm text-slate-500">No work orders are linked to this site yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-[#f1f5f9]">
                <tr className="border-b border-slate-200">
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    WO Number
                  </th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Company
                  </th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    WO Value
                  </th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Status
                  </th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Approval
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {workOrders.map((order) => {
                  const company = order.company_id ? companyMap.get(order.company_id) : null;
                  return (
                    <tr key={order.id}>
                      <td className="px-5 py-4 font-semibold text-[#00658b]">
                        <Link href={`/work-orders/${order.id}`}>{order.wo_number || "-"}</Link>
                      </td>
                      <td className="px-5 py-4 text-slate-700">
                        {company?.company_name || company?.company_code || "-"}
                      </td>
                      <td className="px-5 py-4 font-semibold text-slate-950">
                        {formatCurrency(order.wo_value)}
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${statusBadgeClass(
                            order.status,
                          )}`}
                        >
                          {order.status || "-"}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${statusBadgeClass(
                            order.approval_status,
                          )}`}
                        >
                          {order.approval_status || "-"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-base font-semibold text-slate-950">{value}</dd>
    </div>
  );
}
