"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import PlatformShell from "../PlatformShell";
import { supabase } from "@/lib/supabase";

export default function OrganizationsPage() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { void load(); async function load() { const { data: { session } } = await supabase.auth.getSession(); const response = await fetch("/api/platform/overview", { headers: { Authorization: `Bearer ${session?.access_token || ""}` } }); const value = await response.json(); if (!response.ok) setError(value.error || "Unable to load organizations."); else setRows(value.organizations); } }, []);
  return <PlatformShell><div className="mb-8"><p className="text-sm font-semibold text-slate-500">SITEQUBE PLATFORM</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Organizations</h1><p className="mt-2 text-slate-500">Read-only view of SiteQube organizations.</p></div>{error ? <ErrorBox message={error} /> : !rows ? <div className="rounded-xl border bg-white p-8 text-sm text-slate-500">Loading organizations...</div> : <div className="divide-y overflow-hidden rounded-xl border bg-white shadow-sm">{rows.map((org) => <Link key={org.id} href={`/platform/organizations/${org.id}`} className="grid gap-2 px-5 py-4 hover:bg-slate-50 md:grid-cols-[2fr_1fr_1fr_1.5fr] md:items-center"><span className="font-semibold">{org.name}</span><span className="text-sm text-slate-500">{org.code || "—"}</span><span className="text-sm capitalize text-slate-600">{org.status || "Active"}</span><span className="text-sm text-slate-500">{org.domainStatus === "Configured" ? "Domain configured" : "No domain configured"}</span></Link>)}</div>}</PlatformShell>;
}
function ErrorBox({ message }: { message: string }) { return <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">{message}</div>; }
