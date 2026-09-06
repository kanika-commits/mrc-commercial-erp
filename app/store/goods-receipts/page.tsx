"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Eye, RefreshCw } from "lucide-react";
import AlertMessage from "@/components/AlertMessage";
import { apiFetch } from "@/components/hr/hrClient";

function money(value: unknown) { return `Rs ${Number(value || 0).toLocaleString("en-IN")}`; }
function qty(value: unknown) { return Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 3 }); }
function label(value: string) { return value === "fully_received" ? "Fully Received" : value === "partially_received" ? "Partially Received" : value === "receipt_in_progress" ? "Receipt In Progress" : "Not Received"; }
function badge(status: string) { return status === "fully_received" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : status === "partially_received" ? "border-amber-200 bg-amber-50 text-amber-800" : status === "receipt_in_progress" ? "border-sky-200 bg-sky-50 text-sky-800" : "border-slate-200 bg-slate-50 text-slate-700"; }
function poStatus(status: unknown) { return String(status || "").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
type SelectOption = [string, string];

export default function GoodsReceiptsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  const [filters, setFilters] = useState({ search: "", company: "all", site: "all", vendor: "all", poStatus: "all", receiptStatus: "all", from: "", to: "" });
  const load = async () => { try { const result = await apiFetch("/api/procurement/goods-receipts"); setRows(result.receipt_register || []); } catch (error: any) { setMessage(error.message || "Failed to load Purchase Order Tracking."); } };
  useEffect(() => { void load(); }, []);
  const options = useMemo(() => {
    const companies = new Map<string, string>();
    const sites = new Map<string, string>();
    const vendors = new Set<string>();
    rows.forEach((row) => {
      if (row.company_id && row.company?.company_name) companies.set(String(row.company_id), String(row.company.company_name));
      if (row.site_id && row.site?.site_name) sites.set(String(row.site_id), String(row.site.site_name));
      if (row.vendor_name_snapshot) vendors.add(String(row.vendor_name_snapshot));
    });
    return { companies: [...companies.entries()] as SelectOption[], sites: [...sites.entries()] as SelectOption[], vendors: [...vendors] };
  }, [rows]);
  const filtered = useMemo(() => rows.filter((row) => {
    const needle = filters.search.trim().toLowerCase();
    const haystack = [row.po_number, row.vendor_name_snapshot, row.company?.company_name, row.site?.site_name, ...(row.items || []).map((item: any) => `${item.item_code_snapshot || ""} ${item.item_name_snapshot || ""}`)].join(" ").toLowerCase();
    const poDate = String(row.po_date || "");
    return (!needle || haystack.includes(needle)) && (filters.company === "all" || row.company_id === filters.company) && (filters.site === "all" || row.site_id === filters.site) && (filters.vendor === "all" || row.vendor_name_snapshot === filters.vendor) && (filters.poStatus === "all" || row.status === filters.poStatus) && (filters.receiptStatus === "all" || row.receipt_status === filters.receiptStatus) && (!filters.from || poDate >= filters.from) && (!filters.to || poDate <= filters.to);
  }), [rows, filters]);
  const counts = useMemo(() => ({ operational: rows.length, fully: rows.filter((row) => row.receipt_status === "fully_received").length, partial: rows.filter((row) => row.receipt_status === "partially_received" || row.receipt_status === "receipt_in_progress").length, none: rows.filter((row) => row.receipt_status === "not_received").length }), [rows]);

  return <section className="space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase text-emerald-700">Store Management</p><h1 className="text-3xl font-bold text-slate-950">Purchase Order Tracking</h1><p className="mt-1 text-sm text-slate-500">Track Purchase Orders from approval through material receipt and acceptance.</p></div><button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-semibold"><RefreshCw className="h-4 w-4" />Refresh</button></header>
    <AlertMessage type="error" message={message} onClose={() => setMessage("")} />
    <div className="grid gap-3 md:grid-cols-4">{[["Approved / Issued POs", counts.operational], ["Fully Received", counts.fully], ["Partially Received", counts.partial], ["Not Yet Received", counts.none]].map(([title, value]) => <section key={title} className="rounded-xl border bg-white p-4 shadow-sm"><p className="text-xs font-semibold uppercase text-slate-500">{title}</p><p className="mt-2 text-2xl font-bold text-slate-950">{value}</p></section>)}</div>
    <section className="rounded-2xl border bg-white p-4 shadow-sm"><div className="grid gap-3 md:grid-cols-4"><input value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="Search PO, vendor, material or site" className="h-10 rounded-xl border px-3 text-sm md:col-span-2" /><select value={filters.company} onChange={(event) => setFilters({ ...filters, company: event.target.value })} className="h-10 rounded-xl border px-3 text-sm"><option value="all">All Companies</option>{options.companies.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select><select value={filters.site} onChange={(event) => setFilters({ ...filters, site: event.target.value })} className="h-10 rounded-xl border px-3 text-sm"><option value="all">All Sites</option>{options.sites.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select><select value={filters.vendor} onChange={(event) => setFilters({ ...filters, vendor: event.target.value })} className="h-10 rounded-xl border px-3 text-sm"><option value="all">All Vendors</option>{options.vendors.map((vendor) => <option key={vendor} value={vendor}>{vendor}</option>)}</select><select value={filters.poStatus} onChange={(event) => setFilters({ ...filters, poStatus: event.target.value })} className="h-10 rounded-xl border px-3 text-sm"><option value="all">All PO Status</option><option value="approved">Approved</option><option value="issued">Issued</option></select><select value={filters.receiptStatus} onChange={(event) => setFilters({ ...filters, receiptStatus: event.target.value })} className="h-10 rounded-xl border px-3 text-sm"><option value="all">All Receipt Status</option><option value="not_received">Not Received</option><option value="receipt_in_progress">Receipt In Progress</option><option value="partially_received">Partially Received</option><option value="fully_received">Fully Received</option></select><div className="grid grid-cols-2 gap-2"><input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} className="h-10 rounded-xl border px-3 text-sm" /><input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} className="h-10 rounded-xl border px-3 text-sm" /></div></div></section>
    <section className="overflow-x-auto rounded-2xl border bg-white shadow-sm"><table className="w-full min-w-[1500px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{["PO Number", "Vendor", "Company", "Site", "PO Date", "PO Amount", "PO Quantity", "Received", "Accepted", "Rejected", "Hold", "Remaining to Accept", "Receipts", "Status", "Action"].map((heading) => <th key={heading} className="p-3">{heading}</th>)}</tr></thead><tbody className="divide-y">{filtered.length === 0 ? <tr><td colSpan={15} className="p-8 text-center text-slate-500">No Approved or Issued Purchase Orders found.</td></tr> : filtered.map((row) => <tr key={row.id} className="align-top hover:bg-slate-50"><td className="p-3 font-semibold text-slate-950">{row.po_number}</td><td className="p-3">{row.vendor_name_snapshot || "-"}</td><td className="p-3">{row.company?.company_name || "-"}</td><td className="p-3">{row.site?.site_name || "-"}</td><td className="p-3">{row.po_date || "-"}</td><td className="p-3 font-semibold">{money(row.total_amount)}</td><td className="p-3">{qty(row.totals?.po_quantity)}</td><td className="p-3">{qty(row.totals?.received)}</td><td className="p-3">{qty(row.totals?.accepted)}</td><td className="p-3">{qty(row.totals?.rejected)}</td><td className="p-3">{qty(row.totals?.hold)}</td><td className="p-3 font-semibold">{qty(row.totals?.remaining)}</td><td className="p-3">{row.receipt_count || 0}{row.draft_receipt_count ? <span className="ml-1 text-xs text-sky-700">({row.draft_receipt_count} draft)</span> : null}</td><td className="p-3"><span className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${badge(row.receipt_status)}`}>{label(row.receipt_status)}</span><p className="mt-1 text-xs text-slate-500">{poStatus(row.status)}</p></td><td className="p-3"><Link href={`/store/goods-receipts/purchase-orders/${row.id}`} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold"><Eye className="h-4 w-4" />View Tracking</Link></td></tr>)}</tbody></table></section>
  </section>;
}
