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
            ? apiFetchWithToken("/api/hr/employees", token)
            : Promise.resolve({ employees: [] }),
        ]);

      if (companyResult.error) throw companyResult.error;
      if (siteResult.error) throw siteResult.error;

      setCompanies(
        (companyResult.data || []).map((company: any) => ({
          id: company.id,
          label: `${company.company_name}${company.company_code ? ` (${company.company_code})` : ""}`,
        }))
      );
      setSites(
        (siteResult.data || []).map((site: any) => ({
          id: site.id,
          label: `${site.site_name}${site.site_code ? ` (${site.site_code})` : ""}`,
          meta: site.company_id,
        }))
      );
      setDepartments(departmentResult.departments || []);
      setDesignations(designationResult.designations || []);
      setEmployees(employeeResult.employees || []);
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
