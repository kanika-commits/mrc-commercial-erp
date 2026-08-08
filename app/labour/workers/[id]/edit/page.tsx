"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { formatLabourCode, LABOUR_STATUSES } from "@/lib/labour/constants";
import { aadhaarInputValue } from "@/lib/utils/aadhaar";

export default function EditLabourWorkerPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [form, setForm] = useState<any>(null);
  const [lookups, setLookups] = useState<any>({ contractors: [], trades: [], labour_work_orders: [] });
  const [workOrderLoading, setWorkOrderLoading] = useState(false);
  const [error, setError] = useState("");
  async function token() { const { data: { session } } = await supabase.auth.getSession(); return session?.access_token || ""; }
  useEffect(() => {
    token().then(async (accessToken) => {
      const [workerResponse, lookupResponse] = await Promise.all([
        fetch(`/api/labour/workers/${params.id}`, { headers: { Authorization: `Bearer ${accessToken}` } }),
        fetch("/api/labour/lookups", { headers: { Authorization: `Bearer ${accessToken}` } }),
      ]);
      const workerPayload = await workerResponse.json();
      const lookupPayload = await lookupResponse.json();
      if (!workerResponse.ok) throw new Error(workerPayload.error || "Failed to load labourer.");
      setForm(workerPayload.worker);
      setLookups(lookupPayload);
    }).catch((e) => setError(e.message));
  }, [params.id]);
  useEffect(() => {
    if (!form?.current_company_id || !form?.current_site_id || !form?.current_contractor_profile_id) {
      setLookups((current: any) => ({ ...current, labour_work_orders: [] }));
      return;
    }
    const contractor = (lookups.contractors || []).find((item: any) => item.id === form.current_contractor_profile_id);
    const vendorId = contractor?.vendor_id || contractor?.vendors?.id || "";
    if (!vendorId) {
      setLookups((current: any) => ({ ...current, labour_work_orders: [] }));
      return;
    }
    setWorkOrderLoading(true);
    token().then(async (accessToken) => {
      const params = new URLSearchParams({
        purpose: "labour_registration",
        company_id: form.current_company_id,
        site_id: form.current_site_id,
        vendor_id: vendorId,
      });
      const response = await fetch(`/api/labour/lookups?${params.toString()}`, { headers: { Authorization: `Bearer ${accessToken}` } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to load Labour Work Orders.");
      const workOrders = payload.labour_work_orders || [];
      setLookups((current: any) => ({
        ...current,
        labour_work_orders: workOrders,
      }));
      setForm((current: any) => {
        if (!current) return current;
        if (current.current_work_order_id && workOrders.some((workOrder: any) => workOrder.id === current.current_work_order_id)) return current;
        return {
          ...current,
          current_work_order_id: workOrders.length === 1 ? workOrders[0].id : "",
        };
      });
    }).catch((e) => setError(e.message)).finally(() => setWorkOrderLoading(false));
  }, [form?.current_company_id, form?.current_site_id, form?.current_contractor_profile_id]);
  async function save() {
    const response = await fetch(`/api/labour/workers/${params.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json", Authorization: `Bearer ${await token()}` },
      body: JSON.stringify(form),
    });
    const payload = await response.json();
    if (!response.ok) return setError(payload.error || "Failed to update labourer.");
    router.push(`/labour/workers/${params.id}`);
  }
  if (!form) return <section className="p-8 text-sm text-slate-500">{error || "Loading..."}</section>;
  const visibleWorkOrderOptions = [
    "",
    ...Array.from(new Set([
      form.current_work_order_id || "",
      ...lookups.labour_work_orders.map((workOrder: any) => workOrder.id),
    ].filter(Boolean))),
  ];
  const visibleWorkOrderLabels = {
    "": "No Work Order",
    ...(form.current_work_order_id && form.current_work_orders
      ? { [form.current_work_order_id]: `${form.current_work_orders.wo_number || "WO"} — ${form.current_work_orders.wo_type || "Work Order"}` }
      : {}),
    ...Object.fromEntries(lookups.labour_work_orders.map((workOrder: any) => [workOrder.id, `${workOrder.wo_number || "WO"} — ${workOrder.wo_type || "Daily Wage"}`])),
  };
  const selectedWorkOrder = lookups.labour_work_orders.find((workOrder: any) => workOrder.id === form.current_work_order_id) || form.current_work_orders || null;
  const paymentModelLabel = selectedWorkOrder?.wo_type === "Daily Wage" ? "Daily Wage" : "Contractual Labour";
  return (
    <section className="min-h-screen bg-[#f6f3f5] px-6 py-7 md:px-10">
      <div className="mx-auto max-w-[1100px] space-y-5">
        <header className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.28em] text-sky-600">Labour Master</p><h1 className="text-3xl font-semibold">Edit Labourer</h1></div><div className="flex gap-2">{form.status === "inactive" && <Link href={`/labour/workers/${params.id}?activate=1&source=edit`} className="rounded-lg bg-slate-950 px-4 py-2 font-semibold text-white">Reactivate Labour</Link>}<Link href={`/labour/workers/${params.id}`} className="rounded-lg border bg-white px-4 py-2 font-semibold">Cancel</Link><button onClick={save} className="rounded-lg bg-slate-950 px-4 py-2 font-semibold text-white">Save Changes</button></div></header>
        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}
        <div className="grid gap-4 rounded-lg border bg-white p-5 shadow-sm md:grid-cols-2">
          <Input label="Labour Code" value={formatLabourCode(form.labour_code)} onChange={() => {}} disabled />
          <Input label="Worker Name *" value={form.worker_name || ""} onChange={(v) => setForm({ ...form, worker_name: v })} />
          <Input label="Father/Husband Name" value={form.father_or_husband_name || ""} onChange={(v) => setForm({ ...form, father_or_husband_name: v })} />
          <Input label="Mobile" value={form.mobile_number || ""} onChange={(v) => setForm({ ...form, mobile_number: v })} />
          <Input label="Aadhaar Number" value={form.aadhaar_number || ""} onChange={(v) => setForm({ ...form, aadhaar_number: aadhaarInputValue(v) })} inputMode="numeric" maxLength={14} />
          <Select label="Contractor *" value={form.current_contractor_profile_id || ""} onChange={(v) => setForm({ ...form, current_contractor_profile_id: v, current_work_order_id: "" })} options={["", ...lookups.contractors.map((c: any) => c.id)]} labels={Object.fromEntries(lookups.contractors.map((c: any) => [c.id, c.vendors?.vendor_name || c.contractor_code]))} />
          <Select label="Work Order (Optional)" value={form.current_work_order_id || ""} onChange={(v) => setForm({ ...form, current_work_order_id: v })} options={visibleWorkOrderOptions} labels={visibleWorkOrderLabels} placeholder={workOrderLoading ? "Loading Work Orders..." : "No Work Order"} helper={form.current_company_id && form.current_site_id && form.current_contractor_profile_id && !workOrderLoading && !(lookups.labour_work_orders || []).length ? "No Work Order found for this contractor and site. Labour will remain Contractual Labour." : ""} />
          <div>
            <p className="text-sm font-semibold text-slate-700">Payment Model</p>
            <PaymentModelBadge label={paymentModelLabel} />
          </div>
          <Select label="Labour Category *" value={form.labour_trade_id || ""} onChange={(v) => setForm({ ...form, labour_trade_id: v })} options={["", ...lookups.trades.map((t: any) => t.id)]} labels={Object.fromEntries(lookups.trades.map((t: any) => [t.id, t.trade_name]))} />
          <Input label="Joining Date" type="date" value={form.date_of_joining || ""} onChange={(v) => setForm({ ...form, date_of_joining: v })} />
          <Select label="Status" value={form.status || ""} onChange={(v) => setForm({ ...form, status: v })} options={LABOUR_STATUSES.filter((status) => status !== "deleted" && !(form.status === "inactive" && status === "active"))} />
          <label className="md:col-span-2 text-sm font-semibold text-slate-700">Remarks<textarea value={form.remarks || ""} onChange={(e) => setForm({ ...form, remarks: e.target.value })} className="mt-1 min-h-24 w-full rounded-lg border px-3 py-2" /></label>
        </div>
      </div>
    </section>
  );
}

function Input({ label, value, onChange, type = "text", disabled = false, inputMode, maxLength }: { label: string; value: string; onChange: (v: string) => void; type?: string; disabled?: boolean; inputMode?: "none" | "text" | "tel" | "url" | "email" | "numeric" | "decimal" | "search"; maxLength?: number }) {
  return <label className="text-sm font-semibold text-slate-700">{label}<input type={type} value={value} disabled={disabled} inputMode={inputMode} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} className="mt-1 h-11 w-full rounded-lg border px-3 disabled:bg-slate-100" /></label>;
}
function Select({ label, value, onChange, options, labels = {}, placeholder = "Select", helper = "" }: { label: string; value: string; onChange: (v: string) => void; options: readonly string[]; labels?: Record<string, string>; placeholder?: string; helper?: string }) {
  return <label className="text-sm font-semibold text-slate-700">{label}<select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 h-11 w-full rounded-lg border px-3">{options.map((option) => <option key={option || "blank"} value={option}>{option ? labels[option] || option : placeholder}</option>)}</select>{helper && <p className="mt-1 text-[11px] font-semibold text-slate-500">{helper}</p>}</label>;
}

function PaymentModelBadge({ label }: { label: string }) {
  const classes = label === "Daily Wage" ? "bg-sky-100 text-sky-800" : "bg-slate-100 text-slate-700";
  return <span className={`mt-1 inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${classes}`}>{label}</span>;
}
