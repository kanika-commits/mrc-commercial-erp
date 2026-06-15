"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Filter,
  Pencil,
  Search,
  ShieldCheck,
  Trash2,
  UserRoundPlus,
  Users,
  XCircle,
} from "lucide-react";
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
  created_at: string | null;
};

export default function VendorsPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [canAdd, setCanAdd] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [complianceFilter, setComplianceFilter] = useState("all");
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
          status,
          created_at
        `)
        .neq("status", "deleted")
        .order("created_at", { ascending: false }),
    ]);

    setCanAdd(can(access.permissions, "vendors", "add"));
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

    return vendors.filter((vendor) => {
      const matchesSearch =
        !value ||
        [
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

      const matchesType =
        typeFilter === "all" || normalize(vendor.vendor_type) === typeFilter;
      const matchesStatus =
        statusFilter === "all" || normalize(vendor.status || "active") === statusFilter;
      const matchesCompliance =
        complianceFilter === "all" ||
        getComplianceState(vendor) === complianceFilter;

      return matchesSearch && matchesType && matchesStatus && matchesCompliance;
    });
  }, [complianceFilter, search, statusFilter, typeFilter, vendors]);

  const vendorTypes = useMemo(() => {
    return Array.from(
      new Set(vendors.map((vendor) => vendor.vendor_type).filter(Boolean))
    ).sort();
  }, [vendors]);

  const totalVendors = vendors.length;
  const activeVendors = vendors.filter(
    (vendor) => normalize(vendor.status || "active") === "active"
  ).length;
  const pendingPanAadhaar = vendors.filter((vendor) => !isPanAadhaarVerified(vendor)).length;
  const missingTaxIds = vendors.filter((vendor) => !vendor.gstin || !vendor.pan).length;

  function clearFilters() {
    setSearch("");
    setTypeFilter("all");
    setStatusFilter("all");
    setComplianceFilter("all");
  }

  if (loading) {
    return (
      <section className="min-h-[60vh] bg-[#f8fafc] p-8 text-sm font-medium text-slate-500">
        Loading vendors...
      </section>
    );
  }

  if (errorMessage) {
    return (
      <div className="rounded-lg border bg-red-50 p-4 text-red-700">
        Failed to load vendors: {errorMessage}
      </div>
    );
  }

  return (
    <section className="min-h-screen bg-[#f8fafc] p-6 text-slate-950 md:p-8">
      <div className="mx-auto max-w-[1600px] space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Master Setup
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
            Vendor Directory
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Manage contractors, suppliers, consultants, labour contractors and
            vendors across all projects.
          </p>
        </div>

        {canAdd && (
          <Link
            href="/vendors/new"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#00658b] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-95"
          >
            <UserRoundPlus className="h-4 w-4" />
            Add Vendor
          </Link>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Total Vendors"
          value={String(totalVendors)}
          icon={Users}
          tone="slate"
        />
        <KpiCard
          label="Active Vendors"
          value={String(activeVendors)}
          icon={CheckCircle2}
          tone="green"
        />
        <KpiCard
          label="Pending PAN-Aadhaar"
          value={String(pendingPanAadhaar)}
          icon={AlertTriangle}
          tone="amber"
        />
        <KpiCard
          label="Missing GST/PAN"
          value={String(missingTaxIds)}
          icon={XCircle}
          tone="red"
        />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search vendor name, PAN, GSTIN, Aadhaar/CIN, type or status..."
              className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none transition focus:border-[#00658b] focus:bg-white focus:ring-2 focus:ring-[#00658b]/10"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-4 w-4 text-slate-400" />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-[#00658b]"
            >
              <option value="all">Vendor Type: All</option>
              {vendorTypes.map((type) => (
                <option key={type} value={normalize(type)}>
                  {type}
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-[#00658b]"
            >
              <option value="all">Status: All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="blocked">Blocked</option>
              <option value="pending">Pending</option>
            </select>

            <select
              value={complianceFilter}
              onChange={(e) => setComplianceFilter(e.target.value)}
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-[#00658b]"
            >
              <option value="all">Compliance: All</option>
              <option value="verified">Verified</option>
              <option value="pending">Pending</option>
              <option value="review">Review</option>
            </select>

            <button
              type="button"
              onClick={clearFilters}
              className="h-10 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
            >
              Clear Filters
            </button>
          </div>
        </div>

        <p className="mt-3 text-xs font-medium text-slate-500">
          Showing {filteredVendors.length} of {vendors.length} vendors
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[1120px] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            <tr>
              <th className="px-4 py-3 text-left">Vendor</th>
              <th className="px-4 py-3 text-left">Vendor Type</th>
              <th className="px-4 py-3 text-left">GSTIN</th>
              <th className="px-4 py-3 text-left">PAN</th>
              <th className="px-4 py-3 text-left">PAN-Aadhaar Status</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Created Date</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100">
            {filteredVendors.map((vendor) => (
              <tr
                key={vendor.id}
                className="group transition-colors hover:bg-slate-50/80"
              >
                <td className="px-4 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-xs font-bold uppercase text-white shadow-sm">
                      {initials(vendor.vendor_name)}
                    </div>
                    <div className="min-w-0">
                      <Link
                        href={`/vendors/${vendor.id}`}
                        className="font-semibold text-slate-950 hover:text-[#00658b]"
                      >
                        {vendor.vendor_name || "-"}
                      </Link>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {vendor.aadhaar_cin ? `Aadhaar/CIN: ${vendor.aadhaar_cin}` : "Vendor master record"}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-4">
                  <TypeBadge value={vendor.vendor_type} />
                </td>
                <td className="px-4 py-4 font-mono text-xs text-slate-600">
                  {vendor.gstin || "-"}
                </td>
                <td className="px-4 py-4 font-mono text-xs text-slate-600">
                  {vendor.pan || "-"}
                </td>
                <td className="px-4 py-4">
                  <ComplianceBadge value={vendor.pan_aadhaar_link_status} />
                </td>
                <td className="px-4 py-4">
                  <StatusBadge value={vendor.status || "active"} />
                </td>
                <td className="px-4 py-4 text-sm text-slate-500">
                  {formatDate(vendor.created_at)}
                </td>
                <td className="px-4 py-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Link
                      href={`/vendors/${vendor.id}`}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-white"
                    >
                      View
                    </Link>

                    {canEdit && (
                      <Link
                        href={`/vendors/${vendor.id}/edit`}
                        className="inline-flex items-center rounded-lg border border-blue-100 px-3 py-1.5 text-blue-700 transition hover:bg-blue-50"
                        title="Edit Vendor"
                      >
                        <Pencil className="h-4 w-4" />
                      </Link>
                    )}

                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => deleteVendor(vendor)}
                        className="rounded-lg border border-red-200 px-3 py-1.5 text-red-600 transition hover:bg-red-50"
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
                <td className="px-6 py-14 text-center" colSpan={8}>
                  <div className="mx-auto max-w-sm">
                    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                      <ShieldCheck className="h-5 w-5" />
                    </div>
                    <h2 className="text-base font-semibold text-slate-950">
                      No vendors found
                    </h2>
                    <p className="mt-2 text-sm text-slate-500">
                      Adjust filters or add a vendor to start building the
                      vendor directory.
                    </p>
                    {canAdd && (
                      <Link
                        href="/vendors/new"
                        className="mt-5 inline-flex items-center justify-center gap-2 rounded-lg bg-[#00658b] px-4 py-2 text-sm font-semibold text-white"
                      >
                        <UserRoundPlus className="h-4 w-4" />
                        Add Vendor
                      </Link>
                    )}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
      </div>
    </section>
  );
}

function normalize(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function initials(name: string) {
  return (name || "Vendor")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function isPanAadhaarVerified(vendor: Vendor) {
  return normalize(vendor.pan_aadhaar_link_status) === "yes";
}

function getComplianceState(vendor: Vendor) {
  const value = normalize(vendor.pan_aadhaar_link_status);
  if (value === "yes") return "verified";
  if (value === "no") return "pending";
  return "review";
}

function KpiCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: any;
  tone: "slate" | "green" | "amber" | "red";
}) {
  const tones = {
    slate: "bg-slate-50 text-slate-700 border-slate-200",
    green: "bg-emerald-50 text-emerald-700 border-emerald-100",
    amber: "bg-amber-50 text-amber-700 border-amber-100",
    red: "bg-red-50 text-red-700 border-red-100",
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          {label}
        </p>
        <div className={`rounded-lg border p-2 ${tones[tone]}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">
        {value}
      </p>
    </div>
  );
}

function TypeBadge({ value }: { value: string | null }) {
  return (
    <span className="inline-flex rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
      {value || "-"}
    </span>
  );
}

function StatusBadge({ value }: { value: string }) {
  const status = normalize(value);
  const className =
    status === "blocked"
      ? "bg-red-50 text-red-700 ring-red-100"
      : status === "inactive"
      ? "bg-slate-100 text-slate-600 ring-slate-200"
      : status === "pending"
      ? "bg-amber-50 text-amber-700 ring-amber-100"
      : "bg-emerald-50 text-emerald-700 ring-emerald-100";

  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold capitalize ring-1 ${className}`}>
      {value || "active"}
    </span>
  );
}

function ComplianceBadge({ value }: { value: string | null }) {
  const state = normalize(value);

  if (state === "yes") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Verified
      </span>
    );
  }

  if (state === "no") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-100">
        <AlertTriangle className="h-3.5 w-3.5" />
        Pending
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
      <ShieldCheck className="h-3.5 w-3.5" />
      Review
    </span>
  );
}
