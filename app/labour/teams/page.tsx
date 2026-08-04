"use client";

import { Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { can, hasGlobalAccess } from "@/lib/accessControl";
import { useAccessContext } from "@/components/AccessContext";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function formatTime(value?: string | null) {
  if (!value) return "-";
  const [hourText, minuteText] = value.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return value;
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

async function token() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || "";
}

async function parsePayload(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

export default function LabourTemporaryTeamsPage() {
  const { access } = useAccessContext();
  const permissions = access?.permissions || [];
  const global = hasGlobalAccess(access);
  const canCreate = global || can(permissions, "labour_engineer_groups", "create");
  const canEdit = global || can(permissions, "labour_engineer_groups", "edit");
  const canDelete = global || can(permissions, "labour_engineer_groups", "delete");
  const [lookups, setLookups] = useState<any>({ companies: [], sites: [], engineers: [] });
  const [filters, setFilters] = useState({ company_id: "", site_id: "", work_date: today(), engineer_employee_id: "" });
  const [teams, setTeams] = useState<any[]>([]);
  const [unassigned, setUnassigned] = useState<any[]>([]);
  const [currentEngineer, setCurrentEngineer] = useState<any>(null);
  const [adminMode, setAdminMode] = useState(false);
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<string[]>([]);
  const [teamName, setTeamName] = useState("");
  const [renaming, setRenaming] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const filteredSites = useMemo(() => lookups.sites || [], [lookups.sites]);

  async function loadTeams() {
    if (loading) return;
    setMessage("");
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.company_id) params.set("company_id", filters.company_id);
      if (filters.site_id) params.set("site_id", filters.site_id);
      if (filters.work_date) params.set("work_date", filters.work_date);
      if (filters.engineer_employee_id) params.set("engineer_employee_id", filters.engineer_employee_id);
      const response = await fetch(`/api/labour/teams?${params.toString()}`, {
        headers: { Authorization: `Bearer ${await token()}` },
      });
      const payload = await parsePayload(response);
      if (!response.ok) {
        setTeams([]);
        setUnassigned([]);
        return setMessage(payload.error || "Could not load temporary teams.");
      }
      setLookups({ companies: payload.companies || [], sites: payload.sites || [], engineers: payload.engineers || [] });
      setTeams(payload.teams || []);
      setUnassigned(payload.unassigned_labour || []);
      setCurrentEngineer(payload.current_engineer || null);
      setAdminMode(Boolean(payload.admin_mode));
      setSelectedWorkerIds([]);
      if (!payload.admin_mode && payload.current_engineer?.id) {
        setFilters((current) => ({ ...current, engineer_employee_id: payload.current_engineer.id }));
      }
    } catch (error: any) {
      setMessage(error.message || "Could not load temporary teams.");
    } finally {
      setLoading(false);
    }
  }

  async function createTeam() {
    if (!canCreate || saving) return;
    if (!filters.company_id) return setMessage("Select a company.");
    if (!filters.site_id) return setMessage("Select a site.");
    if (!filters.work_date) return setMessage("Select a date.");
    if (adminMode && !filters.engineer_employee_id) return setMessage("Select an engineer.");
    if (!selectedWorkerIds.length) return setMessage("Select at least one labourer.");
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/labour/teams", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({
          company_id: filters.company_id,
          site_id: filters.site_id,
          work_date: filters.work_date,
          engineer_employee_id: filters.engineer_employee_id,
          team_name: teamName,
          labour_worker_ids: selectedWorkerIds,
        }),
      });
      const payload = await parsePayload(response);
      if (!response.ok) return setMessage(payload.error || "Could not create temporary team.");
      setTeamName("");
      setMessage(`${payload.team_name || "Temporary team"} created with ${payload.members || 0} member${payload.members === 1 ? "" : "s"}.`);
      await loadTeams();
    } catch (error: any) {
      setMessage(error.message || "Could not create temporary team.");
    } finally {
      setSaving(false);
    }
  }

  async function patchTeam(teamId: string, body: any, success: string) {
    if (saving) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/labour/teams/${teamId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", Authorization: `Bearer ${await token()}` },
        body: JSON.stringify(body),
      });
      const payload = await parsePayload(response);
      if (!response.ok) return setMessage(payload.error || "Could not update temporary team.");
      setMessage(success);
      await loadTeams();
    } catch (error: any) {
      setMessage(error.message || "Could not update temporary team.");
    } finally {
      setSaving(false);
    }
  }

  function toggleWorker(workerId: string, checked: boolean) {
    setSelectedWorkerIds((current) => checked ? [...current, workerId] : current.filter((id) => id !== workerId));
  }

  useEffect(() => { loadTeams(); }, []);

  return (
    <section className="min-h-screen bg-[#f6f3f5] px-6 py-7 text-slate-950 md:px-10">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <header>
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-sky-600">Labour Operations</p>
          <h1 className="text-3xl font-semibold">Temporary Teams</h1>
          <p className="text-sm text-slate-600">Engineers organise their assigned Site-In labourers into daily temporary teams.</p>
        </header>

        {message && <div className="rounded-lg border bg-white p-3 text-sm font-semibold">{message}</div>}

        <div className="grid gap-3 rounded-lg border bg-white p-4 shadow-sm md:grid-cols-5">
          <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Company
            <select disabled={loading || saving} value={filters.company_id} onChange={(event) => setFilters({ ...filters, company_id: event.target.value })} className="mt-1 h-11 w-full rounded-lg border px-3 text-sm font-normal normal-case tracking-normal text-slate-950 disabled:bg-slate-100">
              <option value="">Company</option>
              {lookups.companies.map((company: any) => <option key={company.id} value={company.id}>{company.company_name}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Site
            <select disabled={loading || saving} value={filters.site_id} onChange={(event) => setFilters({ ...filters, site_id: event.target.value })} className="mt-1 h-11 w-full rounded-lg border px-3 text-sm font-normal normal-case tracking-normal text-slate-950 disabled:bg-slate-100">
              <option value="">Site</option>
              {filteredSites.map((site: any) => <option key={site.id} value={site.id}>{site.site_name}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Date
            <input disabled={loading || saving} type="date" value={filters.work_date} onChange={(event) => setFilters({ ...filters, work_date: event.target.value })} className="mt-1 h-11 w-full rounded-lg border px-3 text-sm font-normal normal-case tracking-normal text-slate-950 disabled:bg-slate-100" />
          </label>
          {adminMode ? (
            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Engineer
              <select disabled={loading || saving} value={filters.engineer_employee_id} onChange={(event) => setFilters({ ...filters, engineer_employee_id: event.target.value })} className="mt-1 h-11 w-full rounded-lg border px-3 text-sm font-normal normal-case tracking-normal text-slate-950 disabled:bg-slate-100">
                <option value="">Select Engineer</option>
                {lookups.engineers.map((engineer: any) => <option key={engineer.id} value={engineer.id}>{engineer.label}{engineer.has_erp_login ? "" : " (No ERP login)"}</option>)}
              </select>
            </label>
          ) : (
            <div className="rounded-lg bg-slate-50 p-3 text-sm">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Engineer</p>
              <p className="mt-1 font-semibold">{currentEngineer?.label || "Resolved after load"}</p>
            </div>
          )}
          <button type="button" onClick={loadTeams} disabled={loading || saving} className="inline-flex h-11 items-center justify-center gap-2 self-end rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-60">
            <RefreshCw className="h-4 w-4" />
            {loading ? "Loading..." : "Load Teams"}
          </button>
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(360px,0.9fr)_minmax(520px,1.1fr)]">
          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Unassigned Labour</h2>
                <p className="text-sm text-slate-600">{unassigned.length} assigned Site-In labourer{unassigned.length === 1 ? "" : "s"} available.</p>
              </div>
              <div className="text-sm font-semibold text-slate-700">{selectedWorkerIds.length} selected</div>
            </div>
            <div className="mt-4 max-h-[520px] overflow-auto rounded-lg border">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>{["", "Labour", "Contractor", "Category", "Rate", "Site-In"].map((heading) => <th key={heading} className="px-3 py-3">{heading}</th>)}</tr>
                </thead>
                <tbody className="divide-y">
                  {unassigned.map((row: any) => (
                    <tr key={row.labour_worker_id}>
                      <td className="px-3 py-3">
                        <input type="checkbox" checked={selectedWorkerIds.includes(row.labour_worker_id)} disabled={saving} onChange={(event) => toggleWorker(row.labour_worker_id, event.target.checked)} className="h-4 w-4 rounded border-slate-300" aria-label={`Select ${row.worker_name || row.labour_code || "labourer"}`} />
                      </td>
                      <td className="px-3 py-3">
                        <p className="font-semibold">{row.worker_name || "-"}</p>
                        <p className="font-mono text-xs text-slate-500">{row.labour_code || "-"}</p>
                      </td>
                      <td className="px-3 py-3">{row.contractor_name || "-"}</td>
                      <td className="px-3 py-3">{row.category_name || "-"}</td>
                      <td className="px-3 py-3 font-semibold">{row.daily_rate_label || "Not Set"}</td>
                      <td className="px-3 py-3">{formatTime(row.site_in_time)}</td>
                    </tr>
                  ))}
                  {!unassigned.length && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">No unassigned Site-In labour for this engineer/date.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="min-w-[220px] flex-1 text-xs font-bold uppercase tracking-wide text-slate-500">
                Team Name
                <input value={teamName} onChange={(event) => setTeamName(event.target.value)} placeholder="Auto: Team 1" className="mt-1 h-11 w-full rounded-lg border px-3 text-sm font-normal normal-case tracking-normal text-slate-950" />
              </label>
              <button type="button" onClick={createTeam} disabled={!canCreate || saving || !selectedWorkerIds.length} className="inline-flex h-11 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white disabled:opacity-60">
                <Plus className="h-4 w-4" />
                Create Team
              </button>
            </div>
          </div>

          <div className="space-y-4">
            {teams.map((team: any) => (
              <div key={team.id} className="rounded-lg border bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Team {team.group_number || "-"}</p>
                    <h2 className="text-lg font-semibold">{team.team_name || team.group_label || team.crew_name || "Temporary Team"}</h2>
                    <p className="text-sm text-slate-600">{team.engineer_label || "Engineer"} · {team.members?.length || 0} member{team.members?.length === 1 ? "" : "s"}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canEdit && (
                      <button type="button" onClick={() => patchTeam(team.id, { action: "rename", team_name: renaming[team.id] || team.team_name }, "Team renamed.")} disabled={saving} className="min-h-10 rounded-lg border bg-white px-3 text-sm font-semibold disabled:opacity-60">Rename</button>
                    )}
                    {canDelete && (
                      <button type="button" onClick={() => patchTeam(team.id, { action: "cancel" }, "Team cancelled.")} disabled={saving} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-700 disabled:opacity-60">
                        <Trash2 className="h-4 w-4" />
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
                {canEdit && (
                  <input value={renaming[team.id] ?? team.team_name ?? ""} onChange={(event) => setRenaming((current) => ({ ...current, [team.id]: event.target.value }))} className="mt-3 h-10 w-full rounded-lg border px-3 text-sm" aria-label="Team name" />
                )}
                <div className="mt-4 overflow-x-auto rounded-lg border">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                      <tr>{["Labour", "Contractor", "Category", "Site-In", "Action"].map((heading) => <th key={heading} className="px-3 py-3">{heading}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y">
                      {(team.members || []).map((member: any) => (
                        <tr key={member.id}>
                          <td className="px-3 py-3">
                            <p className="font-semibold">{member.worker_name || "-"}</p>
                            <p className="font-mono text-xs text-slate-500">{member.labour_code || "-"}</p>
                          </td>
                          <td className="px-3 py-3">{member.contractor_name || "-"}</td>
                          <td className="px-3 py-3">{member.category_name || "-"}</td>
                          <td className="px-3 py-3">{formatTime(member.site_in_time)}</td>
                          <td className="px-3 py-3">
                            {canEdit && (
                              <button type="button" onClick={() => patchTeam(team.id, { action: "remove_members", labour_worker_ids: [member.labour_worker_id] }, "Member removed from team.")} disabled={saving} className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-red-200 bg-red-50 text-red-700 disabled:opacity-60" aria-label="Remove team member">
                                <X className="h-4 w-4" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                      {!(team.members || []).length && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500">No members in this team.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
            {!teams.length && <div className="rounded-lg border border-dashed bg-white p-8 text-center text-sm text-slate-500">No temporary teams for this engineer/date yet.</div>}
          </div>
        </div>
      </div>
    </section>
  );
}
