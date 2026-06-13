"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Company = {
  id: string;
  organization_id: string;
  company_name: string;
  company_code: string;
  status: string;
  created_at: string;
};

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadCompanies();
  }, []);

  async function loadCompanies() {
    setLoading(true);
    setMessage("");

    const { data, error } = await supabase
      .from("companies")
      .select("id, organization_id, company_name, company_code, status, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      setMessage(error.message);
      setLoading(false);
      return;
    }

    setCompanies(data || []);
    setLoading(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Companies</h1>
          <p className="text-gray-500">Manage MRC group companies.</p>
        </div>

        <Link href="/companies/new" className="rounded-lg bg-blue-600 px-4 py-2 text-white">
          Add Company
        </Link>
      </div>

      {message && (
        <div className="rounded-lg border bg-yellow-50 p-3 text-sm text-yellow-800">
          {message}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-3 text-left">Company Name</th>
              <th className="p-3 text-left">Company Code</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-left">Created At</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td className="p-3" colSpan={4}>
                  Loading...
                </td>
              </tr>
            ) : companies.length === 0 ? (
              <tr>
                <td className="p-3" colSpan={4}>
                  No companies found.
                </td>
              </tr>
            ) : (
              companies.map((company) => (
                <tr key={company.id} className="border-t">
                  <td className="p-3 font-medium">{company.company_name}</td>
                  <td className="p-3">{company.company_code}</td>
                  <td className="p-3">{company.status}</td>
                  <td className="p-3">
                    {new Date(company.created_at).toLocaleDateString("en-IN")}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}