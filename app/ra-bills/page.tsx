export const dynamic = "force-dynamic";

import Link from "next/link";
import { FileText, Plus, Search } from "lucide-react";
import { supabase } from "@/lib/supabase";

function money(value: any) {
  return `₹ ${Number(value || 0).toLocaleString("en-IN")}`;
}

function statusClass(value?: string | null) {
  const status = String(value || "").toLowerCase();

  if (status === "approved") return "border-green-200 bg-green-50 text-green-700";
  if (status === "pending") return "border-yellow-200 bg-yellow-50 text-yellow-700";
  if (status === "rejected") return "border-red-200 bg-red-50 text-red-700";

  return "border-slate-200 bg-slate-50 text-slate-700";
}

export default async function RABillsPage() {
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
      net_amount,
      status,
      approval_status,
      created_at
    `)
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
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

  const totalBills = bills?.length || 0;
  const pendingBills =
    bills?.filter((bill: any) => String(bill.approval_status || "").toLowerCase() === "pending").length || 0;
  const approvedBills =
    bills?.filter((bill: any) => String(bill.approval_status || "").toLowerCase() === "approved").length || 0;
  const rejectedBills =
    bills?.filter((bill: any) => String(bill.approval_status || "").toLowerCase() === "rejected").length || 0;

  const totalGross =
    bills?.reduce((sum: number, bill: any) => sum + Number(bill.gross_amount || 0), 0) || 0;

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
            <FileText className="h-3.5 w-3.5" />
            Contract Management
          </div>

          <h1 className="text-3xl font-bold text-slate-950">RA Bills</h1>
          <p className="text-sm text-slate-500">
            Running Account Bills raised against approved work orders.
          </p>
        </div>

        <Link
          href="/ra-bills/new"
          className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          <Plus className="h-4 w-4" />
          New RA Bill
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        <Summary title="Total RA Bills" value={String(totalBills)} />
        <Summary title="Pending Approval" value={String(pendingBills)} />
        <Summary title="Approved" value={String(approvedBills)} />
        <Summary title="Rejected" value={String(rejectedBills)} />
        <Summary title="Gross RA Value" value={money(totalGross)} />
      </div>

      <div className="rounded-2xl border bg-white shadow-sm">
        <div className="border-b p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-slate-950">RA Bill Register</h2>
              <p className="text-xs text-slate-500">
                Track site-wise RA bills, approval status and billing value.
              </p>
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                className="h-10 w-72 rounded-xl border bg-white pl-9 pr-3 text-sm outline-none focus:border-slate-400"
                placeholder="Search RA no, WO, vendor..."
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1200px] text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="p-3 text-left">RA No</th>
                <th className="p-3 text-left">Date</th>
                <th className="p-3 text-left">Site</th>
                <th className="p-3 text-left">Vendor</th>
                <th className="p-3 text-left">WO Number</th>
                <th className="p-3 text-right">Gross</th>
                <th className="p-3 text-right">GST</th>
                <th className="p-3 text-right">Net</th>
                <th className="p-3 text-left">Approval</th>
                <th className="p-3 text-right">Action</th>
              </tr>
            </thead>

            <tbody>
              {bills?.map((bill: any) => {
                const wo = woMap.get(bill.work_order_id);
                const vendor = vendorMap.get(bill.vendor_id);
                const site = wo?.site_id ? siteMap.get(wo.site_id) : null;
                const company = wo?.company_id ? companyMap.get(wo.company_id) : null;

                return (
                  <tr key={bill.id} className="border-t hover:bg-slate-50">
                    <td className="p-3 font-semibold text-slate-950">
                      {bill.ra_number}
                    </td>

                    <td className="p-3">{bill.ra_date || "-"}</td>

                    <td className="p-3">
                      <div className="font-medium">{site?.site_name || "-"}</div>
                      <div className="text-xs text-slate-500">
                        {company?.company_name || "-"}
                      </div>
                    </td>

                    <td className="p-3">{vendor?.vendor_name || "-"}</td>

                    <td className="p-3">
                      {bill.work_order_id ? (
                        <Link
                          href={`/work-orders/${bill.work_order_id}`}
                          className="text-blue-600 hover:underline"
                        >
                          {wo?.wo_number || "-"}
                        </Link>
                      ) : (
                        "-"
                      )}
                    </td>

                    <td className="p-3 text-right font-semibold">
                      {money(bill.gross_amount)}
                    </td>

                    <td className="p-3 text-right">
                      {money(bill.retention_amount)}
                    </td>

                    <td className="p-3 text-right font-semibold">
                      {money(bill.net_amount)}
                    </td>

                    <td className="p-3">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusClass(
                          bill.approval_status
                        )}`}
                      >
                        {bill.approval_status || "Pending"}
                      </span>
                    </td>

                    <td className="p-3 text-right">
                      <Link
                        href={`/ra-bills/${bill.id}`}
                        className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                );
              })}

              {bills?.length === 0 && (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-slate-500">
                    No RA Bills found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Summary({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {title}
      </p>
      <p className="mt-2 text-xl font-bold text-slate-950">{value}</p>
    </div>
  );
}