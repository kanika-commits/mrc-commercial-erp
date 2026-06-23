"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Filter,
  Pencil,
  Search,
  Trash2,
  UserRoundPlus,
  Users,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAccessContext } from "@/components/AccessContext";
import { can } from "@/lib/accessControl";

type Vendor = {
  id: string;
  vendor_name: string;
  vendor_type: string;
  gstin: string | null;
  pan: string | null;
  aadhaar_cin: string | null;
  created_at: string | null;
  contacts?: VendorContact[];
  bank_accounts?: VendorBankAccount[];
};

type VendorContact = {
  id: string;
  vendor_id: string;
  contact_name: string | null;
  contact_number: string | null;
  email: string | null;
  designation?: string | null;
  is_primary?: boolean | null;
};

type VendorBankAccount = {
  id: string;
  vendor_id: string;
  account_number: string | null;
  ifsc_code?: string | null;
  bank_name?: string | null;
  branch_name?: string | null;
  is_primary?: boolean | null;
};

const PAGE_SIZE = 50;

export default function VendorsPage() {
  const { access } = useAccessContext();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [totalVendors, setTotalVendors] = useState(0);
  const [totalFilteredVendors, setTotalFilteredVendors] = useState(0);
  const [vendorTypes, setVendorTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const hasLoadedRef = useRef(false);
  const inFlightKeyRef = useRef("");
  const activeRequestSeqRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const permissions = access?.permissions || [];
  const canAdd = can(permissions, "vendors", "add");
  const canEdit = can(permissions, "vendors", "edit");
  const canDelete = can(permissions, "vendors", "delete");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 450);

    return () => window.clearTimeout(timer);
  }, [search]);

  const requestKey = useMemo(
    () =>
      JSON.stringify({
        page,
        pageSize: PAGE_SIZE,
        search: debouncedSearch,
        typeFilter,
        refreshNonce,
      }),
    [debouncedSearch, page, refreshNonce, typeFilter],
  );

  useEffect(() => {
    if (inFlightKeyRef.current === requestKey) {
      return;
    }

    const abortController = new AbortController();
    abortControllerRef.current?.abort();
    abortControllerRef.current = abortController;
    inFlightKeyRef.current = requestKey;
    const requestSeq = activeRequestSeqRef.current + 1;
    activeRequestSeqRef.current = requestSeq;
    const hasRows = hasLoadedRef.current;

    if (hasRows) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setErrorMessage("");

    async function loadPage() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (abortController.signal.aborted) return;

        if (!session?.access_token) {
          setErrorMessage("Your session expired. Please log in again.");
          setLoading(false);
          setRefreshing(false);
          return;
        }

        const params = new URLSearchParams({
          include_children: "summary",
          page: String(page),
          page_size: String(PAGE_SIZE),
        });

        if (debouncedSearch) {
          params.set("search", debouncedSearch);
        }

        if (typeFilter !== "all") {
          params.set("type_filter", typeFilter);
        }

        const response = await fetch(`/api/vendors?${params.toString()}`, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
          signal: abortController.signal,
        });
        const result = await response.json();

        if (abortController.signal.aborted || activeRequestSeqRef.current !== requestSeq) {
          return;
        }

        if (!response.ok) {
          setErrorMessage(result.error || "Failed to load vendors.");
        } else {
          setVendors(result.vendors || []);
          setTotalFilteredVendors(result.total || 0);
          setTotalVendors(result.total_all || result.total || 0);
          setVendorTypes(result.vendor_types || []);
        }

        setLoading(false);
        setRefreshing(false);
        hasLoadedRef.current = true;
      } catch (error: any) {
        if (error?.name === "AbortError") {
          return;
        }

        if (activeRequestSeqRef.current === requestSeq) {
          setErrorMessage(error.message || "Failed to load vendors.");
          setLoading(false);
          setRefreshing(false);
        }
      } finally {
        if (activeRequestSeqRef.current === requestSeq) {
          inFlightKeyRef.current = "";
        }
      }
    }

    loadPage();

    return () => {
      abortController.abort();
      if (activeRequestSeqRef.current === requestSeq) {
        inFlightKeyRef.current = "";
      }
    };
  }, [debouncedSearch, page, requestKey, typeFilter]);

  async function deleteVendor(vendor: Vendor) {
    const ok = window.confirm(
      `Delete vendor "${vendor.vendor_name}"? This will remove it from active vendor list.`
    );

    if (!ok) return;

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      alert("Your session expired. Please log in again.");
      return;
    }

    const response = await fetch(`/api/vendors/${vendor.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const result = await response.json();

    if (!response.ok) {
      alert(result.error || "Failed to delete vendor.");
      return;
    }

    setVendors((prev) => prev.filter((item) => item.id !== vendor.id));
    setRefreshNonce((value) => value + 1);
  }

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, typeFilter]);

  const totalPages = Math.max(1, Math.ceil(totalFilteredVendors / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const endIndex = Math.min(startIndex + vendors.length, totalFilteredVendors);
  const paginatedVendors = vendors;
  const rangeStart = totalFilteredVendors === 0 ? 0 : startIndex + 1;

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  function clearFilters() {
    setSearch("");
    setTypeFilter("all");
  }

  if (loading && vendors.length === 0) {
    return (
      <section className="min-h-[60vh] bg-[#f8fafc] p-8 text-sm font-medium text-slate-500">
        Loading vendors...
      </section>
    );
  }

  if (errorMessage && vendors.length === 0) {
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
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search vendor name, PAN, GSTIN, Aadhaar/CIN or type..."
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
          Showing {rangeStart}–{endIndex} of {totalFilteredVendors} vendors
          {refreshing ? (
            <span className="ml-2 text-[#00658b]">Updating results...</span>
          ) : null}
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            <tr>
              <th className="px-4 py-3 text-left">Vendor</th>
              <th className="px-4 py-3 text-left">Vendor Type</th>
              <th className="px-4 py-3 text-left">GSTIN</th>
              <th className="px-4 py-3 text-left">PAN</th>
              <th className="px-4 py-3 text-left">Created Date</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100">
            {paginatedVendors.map((vendor) => {
              const contactMatch = getContactMatch(vendor, search);

              return (
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
                          {contactMatch
                            ? `Contact: ${contactMatch.contact_name || "-"}${
                                contactMatch.contact_number
                                  ? ` • ${contactMatch.contact_number}`
                                  : ""
                              }`
                            : vendor.aadhaar_cin
                              ? `Aadhaar/CIN: ${vendor.aadhaar_cin}`
                              : "Vendor master record"}
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
              );
            })}

            {totalFilteredVendors === 0 && (
              <tr>
                <td className="px-6 py-14 text-center" colSpan={6}>
                  <div className="mx-auto max-w-sm">
                    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                      <Users className="h-5 w-5" />
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

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          <div>
            Showing {rangeStart}–{endIndex} of {totalFilteredVendors} vendors
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              disabled={currentPage <= 1}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
              disabled={currentPage >= totalPages}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          </div>
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

function getContactMatch(vendor: Vendor, search: string) {
  const value = search.trim().toLowerCase();
  if (!value) return null;

  return (
    (vendor.contacts || []).find((contact) =>
      [
        contact.contact_name,
        contact.contact_number,
        contact.email,
      ]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(value))
    ) || null
  );
}

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
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
