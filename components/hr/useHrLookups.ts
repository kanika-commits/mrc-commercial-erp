"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getAllowedOrganizationIds } from "@/lib/clientOrganizationScope";
import { useAccessContext } from "@/components/AccessContext";
import type { HrDepartment, HrDesignation, HrEmployee, LookupOption } from "@/types/hr";
import { apiFetchWithToken, getAccessToken } from "./hrClient";

type HrLookupOptions = {
  includeEmployees?: boolean;
};

type LookupState = {
  companies: LookupOption[];
  sites: LookupOption[];
  departments: HrDepartment[];
  designations: HrDesignation[];
  employees: HrEmployee[];
};

const LOOKUP_CACHE_TTL_MS = 60 * 1000;
const lookupCache = new Map<string, { expiresAt: number; value: LookupState }>();

export function useHrLookups(options: HrLookupOptions = {}) {
  const includeEmployees = options.includeEmployees ?? true;
  const { access, loading: accessLoading } = useAccessContext();
  const [companies, setCompanies] = useState<LookupOption[]>([]);
  const [sites, setSites] = useState<LookupOption[]>([]);
  const [departments, setDepartments] = useState<HrDepartment[]>([]);
  const [designations, setDesignations] = useState<HrDesignation[]>([]);
  const [employees, setEmployees] = useState<HrEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (accessLoading || !access) return;
    setLoading(true);
    setError("");
    try {
      const cacheKey = [
        access.user?.id || "anonymous",
        includeEmployees ? "with-employees" : "without-employees",
        access.organizations.join(","),
        access.companies.join(","),
        access.sites.join(","),
      ].join("|");
      const cached = lookupCache.get(cacheKey);

      if (cached && cached.expiresAt > Date.now()) {
        setCompanies(cached.value.companies);
        setSites(cached.value.sites);
        setDepartments(cached.value.departments);
        setDesignations(cached.value.designations);
        setEmployees(cached.value.employees);
        setLoading(false);
        return;
      }

      const token = await getAccessToken();
      const allowedOrganizationIds = getAllowedOrganizationIds(access);
      let companyQuery = supabase
        .from("companies")
        .select("id, company_name, company_code, organization_id")
        .eq("status", "active")
        .order("company_name");
      let siteQuery = supabase
        .from("sites")
        .select("id, site_name, site_code, company_id, organization_id")
        .eq("status", "active")
        .order("site_name");

      if (allowedOrganizationIds) {
        companyQuery = companyQuery.in("organization_id", allowedOrganizationIds);
        siteQuery = siteQuery.in("organization_id", allowedOrganizationIds);
      }

      const [companyResult, siteResult, departmentResult, designationResult, employeeResult] =
        await Promise.all([
          companyQuery,
          siteQuery,
          apiFetchWithToken("/api/hr/departments", token),
          apiFetchWithToken("/api/hr/designations", token),
          includeEmployees
            ? apiFetchWithToken("/api/hr/employees?lookup=1&status=active", token)
            : Promise.resolve({ employees: [] }),
        ]);

      if (companyResult.error) throw companyResult.error;
      if (siteResult.error) throw siteResult.error;

      const nextCompanies = (companyResult.data || []).map((company: any) => ({
          id: company.id,
          label: `${company.company_name}${company.company_code ? ` (${company.company_code})` : ""}`,
        }));
      const nextSites = (siteResult.data || []).map((site: any) => ({
          id: site.id,
          label: `${site.site_name}${site.site_code ? ` (${site.site_code})` : ""}`,
          meta: site.company_id,
        }));
      const nextDepartments = departmentResult.departments || [];
      const nextDesignations = designationResult.designations || [];
      const nextEmployees = employeeResult.employees || [];

      const nextValue = {
        companies: nextCompanies,
        sites: nextSites,
        departments: nextDepartments,
        designations: nextDesignations,
        employees: nextEmployees,
      };

      lookupCache.set(cacheKey, {
        expiresAt: Date.now() + LOOKUP_CACHE_TTL_MS,
        value: nextValue,
      });

      setCompanies(nextCompanies);
      setSites(nextSites);
      setDepartments(nextDepartments);
      setDesignations(nextDesignations);
      setEmployees(nextEmployees);
    } catch (err: any) {
      setError(err.message || "Failed to load HR lookup data.");
    } finally {
      setLoading(false);
    }
  }, [access, accessLoading, includeEmployees]);

  useEffect(() => {
    load();
  }, [load]);

  return {
    companies,
    sites,
    departments,
    designations,
    employees,
    loading,
    error,
    reload: load,
  };
}
