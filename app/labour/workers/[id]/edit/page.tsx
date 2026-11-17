"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { formatLabourCode } from "@/lib/labour/constants";
import { aadhaarInputValue } from "@/lib/utils/aadhaar";

export default function EditLabourWorkerPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [form, setForm] = useState<any>(null);
  const [error, setError] = useState("");
  async function token() { const { data: { session } } = await supabase.auth.getSession(); return session?.access_token || ""; }
  useEffect(() => {
    token().then(async (accessToken) => {
      const workerResponse = await fetch(`/api/labour/workers/${params.id}`, { headers: { Authorization: `Bearer ${accessToken}` } });
      const workerPayload = await workerResponse.json();
      if (!workerResponse.ok) throw new Error(workerPayload.error || "Failed to load labourer.");
      setForm(workerPayload.worker);
    }).catch((e) => setError(e.message));
  }, [params.id]);
  async function save() {
    const profile = {
      worker_name: form.worker_name,
      father_or_husband_name: form.father_or_husband_name,
      gender: form.gender,
      date_of_birth: form.date_of_birth,
      mobile_number: form.mobile_number,
      alternate_mobile_number: form.alternate_mobile_number,
      aadhaar_number: form.aadhaar_number,
      uan_number: form.uan_number,
      esi_number: form.esi_number,
      bank_account_number: form.bank_account_number,
      bank_ifsc: form.bank_ifsc,
      bank_name: form.bank_name,
      remarks: form.remarks,
      // The unchanged assignment context is retained only for the existing API contract.
      current_contractor_profile_id: form.current_contractor_profile_id,
      current_work_order_id: form.current_work_order_id,
      labour_trade_id: form.labour_trade_id,
      date_of_joining: form.date_of_joining,
      status: form.status,
    };
    const response = await fetch(`/api/labour/workers/${params.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json", Authorization: `Bearer ${await token()}` },
      body: JSON.stringify(profile),
    });
    const payload = await response.json();
    if (!response.ok) return setError(payload.error || "Failed to update labourer.");
    router.push(`/labour/workers/${params.id}`);
  }
  if (!form) return <section className="p-8 text-sm text-slate-500">{error || "Loading..."}</section>;
  return (
    <section className="min-h-screen bg-[#f6f3f5] px-6 py-7 md:px-10">
      <div className="mx-auto max-w-[1100px] space-y-5">
        <header className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.28em] text-sky-600">Labour Master</p><h1 className="text-3xl font-semibold">Edit Personal Info</h1></div><div className="flex gap-2"><Link href={`/labour/workers/${params.id}`} className="rounded-lg border bg-white px-4 py-2 font-semibold">Cancel</Link><button onClick={save} className="rounded-lg bg-slate-950 px-4 py-2 font-semibold text-white">Save Changes</button></div></header>
        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}
        <div className="grid gap-4 rounded-lg border bg-white p-5 shadow-sm md:grid-cols-2">
          <Input label="Labour Code" value={formatLabourCode(form.labour_code)} onChange={() => {}} disabled />
          <Input label="Worker Name *" value={form.worker_name || ""} onChange={(v) => setForm({ ...form, worker_name: v })} />
          <Input label="Father/Husband Name" value={form.father_or_husband_name || ""} onChange={(v) => setForm({ ...form, father_or_husband_name: v })} />
          <Input label="Mobile" value={form.mobile_number || ""} onChange={(v) => setForm({ ...form, mobile_number: v })} />
          <Input label="Aadhaar Number" value={form.aadhaar_number || ""} onChange={(v) => setForm({ ...form, aadhaar_number: aadhaarInputValue(v) })} inputMode="numeric" maxLength={14} />
          <label className="md:col-span-2 text-sm font-semibold text-slate-700">Remarks<textarea value={form.remarks || ""} onChange={(e) => setForm({ ...form, remarks: e.target.value })} className="mt-1 min-h-24 w-full rounded-lg border px-3 py-2" /></label>
        </div>
      </div>
    </section>
  );
}

function Input({ label, value, onChange, type = "text", disabled = false, inputMode, maxLength }: { label: string; value: string; onChange: (v: string) => void; type?: string; disabled?: boolean; inputMode?: "none" | "text" | "tel" | "url" | "email" | "numeric" | "decimal" | "search"; maxLength?: number }) {
  return <label className="text-sm font-semibold text-slate-700">{label}<input type={type} value={value} disabled={disabled} inputMode={inputMode} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} className="mt-1 h-11 w-full rounded-lg border px-3 disabled:bg-slate-100" /></label>;
}
