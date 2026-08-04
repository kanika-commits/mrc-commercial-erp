"use client";

import Link from "next/link";
import { Eye, Pencil, Plus, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useAccessContext } from "@/components/AccessContext";
import { can, hasGlobalAccess } from "@/lib/accessControl";
import { CONTRACTOR_STATUSES, labelFromCode } from "@/lib/labour/constants";
import { supabase } from "@/lib/supabase";

function vendorLabel(vendor: any) {
  const ids = [vendor.pan, vendor.gstin].filter(Boolean).join(" / ");
  return ids ? `${vendor.vendor_name} — ${ids}` : vendor.vendor_name;
}

export default function LabourContractorsPage() {
  const { access } = useAccessContext();
  const permissions = access?.permissions || [];
  const global = hasGlobalAccess(access);
  const canAdd = global || can(permissions, "labour_contractors", "add");
  const canEdit = global || can(permissions, "labour_contractors", "edit");
  const [contractors, setContractors] = useState<any[]>([]);
  const [vendorOptions, setVendorOptions] = useState<any[]>([]);
  const [vendorOptionsLoading, setVendorOptionsLoading] = useState(false);
  const [vendorOptionsLoaded, setVendorOptionsLoaded] = useState(false);
  const [filters, setFilters] = useState({ search: "", status: "" });
  const [showAdditionalCompliance, setShowAdditionalCompliance] = useState(false);
  const [form, setForm] = useState({
    vendor_id: "",
    contractor_code: "",
    labour_licence_number: "",
    labour_licence_valid_to: "",
    epf_registration_number: "",
    esi_registration_number: "",
    contractor_status: "active",
    remarks: "",
  });
  const [error, setError] = useState("");
  const [lookupError, setLookupError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  async function token() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || "";
  }

  async function parsePayload(response: Response) {
    const text = await response.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      return { error: text || "Request failed." };
    }
  }

  async function load() {
    const accessToken = await token();
    setLookupError("");
    setLoading(true);
    if (canAdd) setVendorOptionsLoading(true);
    const params = new URLSearchParams();
    if (filters.search.trim()) params.set("search", filters.search.trim());
    if (filters.status) params.set("status", filters.status);
    const [contractorResponse, lookupResponse] = await Promise.all([
      fetch(`/api/labour/contractors?${params.toString()}`, { headers: { Authorization: `Bearer ${accessToken}` } }),
      canAdd
        ? fetch("/api/labour/contractors/vendor-options", { headers: { Authorization: `Bearer ${accessToken}` } })
        : Promise.resolve(null),
    ]);
    const contractorPayload = await parsePayload(contractorResponse);
    setLoading(false);
    if (contractorResponse.ok) setContractors(contractorPayload.contractors || []);
    else setError(contractorPayload.error || "Failed to load labour contractors.");
    if (lookupResponse) {
      const lookupPayload = await parsePayload(lookupResponse);
      setVendorOptionsLoaded(true);
      if (lookupResponse.ok) {
        setVendorOptions(lookupPayload.vendors || []);
      } else {
        setVendorOptions([]);
        setLookupError(lookupPayload.error || "Failed to load eligible vendors.");
      }
      setVendorOptionsLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function save() {
    setError("");
    if (!form.vendor_id || saving) return;
    setSaving(true);
    const response = await fetch("/api/labour/contractors", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${await token()}` },
      body: JSON.stringify(form),
    });
    const payload = await parsePayload(response);
    setSaving(false);
    if (!response.ok) return setError(payload.error || "Failed to enable contractor.");
    const enabledVendorId = form.vendor_id;
    setForm({ vendor_id: "", contractor_code: "", labour_licence_number: "", labour_licence_valid_to: "", epf_registration_number: "", esi_registration_number: "", contractor_status: "active", remarks: "" });
    setVendorOptions((current) => current.filter((vendor) => vendor.id !== enabledVendorId));
    await load();
  }

  const field = "h-11 rounded-lg border px-3 text-sm";
  const label = "text-xs font-bold uppercase text-slate-500";

  return (
    <section className="min-h-screen bg-[#f6f3f5] px-6 py-7 md:px-10">
      <div className="mx-auto max-w-[1400px] space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.28em] text-sky-600">Labour Management</p>
            <h1 className="text-3xl font-semibold">Labour Contractors</h1>
            <p className="text-sm text-slate-600">Enable Vendor Master records for labour operations.</p>
          </div>
          <button type="button" onClick={load} className="inline-flex items-center gap-2 rounded-lg border bg-white px-4 py-2 text-sm font-semibold"><RefreshCw className="h-4 w-4" /> {loading ? "Refreshing" : "Refresh"}</button>
        </header>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}

        <div className="grid gap-3 rounded-lg border bg-white p-4 shadow-sm md:grid-cols-[1fr_220px_auto]">
          <input value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="Search name, code, contact or licence" className={field} />
          <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })} className={field}>
            <option value="">All Status</option>
            {CONTRACTOR_STATUSES.map((status) => <option key={status} value={status}>{labelFromCode(status)}</option>)}
          </select>
          <button type="button" onClick={load} className="h-11 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white">Apply</button>
        </div>

        {canAdd && (
          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold">Enable Contractor</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <label className="md:col-span-2">
                <span className={label}>Eligible Vendor</span>
                <select value={form.vendor_id} disabled={vendorOptionsLoading || !!lookupError || vendorOptions.length === 0} onChange={(event) => setForm({ ...form, vendor_id: event.target.value })} className={`${field} w-full`}>
                  <option value="">{vendorOptionsLoading ? "Loading eligible vendors..." : "Select eligible Vendor Master record"}</option>
                  {vendorOptions.map((vendor: any) => <option key={vendor.id} value={vendor.id}>{vendorLabel(vendor)}</option>)}
                </select>
                {lookupError && <p className="mt-1 text-xs font-semibold text-red-700">{lookupError}</p>}
                {!lookupError && vendorOptionsLoaded && !vendorOptionsLoading && vendorOptions.length === 0 && <p className="mt-1 text-xs font-semibold text-slate-500">No eligible vendors available.</p>}
              </label>
              <label><span className={label}>Contractor Code</span><input value={form.contractor_code} onChange={(event) => setForm({ ...form, contractor_code: event.target.value })} className={`${field} w-full`} /></label>
              <label><span className={label}>Status</span><select value={form.contractor_status} onChange={(event) => setForm({ ...form, contractor_status: event.target.value })} className={`${field} w-full`}>{CONTRACTOR_STATUSES.map((status) => <option key={status} value={status}>{labelFromCode(status)}</option>)}</select></label>
              <label className="md:col-span-2"><span className={label}>Remarks</span><input value={form.remarks} onChange={(event) => setForm({ ...form, remarks: event.target.value })} className={`${field} w-full`} /></label>
              <div className="flex items-end"><button type="button" onClick={save} disabled={!form.vendor_id || saving} className="inline-flex h-11 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"><Plus className="h-4 w-4" /> {saving ? "Enabling..." : "Enable Contractor"}</button></div>
              <div className="md:col-span-3">
                <button type="button" onClick={() => setShowAdditionalCompliance(!showAdditionalCompliance)} className="rounded-md border px-3 py-2 text-sm font-semibold">
                  {showAdditionalCompliance ? "Hide" : "Show"} Additional Compliance
                </button>
                {showAdditionalCompliance && (
                  <div className="mt-3 grid gap-3 rounded-lg border bg-slate-50 p-3 md:grid-cols-4">
                    <label><span className={label}>Labour Licence Number</span><input value={form.labour_licence_number} onChange={(event) => setForm({ ...form, labour_licence_number: event.target.value })} className={`${field} w-full bg-white`} /></label>
                    <label><span className={label}>Licence Expiry</span><input type="date" value={form.labour_licence_valid_to} onChange={(event) => setForm({ ...form, labour_licence_valid_to: event.target.value })} className={`${field} w-full bg-white`} /></label>
                    <label><span className={label}>EPF Registration</span><input value={form.epf_registration_number} onChange={(event) => setForm({ ...form, epf_registration_number: event.target.value })} className={`${field} w-full bg-white`} /></label>
                    <label><span className={label}>ESIC Registration</span><input value={form.esi_registration_number} onChange={(event) => setForm({ ...form, esi_registration_number: event.target.value })} className={`${field} w-full bg-white`} /></label>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>{["Contractor Code", "Contractor Name", "Contact Person", "Mobile", "Active Labour", "Active Sites", "Status", "Actions"].map((heading) => <th key={heading} className="px-3 py-3">{heading}</th>)}</tr>
            </thead>
            <tbody className="divide-y">
              {contractors.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-500">No labour contractors found.</td></tr>
              ) : contractors.map((contractor) => (
                <tr key={contractor.id}>
                  <td className="px-3 py-3 font-semibold">{contractor.contractor_code || "-"}</td>
                  <td className="px-3 py-3">{contractor.vendors?.vendor_name || "-"}</td>
                  <td className="px-3 py-3">{contractor.primary_contact?.contact_name || "-"}</td>
                  <td className="px-3 py-3">{contractor.primary_contact?.contact_number || "-"}</td>
                  <td className="px-3 py-3">{contractor.active_labour_count || 0}</td>
                  <td className="px-3 py-3">{contractor.current_site_count || 0}</td>
                  <td className="px-3 py-3">{labelFromCode(contractor.contractor_status)}</td>
                  <td className="px-3 py-3"><div className="flex flex-wrap gap-2"><Link href={`/labour/contractors/${contractor.id}`} className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5"><Eye className="h-4 w-4" /> View</Link>{canEdit && <Link href={`/labour/contractors/${contractor.id}/edit`} className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5"><Pencil className="h-4 w-4" /> Edit</Link>}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
