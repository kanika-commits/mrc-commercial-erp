"use client";

export type LabourAttendanceSystemValue = "standard" | "site_in_engineer" | "unconfigured";

export type SelectedLabourContext = {
  organization_id: string;
  company_id: string;
  site_id: string;
  attendance_system: LabourAttendanceSystemValue;
};

export type LabourWorkspacePair = SelectedLabourContext & {
  company_name?: string | null;
  site_name?: string | null;
  site_code?: string | null;
};

export type LabourWorkspaceSummary = {
  pairs: LabourWorkspacePair[];
  attendance_systems: LabourAttendanceSystemValue[];
};

export const LABOUR_CONTEXT_STORAGE_KEY = "constructiq-labour-context";
export const LABOUR_WORKSPACE_STORAGE_KEY = "constructiq-labour-workspace";
export const LEGACY_LABOUR_WORKFLOW_STORAGE_KEY = "constructiq-labour-attendance-system";
export const LABOUR_CONTEXT_EVENT = "constructiq-labour-context-changed";
export const LABOUR_WORKSPACE_EVENT = "constructiq-labour-workspace-changed";

function normalizeAttendanceSystem(value: unknown): LabourAttendanceSystemValue | null {
  return value === "standard" || value === "site_in_engineer" || value === "unconfigured" ? value : null;
}

export function parseSelectedLabourContext(value: string | null): SelectedLabourContext | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    const attendanceSystem = normalizeAttendanceSystem(parsed?.attendance_system);
    if (!parsed?.organization_id || !parsed?.company_id || !parsed?.site_id || !attendanceSystem) return null;
    return {
      organization_id: String(parsed.organization_id),
      company_id: String(parsed.company_id),
      site_id: String(parsed.site_id),
      attendance_system: attendanceSystem,
    };
  } catch {
    return null;
  }
}

export function readSelectedLabourContext(): SelectedLabourContext | null {
  if (typeof window === "undefined") return null;
  return parseSelectedLabourContext(window.localStorage.getItem(LABOUR_CONTEXT_STORAGE_KEY));
}

export function parseLabourWorkspaceSummary(value: string | null): LabourWorkspaceSummary {
  if (!value) return { pairs: [], attendance_systems: [] };
  try {
    const parsed = JSON.parse(value);
    const pairs = Array.isArray(parsed?.pairs)
      ? parsed.pairs
        .map((row: any) => {
          const attendanceSystem = normalizeAttendanceSystem(row?.attendance_system);
          if (!row?.organization_id || !row?.company_id || !row?.site_id || !attendanceSystem) return null;
          return {
            organization_id: String(row.organization_id),
            company_id: String(row.company_id),
            site_id: String(row.site_id),
            attendance_system: attendanceSystem,
            company_name: row.company_name ? String(row.company_name) : null,
            site_name: row.site_name ? String(row.site_name) : null,
            site_code: row.site_code ? String(row.site_code) : null,
          };
        })
        .filter(Boolean) as LabourWorkspacePair[]
      : [];
    const attendanceSystems = Array.from(new Set(pairs.map((row) => row.attendance_system)));
    return { pairs, attendance_systems: attendanceSystems };
  } catch {
    return { pairs: [], attendance_systems: [] };
  }
}

export function readLabourWorkspaceSummary(): LabourWorkspaceSummary {
  if (typeof window === "undefined") return { pairs: [], attendance_systems: [] };
  return parseLabourWorkspaceSummary(window.localStorage.getItem(LABOUR_WORKSPACE_STORAGE_KEY));
}

export function writeSelectedLabourContext(context: SelectedLabourContext | null) {
  if (typeof window === "undefined") return;
  if (context) {
    window.localStorage.setItem(LABOUR_CONTEXT_STORAGE_KEY, JSON.stringify(context));
  } else {
    window.localStorage.removeItem(LABOUR_CONTEXT_STORAGE_KEY);
  }
  window.localStorage.removeItem(LEGACY_LABOUR_WORKFLOW_STORAGE_KEY);
  window.dispatchEvent(new CustomEvent(LABOUR_CONTEXT_EVENT, { detail: context }));
}

export function writeLabourWorkspaceSummary(summary: LabourWorkspaceSummary | null) {
  if (typeof window === "undefined") return;
  const safeSummary = summary || { pairs: [], attendance_systems: [] };
  window.localStorage.setItem(LABOUR_WORKSPACE_STORAGE_KEY, JSON.stringify(safeSummary));
  window.dispatchEvent(new CustomEvent(LABOUR_WORKSPACE_EVENT, { detail: safeSummary }));
}

export function clearSelectedLabourContext() {
  writeSelectedLabourContext(null);
}

