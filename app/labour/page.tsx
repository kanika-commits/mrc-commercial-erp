"use client";

import Link from "next/link";
import { ArrowRight, CalendarCheck2, Clock3, Settings, Tags, UserRoundCog, UsersRound } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { can, hasGlobalAccess } from "@/lib/accessControl";
import { useAccessContext } from "@/components/AccessContext";
import { supabase } from "@/lib/supabase";
import {
  clearSelectedLabourContext,
  readSelectedLabourContext,
  writeLabourWorkspaceSummary,
  writeSelectedLabourContext,
} from "@/lib/labour/attendanceSystemContext";

const cards = [
  { title: "Labour Categories", href: "/labour/trades", module: "labour_trades", description: "Maintain labour category values for deployments, attendance and wages.", icon: Tags },
  { title: "Attendance Policy", href: "/labour/settings", module: "labour_attendance_policy", description: "Configure site cutoffs, photo rules and automatic lock behavior.", icon: Settings },
  { title: "Labour Registration", href: "/labour/workers", module: "labour_workers", description: "Register new labour and manage current site assignments.", icon: UsersRound },
  { title: "Standard Attendance", href: "/labour/attendance/daily", module: "labour_attendance", description: "Enter First Half, Second Half, OT and remarks directly.", icon: CalendarCheck2, workflow: "standard" },
  { title: "Site-In", href: "/labour/site-in", module: "labour_site_in", description: "Mark labourers IN as they reach the site for the working day.", icon: Clock3, workflow: "site_in_engineer" },
  { title: "Engineer Daily Labour", href: "/labour/engineer-daily", module: "labour_engineer_daily", description: "Mark assigned labour attendance, bonus hours and daily work.", icon: UserRoundCog, workflow: "site_in_engineer" },
];

const sections = [
  {
    title: "Labour Setup",
    description: "Configure categories and attendance policy before daily operations begin.",
    cards: ["Labour Categories", "Attendance Policy"],
  },
  {
    title: "Daily Operations",
    description: "Used every day by Site HR, Project Managers and Site Engineers.",
    cards: ["Labour Registration", "Standard Attendance", "Site-In", "Engineer Daily Labour"],
    primary: true,
  },
];

function LabourCard({ card }: { card: (typeof cards)[number] }) {
  const Icon = card.icon;
  return (
    <Link key={card.href} href={card.href} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="mb-5 flex items-start justify-between">
        <span className="rounded-lg bg-slate-950 p-3 text-white"><Icon className="h-5 w-5" /></span>
        <ArrowRight className="h-5 w-5 text-slate-400" />
      </div>
      <h2 className="text-lg font-semibold">{card.title}</h2>
      <p className="mt-1 text-sm text-slate-600">{card.description}</p>
    </Link>
  );
}

