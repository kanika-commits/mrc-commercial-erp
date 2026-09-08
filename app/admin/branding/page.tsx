"use client";

import { ImagePlus, Loader2, Save, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAccessContext } from "@/components/AccessContext";
import { apiFetch } from "@/components/hr/hrClient";
import { defaultTenantBranding, resolveTenantBranding } from "@/lib/tenantBranding";

type Form = ReturnType<typeof resolveTenantBranding>;

export default function BrandingPage() {
  const { access, loading: accessLoading } = useAccessContext();
  const [form, setForm] = useState<Form>(resolveTenantBranding(defaultTenantBranding));
  const [file, setFile] = useState<File | null>(null);
  const [selectedPreviewUrl, setSelectedPreviewUrl] = useState<string | null>(null);
  const [removeSavedLogoRequested, setRemoveSavedLogoRequested] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [colorError, setColorError] = useState("");
  const allowed = access?.roleCodes?.includes("platform_owner") === true;

  useEffect(() => { if (!accessLoading && allowed) apiFetch("/api/admin/branding").then((data) => setForm(resolveTenantBranding(data))).catch((e) => setMessage(e.message)).finally(() => setLoading(false)); else if (!accessLoading) setLoading(false); }, [accessLoading, allowed]);
  useEffect(() => () => { if (selectedPreviewUrl) URL.revokeObjectURL(selectedPreviewUrl); }, [selectedPreviewUrl]);
  const update = (key: keyof Form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const updateColor = (key: "primaryColor" | "secondaryColor", value: string) => { const next = value.trim(); setColorError(next && !/^#[0-9a-f]{6}$/i.test(next) ? "Use a six-digit HEX color, such as #A52424." : ""); update(key, next); };
  const save = async () => {
    setSaving(true); setMessage("");
    try {
      if (colorError) throw new Error(colorError);
      const data = await apiFetch("/api/admin/branding", { method: "PUT", body: JSON.stringify(form) });
      if (file) { const body = new FormData(); body.set("file", file); const uploaded = await apiFetch("/api/admin/branding", { method: "POST", body }); setForm(resolveTenantBranding(uploaded)); setFile(null); setSelectedPreviewUrl(null); }
      else if (removeSavedLogoRequested) { const removed = await apiFetch("/api/admin/branding", { method: "DELETE" }); setForm(resolveTenantBranding(removed)); setRemoveSavedLogoRequested(false); }
      else setForm(resolveTenantBranding(data));
      setMessage("Branding saved.");
    } catch (error: any) { setMessage(error.message); } finally { setSaving(false); }
  };
  const remove = async () => { setSaving(true); try { const data = await apiFetch("/api/admin/branding", { method: "DELETE" }); setForm(resolveTenantBranding(data)); setFile(null); setSelectedPreviewUrl(null); setMessage("Logo removed."); } catch (error: any) { setMessage(error.message); } finally { setSaving(false); } };
  if (loading) return <div className="p-8 text-sm text-slate-500">Loading branding...</div>;
  if (!allowed) return <div className="rounded-lg border bg-white p-6 text-sm text-slate-600"><h1 className="text-xl font-semibold">Access Denied</h1><p className="mt-2">Only Platform Owner can manage tenant branding.</p></div>;
  return <section className="max-w-4xl space-y-6 p-8">
    <div><h1 className="text-3xl font-bold text-slate-950">Branding</h1><p className="mt-1 text-sm text-slate-500">Customize how your organization appears in SiteQube.</p></div>
    {message && <div role="status" className="rounded border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">{message}</div>}
    <div className="rounded-xl border bg-white p-6 shadow-sm"><div className="grid gap-5 md:grid-cols-2">
      <label className="text-sm font-semibold">Organization Name<input value={form.organizationName} onChange={(e) => update("organizationName", e.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label>
      <label className="text-sm font-semibold">Login Tagline<input value={form.loginTagline || ""} onChange={(e) => update("loginTagline", e.target.value)} className="mt-1 h-10 w-full rounded border px-3" /></label>
      <label className="text-sm font-semibold">Primary Color<div className="mt-1 flex items-center gap-2"><input type="color" value={/^#[0-9a-f]{6}$/i.test(form.primaryColor || "") ? form.primaryColor || "#1769aa" : "#1769aa"} onChange={(e) => updateColor("primaryColor", e.target.value)} className="h-10 w-12 rounded border p-1" /><input aria-label="Primary Color HEX" value={form.primaryColor || ""} onChange={(e) => updateColor("primaryColor", e.target.value)} className="h-10 flex-1 rounded border px-3 font-mono text-sm uppercase" placeholder="#1769AA" /></div></label>
      <label className="text-sm font-semibold">Secondary Color<div className="mt-1 flex items-center gap-2"><input type="color" value={/^#[0-9a-f]{6}$/i.test(form.secondaryColor || "") ? form.secondaryColor || "#0f3d56" : "#0f3d56"} onChange={(e) => updateColor("secondaryColor", e.target.value)} className="h-10 w-12 rounded border p-1" /><input aria-label="Secondary Color HEX" value={form.secondaryColor || ""} onChange={(e) => updateColor("secondaryColor", e.target.value)} className="h-10 flex-1 rounded border px-3 font-mono text-sm uppercase" placeholder="#0F3D56" /></div></label>
    </div>
    {colorError && <p role="alert" className="mt-3 text-sm font-medium text-red-700">{colorError}</p>}
    <div role="button" tabIndex={0} onClick={(e) => { if (!(e.target as HTMLElement).closest("button,label")) fileInputRef.current?.click(); }} onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !(e.target as HTMLElement).closest("button,label")) fileInputRef.current?.click(); }} className="mt-6 cursor-pointer rounded-xl border-2 border-dashed border-sky-300 bg-sky-50/60 p-5 transition hover:border-sky-500 hover:bg-sky-50 focus:outline-none focus:ring-4 focus:ring-sky-200"><div className="flex flex-wrap items-center gap-4"><div className="flex h-24 w-40 items-center justify-center rounded border bg-white p-3">{(selectedPreviewUrl || form.logoUrl) ? <img src={selectedPreviewUrl || form.logoUrl || undefined} alt="Organization logo" className="max-h-full max-w-full object-contain" /> : <ImagePlus className="h-8 w-8 text-sky-500" />}</div><div className="min-w-[240px] flex-1"><p className="text-sm font-semibold">Organization Logo</p><label className="mt-2 inline-flex cursor-pointer items-center rounded bg-sky-700 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-800 focus-within:ring-4 focus-within:ring-sky-200"><span>{file ? "Change Logo" : form.logoUrl ? "Replace Logo" : "Choose Logo"}</span><input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { const next = e.target.files?.[0] || null; if (next && (!["image/png", "image/jpeg", "image/webp"].includes(next.type) || next.size > 2 * 1024 * 1024)) { setMessage("Logo must be PNG, JPEG, or WebP and no larger than 2 MB."); return; } if (selectedPreviewUrl) URL.revokeObjectURL(selectedPreviewUrl); setFile(next); setSelectedPreviewUrl(next ? URL.createObjectURL(next) : null); setRemoveSavedLogoRequested(false); }} className="sr-only" /></label><button type="button" onClick={(e) => { e.stopPropagation(); if (selectedPreviewUrl) URL.revokeObjectURL(selectedPreviewUrl); setFile(null); setSelectedPreviewUrl(null); }} disabled={!file} className="ml-2 text-sm font-semibold text-slate-700 underline disabled:opacity-40">Clear Selection</button>{form.logoPath && !file && <button type="button" onClick={(e) => { e.stopPropagation(); setRemoveSavedLogoRequested(true); setSelectedPreviewUrl(null); }} className="ml-2 text-sm font-semibold text-red-700 underline">Remove Logo</button>}<p className="mt-2 text-xs text-slate-500">Drag &amp; drop your logo here or choose a file. PNG, JPEG or WebP · Max 2 MB · Transparent background recommended.</p>{file && <p className="mt-1 text-xs font-medium text-slate-700">Selected: {file.name}</p>}</div></div></div>
    <div className="mt-6 rounded-lg border p-5" style={{ borderColor: form.primaryColor || undefined, backgroundColor: `${form.secondaryColor}12` }}><p className="text-xs font-semibold uppercase tracking-wider" style={{ color: form.primaryColor || undefined }}>Login Preview</p><div className="mt-3 flex items-center gap-4"><div className="flex h-24 w-40 items-center justify-center rounded bg-white p-3 shadow" style={{ border: `2px solid ${form.primaryColor}` }}>{(selectedPreviewUrl || form.logoUrl) ? <img src={selectedPreviewUrl || form.logoUrl || undefined} alt="Preview logo" className="max-h-full max-w-full object-contain" /> : <span className="text-xl font-bold" style={{ color: form.primaryColor }}>{form.organizationName.slice(0, 2).toUpperCase()}</span>}</div><div><p className="font-semibold" style={{ color: form.secondaryColor || undefined }}>{form.organizationName}</p><p className="text-sm text-slate-500">{form.loginTagline}</p><p className="mt-3 text-xs font-semibold text-slate-400">Powered by SiteQube</p></div></div></div>
    <div className="flex flex-wrap justify-end gap-3"><button type="button" onClick={remove} disabled={saving || !form.logoPath} className="inline-flex items-center gap-2 rounded border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-50"><Trash2 className="h-4 w-4" />Remove Logo</button><button type="button" onClick={save} disabled={saving} className="inline-flex items-center gap-2 rounded bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save Branding</button></div>
    </div>
  </section>;
}
