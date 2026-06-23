"use client";

import Link from "next/link";
import {
  Plus,
} from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAccessContext } from "@/components/AccessContext";
import { can, type CurrentUserAccess } from "@/lib/accessControl";

export default function Home() {
  const { access } = useAccessContext();
  const [permissions, setPermissions] = useState<any[]>([]);

  const [pendingWOApprovals, setPendingWOApprovals] = useState(0);
  const [pendingRA, setPendingRA] = useState(0);
  const [pendingDebitNotes, setPendingDebitNotes] = useState(0);
  const [pendingITC, setPendingITC] = useState(0);
  const [pendingInvoiceApprovals, setPendingInvoiceApprovals] = useState(0);
  const [pendingPayments] = useState(0);

  const [totalVendors, setTotalVendors] = useState(0);
  const [panAadhaarPending, setPanAadhaarPending] = useState(0);
  const [blockedVendors, setBlockedVendors] = useState(0);
  const [inactiveVendors, setInactiveVendors] = useState(0);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (access) {
      loadDashboard(access);
    }
  }, [access]);

  async function loadDashboard(currentAccess: CurrentUserAccess) {
    setLoading(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Your session expired. Please log in again.");
      }

      const notificationCountsPromise = fetch("/api/notifications/counts", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      }).then(async (response) => {
        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error || "Failed to load notification counts.");
        }
        return result;
      });

      const [
        notificationCounts,
      ] = await Promise.all([
        notificationCountsPromise,
      ]);

      setPermissions(currentAccess.permissions || []);

      setPendingWOApprovals(notificationCounts.pendingWorkOrders || 0);
      setPendingRA(notificationCounts.pendingRaBills || 0);
      setPendingDebitNotes(notificationCounts.pendingDebitNotes || 0);
      setPendingITC(notificationCounts.pendingItcReview || 0);
      setPendingInvoiceApprovals(notificationCounts.pendingInvoiceApprovals || 0);

      setTotalVendors(notificationCounts.totalVendors || 0);
      setPanAadhaarPending(notificationCounts.panAadhaarPending || 0);
      setBlockedVendors(notificationCounts.blockedVendors || 0);
      setInactiveVendors(notificationCounts.inactiveVendors || 0);
    } catch (error) {
      console.error("Dashboard load failed:", error);
    } finally {
      setLoading(false);
    }
  }

  const managementCards: [string, string, string][] = [
  ["Total Vendors", String(totalVendors || 0), "/vendors"],
  ["PAN-Aadhaar Pending", String(panAadhaarPending || 0), "/vendors"],
  ["Blocked Vendors", String(blockedVendors || 0), "/vendors"],
  ["Inactive Vendors", String(inactiveVendors || 0), "/vendors"],
];

  const metricCards: MetricCardData[] = [
    {
      label: "Pending Work Order Approvals",
      value: String(pendingWOApprovals),
      href: "/approvals/work-orders",
      accent: "ink",
      status: "Review",
    },
    {
      label: "Pending RA Bill Approvals",
      value: String(pendingRA),
      href: "/approvals",
      accent: "teal",
      status: "In Progress",
    },
    {
      label: "Pending Debit Note Approvals",
      value: String(pendingDebitNotes),
      href: "/approvals",
      accent: "ink",
    },
    {
      label: "Pending Invoices (ITC Review)",
      value: String(pendingITC),
      href: "/invoices/itc",
      accent: "teal",
    },
    {
      label: "Pending Invoice Approval",
      value: String(pendingInvoiceApprovals),
      href: "/invoices",
      accent: "ink",
    },
    {
      label: "Pending Payments",
      value: String(pendingPayments),
      href: "/payments",
      accent: "teal",
    },
  ];

  const approvalRows = [
    {
      id: "WO Queue",
      subtitle: "Work Order Approvals",
      type: "WO",
      value: String(pendingWOApprovals),
      href: "/approvals/work-orders",
    },
    {
      id: "RA Queue",
      subtitle: "Running Account Bills",
      type: "RA Bill",
      value: String(pendingRA),
      href: "/approvals",
    },
    {
      id: "Debit Notes",
      subtitle: "Commercial Adjustments",
      type: "Debit Note",
      value: String(pendingDebitNotes),
      href: "/approvals",
    },
    {
      id: "ITC Review",
      subtitle: "Invoice Compliance",
      type: "Invoice",
      value: String(pendingITC),
      href: "/invoices/itc",
    },
    {
      id: "Work Orders",
      subtitle: "Invoice Approval",
      type: "Invoice",
      value: String(pendingInvoiceApprovals),
      href: "/invoices",
    },
  ];

  const vendorRows = managementCards.map(([label, value, href]) => ({
    label,
    value,
    href,
    status:
      label === "Blocked Vendors"
        ? "Blocked"
        : label === "Inactive Vendors"
        ? "Inactive"
        : label === "PAN-Aadhaar Pending"
        ? "Review"
        : "Active",
  }));

  if (loading) {
    return (
      <div className="min-h-[60vh] bg-[#f3f6f8] p-8 text-sm font-medium text-slate-500">
        Loading dashboard...
      </div>
    );
  }

  return (
    <section className="min-h-screen bg-[#f3f6f8] text-[#111316]">
      <main className="mx-auto max-w-[1180px] px-5 py-9 md:px-10">
            <div className="mb-9 flex flex-wrap items-start justify-between gap-5">
              <div>
                <h1 className="text-4xl font-black tracking-tight text-black">
                  Dashboard Overview
                </h1>
                <p className="mt-2 text-lg font-medium text-slate-600">
                  Real-time enterprise metrics for MRC Commercial ERP
                </p>
              </div>

              <div className="flex items-center gap-3">
                {can(permissions, "vendors", "add") && (
                  <Button asChild className="h-14 rounded-md bg-[#04779e] px-5">
                    <Link href="/vendors/new">
                      <Plus className="h-4 w-4" />
                      Add Vendor
                    </Link>
                  </Button>
                )}
              </div>
            </div>

            <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-5">
              {metricCards.map((card) => (
                <MetricCard key={card.label} card={card} />
              ))}
            </div>

            <div className="mt-10 grid gap-7 xl:grid-cols-[1fr_1fr]">
              <Panel
                title="Pending Approvals"
                badge={`${String(
                  pendingRA + pendingDebitNotes + pendingITC
                ).padStart(2, "0")} urgent`}
              >
                <div className="-mx-6 -mb-6 mt-1 overflow-hidden">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-[#f2eef0] text-[11px] font-black uppercase text-slate-500">
                      <tr>
                        <th className="px-5 py-4">Project ID</th>
                        <th className="px-5 py-4">Type</th>
                        <th className="px-5 py-4">Value</th>
                        <th className="px-5 py-4">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {approvalRows.map((row) => (
                        <tr key={row.id} className="border-t border-slate-200">
                          <td className="px-5 py-5">
                            <p className="text-base font-black">{row.id}</p>
                            <p className="text-xs font-medium text-slate-500">
                              {row.subtitle}
                            </p>
                          </td>
                          <td className="px-5 py-5">
                            <span className="rounded bg-[#e7e4e6] px-2 py-1 text-xs font-bold">
                              {row.type}
                            </span>
                          </td>
                          <td className="px-5 py-5 font-bold">{row.value}</td>
                          <td className="px-5 py-5">
                            <Link
                              href={row.href}
                              className="text-xs font-black uppercase text-[#04779e]"
                            >
                              Open
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <Link
                    href="/approvals"
                    className="block bg-[#f2eef0] px-6 py-5 text-center font-serif text-sm font-bold uppercase text-slate-700"
                  >
                    See all pending approvals
                  </Link>
                </div>
              </Panel>

              <Panel
                title="Vendor Control"
                badge={`${totalVendors} records`}
              >
                <div className="-mx-6 -mb-6 mt-1 overflow-hidden">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-[#f2eef0] text-[11px] font-black uppercase text-slate-500">
                      <tr>
                        <th className="px-5 py-4">Metric</th>
                        <th className="px-5 py-4">Count</th>
                        <th className="px-5 py-4">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vendorRows.map((row) => (
                        <tr key={row.label} className="border-t border-slate-200">
                          <td className="px-5 py-5">
                            <Link
                              href={row.href}
                              className="text-base font-black hover:text-[#04779e]"
                            >
                              {row.label}
                            </Link>
                          </td>
                          <td className="px-5 py-5 text-[#04779e] font-bold">
                            {row.value}
                          </td>
                          <td className="px-5 py-5">
                            <span className="rounded bg-[#e7e4e6] px-2 py-1 text-xs font-bold">
                              {row.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <Link
                    href="/vendors"
                    className="block bg-[#f2eef0] px-6 py-5 text-center font-serif text-sm font-bold uppercase text-slate-700"
                  >
                    View vendor master
                  </Link>
                </div>
              </Panel>
            </div>
      </main>
    </section>
  );
}

type MetricCardData = {
  label: string;
  value: string;
  href: string;
  accent: "teal" | "ink";
  status?: string;
};

function MetricCard({ card }: { card: MetricCardData }) {
  const borderClass =
    card.accent === "teal"
      ? "border-[#04779e] border-l-[4px]"
      : "border-black border-l-[4px]";

  const bars =
    card.accent === "teal"
      ? ["bg-[#04779e]", "bg-[#04779e]", "bg-[#c9dce4]", "bg-[#c9dce4]"]
      : ["bg-black", "bg-black/10"];

  return (
    <Link href={card.href}>
      <Card
        className={`h-40 rounded-none border bg-white p-0 shadow-none transition hover:-translate-y-0.5 hover:shadow-md ${borderClass}`}
      >
        <CardContent className="flex h-full flex-col justify-between p-6">
          <div>
            <p className="font-serif text-[11px] font-black uppercase leading-5 text-slate-600">
              {card.label}
            </p>
            <div className="mt-3 flex items-end gap-3">
              <p className="text-3xl font-black tracking-tight text-black">
                {card.value}
              </p>
              {card.status && (
                <span className="pb-1 text-[10px] font-black text-[#04779e]">
                  {card.status}
                </span>
              )}
            </div>
          </div>

          <div className="flex gap-1.5">
            {bars.map((bar, index) => (
              <span key={index} className={`h-1 w-7 rounded-full ${bar}`} />
            ))}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function Panel({
  title,
  children,
  action,
  badge,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  badge?: string;
}) {
  return (
    <Card className="rounded-none border border-slate-200 bg-white shadow-none">
      <CardHeader className="flex-row items-center justify-between border-b-0 pb-3">
        <CardTitle className="text-lg font-black">{title}</CardTitle>
        {action && (
          <div className="text-xs font-black text-[#04779e]">{action}</div>
        )}
        {badge && (
          <span className="rounded bg-[#04779e] px-3 py-2 text-[10px] font-black uppercase text-white">
            {badge}
          </span>
        )}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
