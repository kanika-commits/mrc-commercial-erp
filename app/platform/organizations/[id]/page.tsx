"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import PlatformShell from "../../PlatformShell";
import { supabase } from "@/lib/supabase";

export default function OrganizationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void load();
    async function load() {
      const { id } = await params;
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(`/api/platform/organizations/${id}`, { headers: { Authorization: `Bearer ${session?.access_token || ""}` } });
      const value = await response.json();
      if (!response.ok) setError(value.error || "Unable to load organization.");
      else setData(value);
    }
  }, [params]);

  async function resend(invitationId: string) {
    setSending(true);
    setMessage("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch("/api/platform/organizations/provision/invitation", { method: "POST", headers: { Authorization: `Bearer ${session?.access_token || ""}`, "Content-Type": "application/json" }, body: JSON.stringify({ invitationId }) });
      const value = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(value.error || "Unable to send invitation.");
      setMessage("Invitation email sent.");
      setData((current: any) => ({ ...current, invitations: (current.invitations || []).map((row: any) => row.id === invitationId ? { ...row, status: "sent" } : row) }));
    } catch (sendError) {
      setMessage(sendError instanceof Error ? sendError.message : "Unable to send invitation.");
    } finally {
      setSending(false);
    }
  }

  return <PlatformShell><Link href="/platform/organizations" className="text-sm font-semibold text-slate-600 hover:underline">← Organizations</Link>{error ? <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">{error}</div> : !data ? <div className="mt-6 rounded-xl border bg-white p-8 text-sm text-slate-500">Loading organization...</div> : <><div className="mb-8 mt-6"><p className="text-sm font-semibold text-slate-500">SITEQUBE PLATFORM / ORGANIZATION</p><div className="mt-2 flex flex-wrap items-center gap-3"><h1 className="text-3xl font-semibold tracking-tight">{data.organization.name}</h1><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">{data.organization.status || "Active"}</span></div><p className="mt-2 text-slate-500">{data.organization.code || "No organization code"}</p></div><div className="grid gap-5 lg:grid-cols-2"><Panel title="Overview"><Rows rows={[["Organization name", data.organization.name], ["Code", data.organization.code || "Not available"], ["Created", data.organization.created_at ? new Date(data.organization.created_at).toLocaleDateString() : "Not available"], ["Organization ID", data.organization.id]]} /></Panel><Panel title="Access mode"><p className="text-xl font-semibold">{data.entitlementMode === "Legacy" ? "Legacy Organization" : "Managed Organization"}</p><p className="mt-2 text-sm text-slate-500">{data.entitlementMode === "Legacy" ? "Uses existing ERP access and permissions." : "Platform module entitlements are configured for this organization."}</p></Panel><Panel title="Modules & plan">{data.modules.length ? <Rows rows={data.modules.map((row: any) => [row.module_code, row.enabled ? "Enabled" : "Disabled"])} /> : <p className="text-sm text-slate-500">Legacy access. No platform module plan configured.</p>}</Panel><Panel title="Domain">{data.domains.length ? <Rows rows={data.domains.map((row: any) => [row.hostname || row.slug, `${row.status || "Unknown"}${row.is_primary ? " · Primary" : ""}`])} /> : <p className="text-sm text-slate-600">Not configured</p>}</Panel><Panel title="Platform access">{data.memberships.length ? <p className="text-sm text-slate-600">{data.memberships.length} platform-level membership record{data.memberships.length === 1 ? "" : "s"} configured.</p> : <p className="text-sm text-slate-600">No platform-level memberships configured.</p>}</Panel><Panel title="Organization structure"><Rows rows={[["Companies", data.businessSummary.companies], ["Sites", data.businessSummary.sites]]} /></Panel><Panel title="Primary administrator invitation">{data.invitations?.length ? data.invitations.map((invitation: any) => <div key={invitation.id} className="space-y-2"><Rows rows={[["Name", invitation.invited_name], ["Email", invitation.invited_email], ["Status", invitation.status], ["Expires", new Date(invitation.expires_at).toLocaleString()]]} />{["pending", "sent"].includes(invitation.status) && <button type="button" disabled={sending} onClick={() => resend(invitation.id)} className="mt-3 rounded-md bg-slate-950 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{sending ? "Sending..." : "Resend Administrator Invitation"}</button>}</div>) : <p className="text-sm text-slate-500">No administrator invitation found.</p>}{message && <p className="mt-3 text-sm text-slate-600" role="status">{message}</p>}</Panel></div></>}</PlatformShell>;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) { return <section className="rounded-xl border bg-white p-5 shadow-sm"><h2 className="mb-4 text-lg font-semibold">{title}</h2>{children}</section>; }
function Rows({ rows }: { rows: Array<[string, React.ReactNode]> }) { return <dl className="space-y-3">{rows.map(([label, value]) => <div key={label} className="flex flex-col gap-1 border-b pb-3 last:border-0 last:pb-0 sm:flex-row sm:justify-between"><dt className="text-sm text-slate-500">{label}</dt><dd className="break-all text-sm font-medium text-slate-800 sm:text-right">{value}</dd></div>)}</dl>; }
