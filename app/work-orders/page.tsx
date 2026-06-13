export const dynamic = "force-dynamic";

import Link from "next/link";
import { FileText, Plus, Search } from "lucide-react";
import { supabase } from "@/lib/supabase";


function money(value: any) {
  if (!value) return "-";
  return `₹ ${Number(value).toLocaleString("en-IN")}`;
}

function statusClass(value?: string | null) {
  const status = String(value || "").toLowerCase();

  if (status === "approved") {
    return "bg-green-50 text-green-700 border-green-200";
  }

  if (status === "pending") {
    return "bg-yellow-50 text-yellow-700 border-yellow-200";
  }

  if (status === "rejected") {
    return "bg-red-50 text-red-700 border-red-200";
  }

  return "bg-slate-50 text-slate-700 border-slate-200";
}

export default async function WorkOrdersPage() {
  const { data: workOrders, error } = await supabase
    .from("work_orders")
    .select(`
      id,
      wo_number,
      wo_date,
      wo_type,
      description,
      status,
      wo_value,
      approval_status,
      department,
      cost_code,
      created_at
    `)
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
        Failed to load work orders: {error.message}
      </div>
    );
  }

  const approvedCount =
    workOrders?.filter((wo) => wo.approval_status === "approved").length || 0;

  const pendingCount =
    workOrders?.filter((wo) => wo.approval_status !== "approved").length || 0;

  const totalValue =
    workOrders?.reduce((sum, wo) => sum + Number(wo.wo_value || 0), 0) || 0;

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
            <FileText className="h-3.5 w-3.5" />
            Contract Management
          </div>

          <h1 className="text-3xl font-bold text-slate-950">Work Orders</h1>
          <p className="text-sm text-slate-500">
            Manage work orders, linked vendors, values and approval status.
          </p>
        </div>

        <Link
          href="/work-orders/new"
          className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          <Plus className="h-4 w-4" />
          Add Work Order
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Total Work Orders</p>
          <p className="mt-2 text-2xl font-bold">{workOrders?.length || 0}</p>
        </div>

        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Approved</p>
          <p className="mt-2 text-2xl font-bold text-green-700">
            {approvedCount}
          </p>
        </div>

        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Total WO Value</p>
          <p className="mt-2 text-2xl font-bold">{money(totalValue)}</p>
        </div>
      </div>

      <div className="rounded-2xl border bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <div>
            <h2 className="font-semibold text-slate-950">Work Order Register</h2>
            <p className="text-xs text-slate-500">
              {pendingCount} pending / draft work orders need attention.
            </p>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              className="h-10 w-72 rounded-xl border bg-white pl-9 pr-3 text-sm outline-none focus:border-slate-400"
              placeholder="Search WO number, vendor, site..."
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="p-3 text-left">WO Number</th>
                <th className="p-3 text-left">Date</th>
                <th className="p-3 text-left">Type</th>
                <th className="p-3 text-left">Department</th>
                <th className="p-3 text-left">Cost Code</th>
                <th className="p-3 text-right">Value</th>
                <th className="p-3 text-left">Approval</th>
                <th className="p-3 text-right">Action</th>
              </tr>
            </thead>

            <tbody>
              {workOrders?.map((wo) => (
                <tr key={wo.id} className="border-t hover:bg-slate-50">
                  <td className="p-3">
                    <div className="font-semibold text-slate-950">
                      {wo.wo_number}
                    </div>
                    <div className="max-w-[360px] truncate text-xs text-slate-500">
                      {wo.description || "-"}
                    </div>
                  </td>

                  <td className="p-3">{wo.wo_date || "-"}</td>
                  <td className="p-3">{wo.wo_type || "-"}</td>
                  <td className="p-3">{wo.department || "-"}</td>
                  <td className="p-3">{wo.cost_code || "-"}</td>

                  <td className="p-3 text-right font-semibold">
                    {money(wo.wo_value)}
                  </td>

                  <td className="p-3">
                    <span
                      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusClass(
                        wo.approval_status
                      )}`}
                    >
                      {wo.approval_status || "Pending"}
                    </span>
                  </td>

                <td className="p-3 text-right">
  <Link
    href={`/work-orders/${wo.id}`}
    className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
  >
    View
  </Link>
</td>
                </tr>
              ))}

              {workOrders?.length === 0 && (
                <tr>
                  <td className="p-8 text-center text-slate-500" colSpan={8}>
                    No work orders found.
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