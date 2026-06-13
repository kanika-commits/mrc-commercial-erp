export const dynamic = "force-dynamic";

import Link from "next/link";
import { FileMinus, Plus, Search } from "lucide-react";
import { supabase } from "@/lib/supabase";

function money(value: any) {
  return `₹ ${Number(value || 0).toLocaleString("en-IN")}`;
}

function statusClass(value?: string | null) {
  const status = String(value || "").toLowerCase();

  if (status === "approved") return "border-green-200 bg-green-50 text-green-700";
  if (status === "pending") return "border-yellow-200 bg-yellow-50 text-yellow-700";
  if (status === "sent back") return "border-orange-200 bg-orange-50 text-orange-700";
  if (status === "rejected") return "border-red-200 bg-red-50 text-red-700";

  return "border-slate-200 bg-slate-50 text-slate-700";
}

export default async function DebitNotesPage() {
  const { data: notes, error } = await supabase
    .from("debit_notes")
    .select(`
      id,
      work_order_id,
      ra_bill_id,
      vendor_id,
      debit_note_number,
      debit_note_date,
      debit_note_type,
      reason,
      gross_amount,
      total_amount,
      status,
      approval_status,
      created_at
    `)
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Failed to load Debit Notes: {error.message}
      </div>
    );
  }

  const workOrderIds = Array.from(
    new Set((notes || []).map((n: any) => n.work_order_id).filter(Boolean))
  );

  const vendorIds = Array.from(
    new Set((notes || []).map((n: any) => n.vendor_id).filter(Boolean))
  );

  const { data: workOrders } = workOrderIds.length
    ? await supabase
        .from("work_orders")
        .select("id, wo_number, company_id, site_id")
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

  const totalNotes = notes?.length || 0;
  const pendingNotes =
    notes?.filter(
      (note: any) =>
        String(note.approval_status || "").toLowerCase() === "pending"
    ).length || 0;

  const approvedNotes =
    notes?.filter(
      (note: any) =>
        String(note.approval_status || "").toLowerCase() === "approved"
    ).length || 0;

  const sentBackNotes =
    notes?.filter(
      (note: any) =>
        String(note.approval_status || "").toLowerCase() === "sent back"
    ).length || 0;

  const totalDebitValue =
    notes?.reduce(
      (sum: number, note: any) =>
        sum + Number(note.total_amount || note.gross_amount || 0),
      0
    ) || 0;

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
            <FileMinus className="h-3.5 w-3.5" />
            Contract Management
          </div>

          <h1 className="text-3xl font-bold text-slate-950">Debit Notes</h1>
          <p className="text-sm text-slate-500">
            Track debit notes raised against work orders or RA bills.
          </p>
        </div>

        <Link
          href="/debit-notes/new"
          className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          <Plus className="h-4 w-4" />
          New Debit Note
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        <Summary title="Total Debit Notes" value={String(totalNotes)} />
        <Summary title="Pending Approval" value={String(pendingNotes)} />
        <Summary title="Approved" value={String(approvedNotes)} />
        <Summary title="Sent Back" value={String(sentBackNotes)} />
        <Summary title="Debit Value" value={money(totalDebitValue)} />
      </div>

      <div className="rounded-2xl border bg-white shadow-sm">
        <div className="border-b p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-slate-950">
                Debit Note Register
              </h2>
              <p className="text-xs text-slate-500">
                Site-wise debit notes, amounts and approval status.
              </p>
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                className="h-10 w-72 rounded-xl border bg-white pl-9 pr-3 text-sm outline-none focus:border-slate-400"
                placeholder="Search DN no, WO, vendor..."
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px] text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="p-3 text-left">DN No</th>
                <th className="p-3 text-left">Date</th>
                <th className="p-3 text-left">Site</th>
                <th className="p-3 text-left">Vendor</th>
                <th className="p-3 text-left">WO Number</th>
                <th className="p-3 text-left">Type</th>
                <th className="p-3 text-right">Amount</th>
                <th className="p-3 text-left">Approval</th>
                <th className="p-3 text-right">Action</th>
              </tr>
            </thead>

            <tbody>
              {notes?.map((note: any) => {
                const wo = woMap.get(note.work_order_id);
                const vendor = vendorMap.get(note.vendor_id);
                const site = wo?.site_id ? siteMap.get(wo.site_id) : null;
                const company = wo?.company_id ? companyMap.get(wo.company_id) : null;

                return (
                  <tr key={note.id} className="border-t hover:bg-slate-50">
                    <td className="p-3 font-semibold text-slate-950">
                      {note.debit_note_number}
                    </td>

                    <td className="p-3">{note.debit_note_date || "-"}</td>

                    <td className="p-3">
                      <div className="font-medium">{site?.site_name || "-"}</div>
                      <div className="text-xs text-slate-500">
                        {company?.company_name || "-"}
                      </div>
                    </td>

                    <td className="p-3">{vendor?.vendor_name || "-"}</td>

                    <td className="p-3">
                      {note.work_order_id ? (
                        <Link
                          href={`/work-orders/${note.work_order_id}`}
                          className="text-blue-600 hover:underline"
                        >
                          {wo?.wo_number || "-"}
                        </Link>
                      ) : (
                        "-"
                      )}
                    </td>

                    <td className="p-3">{note.debit_note_type || "-"}</td>

                    <td className="p-3 text-right font-semibold">
                      {money(note.total_amount || note.gross_amount)}
                    </td>

                    <td className="p-3">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusClass(
                          note.approval_status
                        )}`}
                      >
                        {note.approval_status || "Pending"}
                      </span>
                    </td>

                    <td className="p-3 text-right">
                      <Link
                        href={`/debit-notes/${note.id}`}
                        className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                );
              })}

              {notes?.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-slate-500">
                    No Debit Notes found.
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