export default function LabourDashboardPage() {
  const { access, loading } = useAccessContext();
  const permissions = access?.permissions || [];
  const global = hasGlobalAccess(access);
  const [lookups, setLookups] = useState<any>({ companies: [], sites: [] });
  const [filters, setFilters] = useState({ company_id: "", site_id: "" });
  const [policy, setPolicy] = useState<any>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [message, setMessage] = useState("");
  const requestRef = useRef(0);
  const initialContextCheckedRef = useRef(false);
  const filteredSites = useMemo(() => lookups.sites || [], [lookups.sites]);
  const policyValue = policy?.value || null;
  const visible = cards.filter((card) => global || can(permissions, card.module, "view"));

  async function token() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || "";
  }

  async function loadWorkflowContext() {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
      setLookupLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams({ purpose: "labour_workspace" });
      if (filters.company_id) params.set("company_id", filters.company_id);
      if (filters.site_id) params.set("site_id", filters.site_id);
      const response = await fetch(`/api/labour/lookups?${params.toString()}`, { headers: { Authorization: `Bearer ${await token()}` } });
      const payload = await response.json();
      if (requestId !== requestRef.current) return;
      if (!response.ok) {
        setMessage(payload.error || "Could not load Labour workflow context.");
        return;
      }
      const pairs = Array.isArray(payload.company_site_pairs) ? payload.company_site_pairs : [];
      writeLabourWorkspaceSummary({
        pairs: pairs.map((pair: any) => ({
          organization_id: String(pair.organization_id || ""),
          company_id: String(pair.company_id || ""),
          site_id: String(pair.site_id || ""),
          attendance_system: pair.attendance_system || "unconfigured",
          company_name: pair.company_name || null,
          site_name: pair.site_name || null,
          site_code: pair.site_code || null,
        })).filter((pair: any) => pair.organization_id && pair.company_id && pair.site_id),
        attendance_systems: Array.from(new Set(pairs.map((pair: any) => pair.attendance_system).filter((value: any) => value === "standard" || value === "site_in_engineer" || value === "unconfigured"))),
      });
      setLookups({ companies: payload.companies || [], sites: payload.sites || [], company_site_pairs: pairs });
      const selectedSite = (payload.sites || []).find((site: any) => site.id === filters.site_id || site.site_id === filters.site_id);
      const selectedPair = selectedSite && filters.company_id
        ? pairs.find((pair: any) => pair.company_id === filters.company_id && pair.site_id === filters.site_id)
        : null;
      const selectedPolicy = selectedSite || selectedPair;
      setPolicy(selectedPolicy
        ? {
          status: selectedPolicy.attendance_system === "unconfigured" ? "missing_configuration" : "configured",
          value: selectedPolicy.attendance_system === "unconfigured" ? null : selectedPolicy.attendance_system,
          message: selectedPolicy.attendance_system === "unconfigured" ? "Attendance system is not configured for this site." : null,
        }
        : null);
      if (!initialContextCheckedRef.current) {
        initialContextCheckedRef.current = true;
        const stored = readSelectedLabourContext();
        const storedPair = stored
          ? pairs.find((pair: any) => pair.organization_id === stored.organization_id && pair.company_id === stored.company_id && pair.site_id === stored.site_id)
          : null;
        const nextPair = pairs.length === 1 ? pairs[0] : storedPair;
        if (nextPair) {
          setFilters({ company_id: nextPair.company_id, site_id: nextPair.site_id });
          writeSelectedLabourContext({
            organization_id: nextPair.organization_id,
            company_id: nextPair.company_id,
            site_id: nextPair.site_id,
            attendance_system: nextPair.attendance_system || "unconfigured",
          });
        } else if (stored) {
          clearSelectedLabourContext();
        }
      }
      setFilters((current) => {
        const companyValid = !current.company_id || (payload.companies || []).some((company: any) => company.id === current.company_id);
        const siteValid = !current.site_id || (payload.sites || []).some((site: any) => site.id === current.site_id || site.site_id === current.site_id);
        return { ...current, company_id: companyValid ? current.company_id : "", site_id: siteValid ? current.site_id : "" };
      });
    } catch (error: any) {
      setMessage(error.message || "Could not load Labour workflow context.");
    } finally {
      if (requestId === requestRef.current) setLookupLoading(false);
    }
  }

  function visibleForPolicy(card: (typeof cards)[number]) {
    if (card.title === "Labour Registration") return true;
    if (card.workflow === "standard") return policyValue === "standard";
    if (card.workflow === "site_in_engineer") return policyValue === "site_in_engineer";
    return true;
  }

  useEffect(() => { loadWorkflowContext(); }, [filters.company_id, filters.site_id]);
  useEffect(() => {
    if (!filters.company_id || !filters.site_id) return;
    const selectedPair = (lookups.company_site_pairs || []).find((pair: any) => pair.company_id === filters.company_id && pair.site_id === filters.site_id);
    if (!selectedPair) return;
    writeSelectedLabourContext({
      organization_id: selectedPair.organization_id,
      company_id: selectedPair.company_id,
      site_id: selectedPair.site_id,
      attendance_system: selectedPair.attendance_system || "unconfigured",
    });
  }, [filters.company_id, filters.site_id, lookups.company_site_pairs]);
  useEffect(() => {
    if (!filters.site_id && filteredSites.length === 1) setFilters((current) => ({ ...current, site_id: filteredSites[0].id }));
  }, [filteredSites, filters.site_id]);

  if (loading) return <section className="p-8 text-sm text-slate-500">Loading labour module...</section>;

  return (
    <section className="min-h-screen bg-[#f6f3f5] px-6 py-7 text-slate-950 md:px-10">
      <div className="mx-auto max-w-[1400px] space-y-6">
        <header>
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-sky-600">Labour Management</p>
          <h1 className="text-3xl font-semibold">Labour Management</h1>
          <p className="text-sm text-slate-600">Operational labourers, attendance, daily work, categories and attendance policy.</p>
        </header>
        <div className="grid gap-3 rounded-lg border bg-white p-4 shadow-sm md:grid-cols-[1fr_1fr_2fr]">
          <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Company
            <select disabled={lookupLoading} value={filters.company_id} onChange={(event) => {
              setPolicy(null);
              clearSelectedLabourContext();
              setFilters((current) => ({ ...current, company_id: event.target.value }));
            }} className="mt-1 h-11 w-full rounded-lg border px-3 text-sm font-normal normal-case tracking-normal text-slate-950 disabled:bg-slate-100">
              <option value="">All Companies</option>
              {lookups.companies.map((company: any) => <option key={company.id} value={company.id}>{company.company_name}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Site
            <select disabled={lookupLoading} value={filters.site_id} onChange={(event) => {
              setPolicy(null);
              clearSelectedLabourContext();
              setFilters((current) => ({ ...current, site_id: event.target.value }));
            }} className="mt-1 h-11 w-full rounded-lg border px-3 text-sm font-normal normal-case tracking-normal text-slate-950 disabled:bg-slate-100">
              <option value="">Select Site</option>
              {filteredSites.map((site: any) => <option key={site.id} value={site.id}>{site.site_name}</option>)}
            </select>
          </label>
          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Attendance Workflow</p>
            {!filters.company_id || !filters.site_id ? (
              <p className="mt-1 text-slate-600">Select a Company and Site to view the applicable attendance workflow.</p>
            ) : policyValue === "standard" ? (
              <p className="mt-1 font-semibold text-emerald-700">Attendance System 1 — Standard Labour Attendance</p>
            ) : policyValue === "site_in_engineer" ? (
              <p className="mt-1 font-semibold text-emerald-700">Attendance System 2 — Site-In & Engineer Workflow</p>
            ) : (
              <p className="mt-1 font-semibold text-amber-700">Attendance system is not configured for this site.</p>
            )}
          </div>
        </div>
        {message && <div className="rounded-lg border bg-white p-3 text-sm font-semibold text-amber-700">{message}</div>}
        <div className="space-y-10">
          {sections.map((section) => {
            const sectionCards = section.cards
              .map((title) => visible.find((card) => card.title === title))
              .filter((card) => card && (!section.primary || visibleForPolicy(card)))
              .filter(Boolean) as typeof cards;
            if (!sectionCards.length) return null;
            return (
              <section key={section.title} className={section.primary ? "rounded-xl border border-sky-100 bg-sky-50/50 p-4 md:p-5" : ""}>
                <div className="mb-4">
                  <h2 className="text-xs font-bold uppercase tracking-[0.24em] text-slate-500">{section.title}</h2>
                  <p className="mt-1 text-sm text-slate-600">{section.description}</p>
                </div>
                {section.primary && filters.company_id && filters.site_id && !policyValue && (
                  <div className="rounded-lg border border-dashed bg-white p-5 text-sm text-amber-700">
                    Attendance system is not configured for this site. Authorised users can update this in Muster Configuration.
                  </div>
                )}
                <div className="grid gap-4 md:grid-cols-3">
                  {sectionCards.map((card) => <LabourCard key={card.href} card={card} />)}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </section>
  );
}
