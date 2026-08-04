"use client";

import Link from "next/link";
import { Save } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { CONTRACTOR_STATUSES, labelFromCode } from "@/lib/labour/constants";

export default function LabourContractorEditPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [contractor, setContractor] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAdditionalCompliance, setShowAdditionalCompliance] = useState(false);

  async function token() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || "";
  }

  async function load() {
    setMessage("");
    const response = await fetch(`/api/labour/contractors/${params.id}`, {
      headers: { Authorization: `Bearer ${await token()}` },
    });
    const payload = await response.json();
    if (!response.ok) return setMessage(payload.error || "Failed to load contractor.");
    setContractor(payload.contractor);
    setForm({
      contractor_code: payload.contractor.contractor_code || "",
      labour_licence_number: payload.contractor.labour_licence_number || "",
      labour_licence_valid_to: payload.contractor.labour_licence_valid_to || "",
      epf_registration_number: payload.contractor.epf_registration_number || "",
      esi_registration_number: payload.contractor.esi_registration_number || "",
      contractor_status: payload.contractor.contractor_status || "active",
      remarks: payload.contractor.remarks || "",
      change_reason: "",
    });
  }

  useEffect(() => { load(); }, [params.id]);

  async function save() {
    setSaving(true);
    setMessage("");
    const response = await fetch(`/api/labour/contractors/${params.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json", Authorization: `Bearer ${await token()}` },
      body: JSON.stringify(form),
    });
    const payload = await response.json();
    setSaving(false);
    if (!response.ok) return setMessage(payload.error || "Failed to update contractor.");
    router.push(`/labour/contractors/${params.id}`);
  }

  if (!contractor) return <section className="p-8 text-sm text-slate-500">{message || "Loading contractor..."}</section>;

  const field = "mt-1 h-11 w-full rounded-lg border px-3";
  const label = "text-xs font-bold uppercase tracking-wide text-slate-500";

  return (
    <section className="min-h-screen bg-[#f6f3f5] px-6 py-7 md:px-10">
      <div className="mx-auto max-w-[1000px] space-y-5">
        <header className="rounded-lg border bg-white p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-sky-600">Labour Contractor</p>
          <h1 className="text-3xl font-semibold">Edit Contractor Profile</h1>
          <p className="mt-1 text-sm text-slate-600">Vendor identity remains read-only from Vendor Master.</p>
        </header>

        {message && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{message}</div>}

        <section className="grid gap-4 rounded-lg border bg-white p-5 shadow-sm md:grid-cols-3">
          <ReadOnly label="Vendor Name" value={contractor.vendors?.vendor_name} />
          <ReadOnly label="PAN" value={contractor.vendors?.pan} />
          <ReadOnly label="GSTIN" value={contractor.vendors?.gstin} />
        </section>

        <section className="grid gap-4 rounded-lg border bg-white p-5 shadow-sm md:grid-cols-2">
          <label className={label}>Contractor Code<input className={field} value={form.contractor_code || ""} onChange={(e) => setForm({ ...form, contractor_code: e.target.value })} /></label>
          <label className={label}>Status<select className={field} value={form.contractor_status || "active"} onChange={(e) => setForm({ ...form, contractor_status: e.target.value })}>{CONTRACTOR_STATUSES.map((status) => <option key={status} value={status}>{labelFromCode(status)}</option>)}</select></label>
          <label className={`${label} md:col-span-2`}>Remarks<input className={field} value={form.remarks || ""} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></label>
          <label className={`${label} md:col-span-2`}>Change Reason<input className={field} value={form.change_reason || ""} onChange={(e) => setForm({ ...form, change_reason: e.target.value })} placeholder="Required when changing code for contractors with active labour/deployments" /></label>
          <div className="md:col-span-2">
            <button type="button" onClick={() => setShowAdditionalCompliance(!showAdditionalCompliance)} className="rounded-md border px-3 py-2 text-sm font-semibold">
              {showAdditionalCompliance ? "Hide" : "Show"} Additional Compliance
            </button>
            {showAdditionalCompliance && (
              <div className="mt-3 grid gap-4 rounded-lg border bg-slate-50 p-3 md:grid-cols-2">
                <label className={label}>Labour Licence Number<input className={`${field} bg-white`} value={form.labour_licence_number || ""} onChange={(e) => setForm({ ...form, labour_licence_number: e.target.value })} /></label>
                <label className={label}>Licence Expiry<input className={`${field} bg-white`} type="date" value={form.labour_licence_valid_to || ""} onChange={(e) => setForm({ ...form, labour_licence_valid_to: e.target.value })} /></label>
                <label className={label}>EPF Registration<input className={`${field} bg-white`} value={form.epf_registration_number || ""} onChange={(e) => setForm({ ...form, epf_registration_number: e.target.value })} /></label>
                <label className={label}>ESIC Registration<input className={`${field} bg-white`} value={form.esi_registration_number || ""} onChange={(e) => setForm({ ...form, esi_registration_number: e.target.value })} /></label>
              </div>
            )}
          </div>
        </section>

        <div className="flex justify-end gap-3">
          <Link href={`/labour/contractors/${params.id}`} className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold">Cancel</Link>
          <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Save className="h-4 w-4" /> {saving ? "Saving..." : "Save"}</button>
        </div>
      </div>
    </section>
  );
}

function ReadOnly({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 font-semibold text-slate-950">{value || "-"}</p>
    </div>
  );
}
