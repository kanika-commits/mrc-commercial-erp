export const dynamic = "force-dynamic";

import Link from "next/link";
import { Eye, FileText, Plus, Search, X } from "lucide-react";
import { supabase } from "@/lib/supabase";

function money(value: any) {
  return `₹ ${Number(value || 0).toLocaleString("en-IN")}`;
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

function statusClass(value?: string | null) {
  const status = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");

  if (status === "approved") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "pending") return "border-sky-200 bg-sky-50 text-sky-700";
  if (status === "rejected") return "border-red-200 bg-red-50 text-red-700";
  if (status === "sent_back") return "border-amber-200 bg-amber-50 text-amber-700";

  return "border-slate-200 bg-slate-50 text-slate-700";
}

export default async function RABillsPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string }>;
}) {
  const params = (await searchParams) || {};
  const query = String(params.q || "").trim();

  const { data: bills, error } = await supabase
    .from("ra_bills")
    .select(`
      id,
      work_order_id,
      vendor_id,
      ra_number,
      ra_date,
      gross_amount,
      recovery_amount,
      retention_amount,
      gst_amount,
      net_amount,
      status,
      approval_status,
      approved_by_name,
      approved_by_email,
      approved_at,
      created_at
    `)
    .ilike("approval_status", "approved")
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Failed to load RA Bills: {error.message}
      </div>
    );
  }

  const workOrderIds = Array.from(
    new Set((bills || []).map((b: any) => b.work_order_id).filter(Boolean))
  );

  const vendorIds = Array.from(
    new Set((bills || []).map((b: any) => b.vendor_id).filter(Boolean))
  );

  const { data: workOrders } = workOrderIds.length
    ? await supabase
        .from("work_orders")
        .select("id, wo_number, site_id, company_id")
        .in("id", workOrderIds)
    : { data: [] };

  const siteIds = Array.from(
    new Set((workOrders || []).map((wo: any) => wo.site_id).filter(Boolean))
  );

  const companyIds = Array.from(
    new Set((workOrders || []).map((wo: any) => wo.company_id).filter(Boolean))
  );

  const { data: vendors } = vendorIds.length
    ? await supabase.from("vendors").select("id, vendor_name").in("id", vendorIds)
    : { data: [] };

  const { data: sites } = siteIds.length
    ? await supabase.from("sites").select("id, site_name, site_code").in("id", siteIds)
    : { data: [] };

  const { data: companies } = companyIds.length
    ? await supabase
        .from("companies")
        .select("id, company_name, company_code")
        .in("id", companyIds)
    : { data: [] };

  const woMap = new Map((workOrders || []).map((wo: any) => [wo.id, wo]));
  const vendorMap = new Map((vendors || []).map((vendor: any) => [vendor.id, vendor]));
  const siteMap = new Map((sites || []).map((site: any) => [site.id, site]));
  const companyMap = new Map((companies || []).map((company: any) => [company.id, company]));

  const rows = (bills || []).map((bill: any) => {
    const wo: any = woMap.get(bill.work_order_id);
    const vendor: any = vendorMap.get(bill.vendor_id);
    const site: any = wo?.site_id ? siteMap.get(wo.site_id) : null;
    const company: any = wo?.company_id ? companyMap.get(wo.company_id) : null;

    return {
      bill,
      wo,
      vendor,
      site,
      company,
      searchText: [
        bill.ra_number,
        wo?.wo_number,
        vendor?.vendor_name,
        site?.site_name,
        site?.site_code,
        company?.company_name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase(),
    };
  });

  const filteredRows = rows.filter((row) => {
    const matchesSearch = query ? row.searchText.includes(query.toLowerCase()) : true;
    return matchesSearch;
  });

  const totalBills = bills?.length || 0;
  const totalGross =
    bills?.reduce((sum: number, bill: any) => sum + Number(bill.gross_amount || 0), 0) || 0;

  return (
    <section className="space-y-8">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <nav className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <span>Contract Management</span>
            <span>/</span>
            <span className="text-sky-800">RA Bills</span>
          </nav>
          <h1 className="text-3xl font-bold text-slate-950">Approved RA Bills</h1>
          <p className="mt-2 text-sm text-slate-600">
            Approved RA Bills available for invoicing and payment processing.
          </p>
        </div>

        <Link
          href="/ra-bills/new"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-slate-800"
        >
          <Plus className="h-4 w-4" />
          New RA Bill
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Summary title="Total Approved RA Bills" value={String(totalBills)} tone="emerald" />
        <Summary title="Approved RA Value" value={money(totalGross)} tone="cyan" />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-950">Approved RA Bill Register</h2>
              <p className="mt-1 text-sm text-slate-500">
                Track approved site-wise RA bills ready for commercial processing.
              </p>
            </div>

            <form className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
                  Search
                </span>
                <span className="relative block">
                  <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                  <input
                    name="q"
                    defaultValue={query}
                    className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-sky-700 focus:ring-2 focus:ring-sky-100 sm:w-80"
                    placeholder="Search RA no, WO, vendor, site"
                  />
                </span>
              </label>

              <button className="h-10 rounded-lg bg-sky-700 px-4 text-sm font-bold text-white hover:bg-sky-800">
                Apply
              </button>

              {query && (
                <Link
                  href="/ra-bills"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <X className="h-4 w-4" />
                  Clear
                </Link>
              )}
            </form>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1360px] border-collapse text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="border-b border-slate-200 px-5 py-3 text-left">RA No</th>
                <th className="border-b border-slate-200 px-5 py-3 text-left">Date</th>
                <th className="border-b border-slate-200 px-5 py-3 text-left">Site</th>
                <th className="border-b border-slate-200 px-5 py-3 text-left">Vendor</th>
                <th className="border-b border-slate-200 px-5 py-3 text-left">WO Number</th>
                <th className="border-b border-slate-200 px-5 py-3 text-right">Gross</th>
                <th className="border-b border-slate-200 px-5 py-3 text-right">GST</th>
                <th className="border-b border-slate-200 px-5 py-3 text-right">Net</th>
                <th className="border-b border-slate-200 px-5 py-3 text-left">Approval</th>
                <th className="border-b border-slate-200 px-5 py-3 text-left">Approved By</th>
                <th className="border-b border-slate-200 px-5 py-3 text-left">Approved At</th>
                <th className="border-b border-slate-200 px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {filteredRows.map(({ bill, wo, vendor, site, company }) => (
                <tr key={bill.id} className="hover:bg-slate-50">
                  <td className="px-5 py-4 font-bold text-sky-800">{bill.ra_number}</td>
                  <td className="px-5 py-4 text-slate-700">{bill.ra_date || "-"}</td>
                  <td className="px-5 py-4">
                    <div className="font-semibold text-slate-950">{site?.site_name || "-"}</div>
                    <div className="text-xs text-slate-500">{company?.company_name || "-"}</div>
                  </td>
                  <td className="px-5 py-4 text-slate-700">{vendor?.vendor_name || "-"}</td>
                  <td className="px-5 py-4">
                    {bill.work_order_id ? (
                      <Link href={`/work-orders/${bill.work_order_id}`} className="font-semibold text-sky-700 hover:underline">
                        {wo?.wo_number || "-"}
                      </Link>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-5 py-4 text-right font-semibold">{money(bill.gross_amount)}</td>
                  <td className="px-5 py-4 text-right">{money(bill.gst_amount)}</td>
                  <td className="px-5 py-4 text-right font-bold text-slate-950">{money(bill.net_amount)}</td>
                  <td className="px-5 py-4">
                    <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-bold uppercase ${statusClass(bill.approval_status)}`}>
                      {bill.approval_status || "Pending"}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-slate-700">
                    <div className="max-w-[180px] truncate font-medium">
                      {bill.approved_by_name || bill.approved_by_email || "-"}
                    </div>
                    {bill.approved_by_name && bill.approved_by_email && bill.approved_by_name !== bill.approved_by_email && (
                      <div className="max-w-[180px] truncate text-xs text-slate-500">
                        {bill.approved_by_email}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-4 text-slate-700">{formatDateTime(bill.approved_at)}</td>
                  <td className="px-5 py-4 text-right">
                    <Link
                      href={`/ra-bills/${bill.id}`}
                      className="inline-flex items-center justify-center rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-sky-700"
                      title="View RA Bill"
                    >
                      <Eye className="h-4 w-4" />
                    </Link>
                  </td>
                </tr>
              ))}

              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-5 py-16 text-center">
                    <FileText className="mx-auto h-10 w-10 text-slate-300" />
                    <h3 className="mt-3 text-lg font-bold text-slate-800">No RA Bills found</h3>
                    <p className="mt-1 text-sm text-slate-500">
                      Adjust your filters or create a new RA Bill.
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="border-t border-slate-200 bg-slate-50 px-5 py-3 text-xs font-medium text-slate-500">
          Showing {filteredRows.length} of {totalBills} RA bills
        </div>
      </div>
    </section>
  );
}

function Summary({
  title,
  value,
  tone,
}: {
  title: string;
  value: string;
  tone: "slate" | "sky" | "emerald" | "red" | "cyan";
}) {
  const toneClass = {
    slate: "border-t-slate-900",
    sky: "border-t-sky-600",
    emerald: "border-t-emerald-600",
    red: "border-t-red-600",
    cyan: "border-t-cyan-500",
  }[tone];

  return (
    <div className={`rounded-lg border border-slate-200 border-t-4 ${toneClass} bg-white p-5 shadow-sm`}>
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{title}</p>
      <p className="mt-3 text-xl font-bold text-slate-950">{value}</p>
    </div>
  );
}
