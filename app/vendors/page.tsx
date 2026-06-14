"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { getCurrentUserAccess, can } from "@/lib/accessControl";

type Vendor = {
  id: string;
  vendor_name: string;
  vendor_type: string;
  gstin: string | null;
  pan: string | null;
  aadhaar_cin: string | null;
  pan_aadhaar_link_status: string | null;
  status: string | null;
};

export default function VendorsPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const loadPage = useCallback(async () => {
    setLoading(true);

    const [access, vendorRes] = await Promise.all([
      getCurrentUserAccess(),

      supabase
        .from("vendors")
        .select(`
          id,
          vendor_name,
          vendor_type,
          gstin,
          pan,
          aadhaar_cin,
          pan_aadhaar_link_status,
          status
        `)
        .neq("status", "deleted")
        .order("created_at", { ascending: false }),
    ]);

    setCanEdit(can(access.permissions, "vendors", "edit"));
    setCanDelete(can(access.permissions, "vendors", "delete"));

    if (vendorRes.error) {
      setErrorMessage(vendorRes.error.message);
    } else {
      setVendors(vendorRes.data || []);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    loadPage();
  }, [loadPage]);

  async function deleteVendor(vendor: Vendor) {
    const ok = window.confirm(
      `Delete vendor "${vendor.vendor_name}"? This will remove it from active vendor list.`
    );

    if (!ok) return;

    const { error } = await supabase
      .from("vendors")
      .update({ status: "deleted" })
      .eq("id", vendor.id);

    if (error) {
      alert(error.message);
      return;
    }

    setVendors((prev) => prev.filter((item) => item.id !== vendor.id));
  }

  const filteredVendors = useMemo(() => {
    const value = search.toLowerCase().trim();

    if (!value) return vendors;

    return vendors.filter((vendor) => {
      return [
        vendor.vendor_name,
        vendor.vendor_type,
        vendor.gstin,
        vendor.pan,
        vendor.aadhaar_cin,
        vendor.pan_aadhaar_link_status,
        vendor.status,
      ]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(value));
    });
  }, [search, vendors]);

  if (loading) {
    return <p className="text-gray-500">Loading vendors...</p>;
  }

  if (errorMessage) {
    return (
      <div className="rounded-lg border bg-red-50 p-4 text-red-700">
        Failed to load vendors: {errorMessage}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Vendor Master</h1>
          <p className="text-gray-500">
            Manage contractors, subcontractors, consultants and suppliers.
          </p>
        </div>

        <Link
          href="/vendors/new"
          className="rounded-lg bg-blue-600 px-4 py-2 text-white"
        >
          + Add Vendor
        </Link>
      </div>

      <div className="rounded-lg border bg-white p-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by vendor name, PAN, GSTIN, Aadhaar/CIN, type or status..."
          className="w-full rounded-lg border px-3 py-2"
        />

        <p className="mt-2 text-sm text-gray-500">
          Showing {filteredVendors.length} of {vendors.length} vendors
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-3 text-left">Vendor Name</th>
              <th className="p-3 text-left">Type</th>
              <th className="p-3 text-left">GSTIN</th>
              <th className="p-3 text-left">PAN</th>
              <th className="p-3 text-left">PAN-Aadhaar</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-left">Action</th>
            </tr>
          </thead>

          <tbody>
            {filteredVendors.map((vendor) => (
              <tr key={vendor.id} className="border-t">
                <td className="p-3 font-medium">{vendor.vendor_name}</td>
                <td className="p-3">{vendor.vendor_type}</td>
                <td className="p-3">{vendor.gstin || "-"}</td>
                <td className="p-3">{vendor.pan || "-"}</td>
                <td className="p-3">
                  {vendor.pan_aadhaar_link_status || "Yet to check"}
                </td>
                <td className="p-3">
                  <span
                    className={`rounded px-2 py-1 ${
                      vendor.status === "blocked"
                        ? "bg-red-100 text-red-700"
                        : vendor.status === "inactive"
                        ? "bg-yellow-100 text-yellow-700"
                        : "bg-green-100 text-green-700"
                    }`}
                  >
                    {vendor.status || "active"}
                  </span>
                </td>

                <td className="p-3">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/vendors/${vendor.id}`}
                      className="rounded border px-3 py-1 hover:bg-gray-50"
                    >
                      View
                    </Link>

                    {canEdit && (
                      <Link
                        href={`/vendors/${vendor.id}/edit`}
                        className="inline-flex items-center rounded border px-3 py-1 text-blue-700 hover:bg-blue-50"
                        title="Edit Vendor"
                      >
                        <Pencil className="h-4 w-4" />
                      </Link>
                    )}

                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => deleteVendor(vendor)}
                        className="rounded border border-red-200 px-3 py-1 text-red-600 hover:bg-red-50"
                        title="Delete Vendor"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}

            {filteredVendors.length === 0 && (
              <tr>
                <td className="p-6 text-center text-gray-500" colSpan={7}>
                  No vendors found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