export function subscribeSelectedLabourContext(callback: (context: SelectedLabourContext | null) => void) {
  if (typeof window === "undefined") return () => {};
  const read = () => callback(readSelectedLabourContext());
  const onContextChanged = (event: Event) => {
    callback(event instanceof CustomEvent ? event.detail || null : readSelectedLabourContext());
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === LABOUR_CONTEXT_STORAGE_KEY || event.key === LEGACY_LABOUR_WORKFLOW_STORAGE_KEY) read();
  };
  read();
  window.addEventListener(LABOUR_CONTEXT_EVENT, onContextChanged);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(LABOUR_CONTEXT_EVENT, onContextChanged);
    window.removeEventListener("storage", onStorage);
  };
}

export function subscribeLabourWorkspaceSummary(callback: (summary: LabourWorkspaceSummary) => void) {
  if (typeof window === "undefined") return () => {};
  const read = () => callback(readLabourWorkspaceSummary());
  const onWorkspaceChanged = (event: Event) => {
    callback(event instanceof CustomEvent ? event.detail || { pairs: [], attendance_systems: [] } : readLabourWorkspaceSummary());
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === LABOUR_WORKSPACE_STORAGE_KEY) read();
  };
  read();
  window.addEventListener(LABOUR_WORKSPACE_EVENT, onWorkspaceChanged);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(LABOUR_WORKSPACE_EVENT, onWorkspaceChanged);
    window.removeEventListener("storage", onStorage);
  };
}

export function labourWorkflowForNavigation(
  context: SelectedLabourContext | null,
  summary: LabourWorkspaceSummary | null,
): LabourAttendanceSystemValue | null {
  if (context?.attendance_system) return context.attendance_system;
  const systems = Array.from(new Set((summary?.attendance_systems || []).filter((value) => value === "standard" || value === "site_in_engineer")));
  return systems.length === 1 ? systems[0] : null;
}

export function resolveSingleLabourContext(summary: LabourWorkspaceSummary | null): SelectedLabourContext | null {
  const pairs = summary?.pairs || [];
  if (pairs.length !== 1) return null;
  const pair = pairs[0];
  return {
    organization_id: pair.organization_id,
    company_id: pair.company_id,
    site_id: pair.site_id,
    attendance_system: pair.attendance_system,
  };
}

export function uniqueLabourWorkspaceSiteIds(summary: LabourWorkspaceSummary | null) {
  return Array.from(new Set((summary?.pairs || []).map((pair) => pair.site_id).filter(Boolean)));
}

export function resolveSingleLabourSiteId(summary: LabourWorkspaceSummary | null): string | null {
  const siteIds = uniqueLabourWorkspaceSiteIds(summary);
  return siteIds.length === 1 ? siteIds[0] : null;
}

export function selectedLabourSiteIsValid(siteId: string | null | undefined, summary: LabourWorkspaceSummary | null) {
  if (!siteId) return false;
  return uniqueLabourWorkspaceSiteIds(summary).includes(siteId);
}

export function selectedLabourContextIsValid(
  context: SelectedLabourContext | null,
  summary: LabourWorkspaceSummary | null,
) {
  if (!context) return false;
  return (summary?.pairs || []).some((pair) =>
    pair.organization_id === context.organization_id &&
    pair.company_id === context.company_id &&
    pair.site_id === context.site_id,
  );
}

export function shouldShowLabourWorkspace(summary: LabourWorkspaceSummary | null, hasBroadContextAccess: boolean) {
  if (hasBroadContextAccess) return true;
  const siteIds = uniqueLabourWorkspaceSiteIds(summary);
  return siteIds.length !== 1;
}

export function labourContextFromLookup(input: {
  companyId?: string | null;
  siteId?: string | null;
  companies?: any[];
  attendanceSystem?: any;
}): SelectedLabourContext | null {
  const companyId = input.companyId || "";
  const siteId = input.siteId || "";
  if (!companyId || !siteId || !input.attendanceSystem) return null;
  const company = (input.companies || []).find((row) => row?.id === companyId);
  const organizationId = company?.organization_id;
  if (!organizationId) return null;
  const attendanceSystem = input.attendanceSystem?.value === "standard" || input.attendanceSystem?.value === "site_in_engineer"
    ? input.attendanceSystem.value
    : "unconfigured";
  return {
    organization_id: String(organizationId),
    company_id: companyId,
    site_id: siteId,
    attendance_system: attendanceSystem,
  };
}

export function isLabourRouteAllowedForAttendanceSystem(
  routeOrModuleCode: string | null | undefined,
  attendanceSystem: LabourAttendanceSystemValue | null | undefined,
) {
  const value = String(routeOrModuleCode || "");
  const standardOnly = value === "labour_attendance" || value === "/labour/attendance/daily";
  const systemTwoOnly =
    value === "labour_site_in" ||
    value === "/labour/site-in" ||
    value === "labour_engineer_daily" ||
    value === "/labour/engineer-daily";
  if (standardOnly) return attendanceSystem === "standard";
  if (systemTwoOnly) return attendanceSystem === "site_in_engineer";
  return true;
}
