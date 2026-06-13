"use client";

import Link from "next/link";
import { ClipboardList, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUserAccess, can } from "@/lib/accessControl";

function money(value: any) {
  return `₹ ${Number(value || 0).toLocaleString("en-IN")}`;
}

export default function Home() {
  const [permissions, setPermissions] = useState<any[]>([]);

  const [pendingRA, setPendingRA] = useState(0);
  const [pendingDebitNotes, setPendingDebitNotes] = useState(0);
  const [pendingITC, setPendingITC] = useState(0);
  const [activeWorkOrders, setActiveWorkOrders] = useState(0);

  const [totalWOValue, setTotalWOValue] = useState(0);
  const [approvedRAValue, setApprovedRAValue] = useState(0);
  const [invoiceValue, setInvoiceValue] = useState(0);
  const [paymentValue, setPaymentValue] = useState(0);

  const [totalVendors, setTotalVendors] = useState(0);
  const [panAadhaarPending, setPanAadhaarPending] = useState(0);
  const [blockedVendors, setBlockedVendors] = useState(0);
  const [inactiveVendors, setInactiveVendors] = useState(0);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    setLoading(true);

    try {
      const [
        access,
        pendingRARes,
        pendingDebitRes,
        pendingITCRes,
        activeWORes,
        vendorCountRes,
        panCountRes,
        blockedCountRes,
        inactiveCountRes,
        woValueRes,
        approvedRARes,
        invoiceValueRes,
        paymentValueRes,
      ] = await Promise.all([
        getCurrentUserAccess(),

        supabase
          .from("ra_bills")
          .select("*", { count: "exact", head: true })
          .in("approval_status", ["pending", "Pending"]),

        supabase
          .from("debit_notes")
          .select("*", { count: "exact", head: true })
          .in("approval_status", ["pending", "Pending"]),

       supabase
  .from("invoices")
  .select("*", { count: "exact", head: true })
  .is("itc_status", null),

        supabase
          .from("work_orders")
          .select("*", { count: "exact", head: true })
          .eq("status", "active"),

        supabase
  .from("vendors")
  .select("*", { count: "exact", head: true })
  .neq("status", "deleted"),

     supabase
  .from("vendors")
  .select("*", { count: "exact", head: true })
  .neq("status", "deleted")
  .neq("pan_aadhaar_link_status", "Yes"),

        supabase
          .from("vendors")
          .select("*", { count: "exact", head: true })
          .eq("status", "blocked"),

        supabase
          .from("vendors")
          .select("*", { count: "exact", head: true })
          .eq("status", "inactive"),

       supabase
  .from("work_orders")
  .select("wo_value")
  .eq("status", "active"),

supabase
  .from("ra_bills")
  .select("net_amount, approval_status")
  .eq("status", "active")
  .in("approval_status", ["approved", "Approved"]),

        supabase
  .from("invoices")
  .select("invoice_amount")
  .eq("status", "active"),

        supabase
  .from("payments")
  .select("transferred_amount, payment_amount")
  .eq("status", "active"),
      ]);

      setPermissions(access.permissions || []);

      setPendingRA(pendingRARes.count || 0);
      setPendingDebitNotes(pendingDebitRes.count || 0);
      setPendingITC(pendingITCRes.count || 0);
      setActiveWorkOrders(activeWORes.count || 0);

      setTotalVendors(vendorCountRes.count || 0);
      setPanAadhaarPending(panCountRes.count || 0);
      setBlockedVendors(blockedCountRes.count || 0);
      setInactiveVendors(inactiveCountRes.count || 0);

      setTotalWOValue(
        (woValueRes.data || []).reduce(
          (sum: number, item: any) => sum + Number(item.wo_value || 0),
          0
        )
      );

      setApprovedRAValue(
        (approvedRARes.data || []).reduce(
          (sum: number, item: any) => sum + Number(item.net_amount || 0),
          0
        )
      );

      setInvoiceValue(
        (invoiceValueRes.data || []).reduce(
          (sum: number, item: any) => sum + Number(item.invoice_amount || 0),
          0
        )
      );

      setPaymentValue(
        (paymentValueRes.data || []).reduce(
          (sum: number, item: any) =>
            sum + Number(item.transferred_amount || item.payment_amount || 0),
          0
        )
      );
    } catch (error) {
      console.error("Dashboard load failed:", error);
    } finally {
      setLoading(false);
    }
  }

  const actionCards: [string, string, string][] = [
  ["Pending RA Approval", String(pendingRA), "/approvals"],
  ["Pending Debit Notes", String(pendingDebitNotes), "/approvals"],
  ["Pending ITC Review", String(pendingITC), "/invoices/itc"],
  ["Active Work Orders", String(activeWorkOrders), "/work-orders"],
];

  const financialCards = [
    ["Total WO Value", money(totalWOValue)],
    ["Approved RA Value", money(approvedRAValue)],
    ["Invoice Value", money(invoiceValue)],
    ["Payments Made", money(paymentValue)],
  ];

 const managementCards: [string, string, string][] = [
  ["Total Vendors", String(totalVendors || 0), "/vendors"],
  ["PAN-Aadhaar Pending", String(panAadhaarPending || 0), "/vendors"],
  ["Blocked Vendors", String(blockedVendors || 0), "/vendors"],
  ["Inactive Vendors", String(inactiveVendors || 0), "/vendors"],
];

  if (loading) {
    return <p className="text-gray-500">Loading dashboard...</p>;
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white">
            <ClipboardList className="h-3.5 w-3.5" />
            Command Center
          </div>

          <h1 className="text-3xl font-bold text-slate-950">
            ConstructIQ Dashboard
          </h1>

          <p className="text-sm text-slate-500">
            Live commercial overview for MRC ERP.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              className="h-10 w-72 rounded-xl border bg-white pl-9 pr-3 text-sm shadow-sm outline-none focus:border-slate-400"
              placeholder="Search WO, vendor, invoice..."
            />
          </div>

          {can(permissions, "vendors", "add") && (
            <Link href="/vendors/new">
              <Button>Add Vendor</Button>
            </Link>
          )}
        </div>
      </div>

      <DashboardSection title="Pending Work" cards={actionCards} />

      <DashboardSection title="Commercial Summary" cards={financialCards} />

     <div className="grid gap-4 md:grid-cols-4">
  {managementCards.map(([label, value, href]) => {
    const cardClass =
      label === "PAN-Aadhaar Pending"
        ? "border-yellow-200 bg-yellow-50 shadow-sm transition hover:shadow-md"
        : label === "Blocked Vendors"
        ? "border-red-200 bg-red-50 shadow-sm transition hover:shadow-md"
        : "border-0 shadow-sm transition hover:shadow-md";

    return (
      <Link key={label} href={href}>
        <Card className={cardClass}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">
              {label}
            </CardTitle>
          </CardHeader>

          <CardContent>
            <div className="text-2xl font-bold">{value}</div>
          </CardContent>
        </Card>
      </Link>
    );
  })}
</div>

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle>Commercial Flow</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3">
            {[
              "Work Order",
              "RA Bill",
              "Invoice / ITC",
              "Payment",
              "Debit Note",
              "Vendor Ledger",
              "WO Ledger",
            ].map((step, index, arr) => (
              <div key={step} className="flex items-center gap-3">
                <div className="rounded-2xl border bg-white px-5 py-3 text-center text-sm font-semibold shadow-sm">
                  {step}
                </div>
                {index < arr.length - 1 && (
                  <span className="text-slate-300">→</span>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
function DashboardSection({
  title,
  cards,
}: {
  title: string;
  cards: [string, string, string?][];
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h2>

      <div className="grid gap-4 md:grid-cols-4">
        {cards.map(([label, value, href]) => {
          const card = (
            <Card className="border-0 shadow-sm transition hover:shadow-md">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-slate-500">
                  {label}
                </CardTitle>
              </CardHeader>

              <CardContent>
                <div className="text-3xl font-bold">{value}</div>
              </CardContent>
            </Card>
          );

          return href ? (
            <Link key={label} href={href}>
              {card}
            </Link>
          ) : (
            <div key={label}>{card}</div>
          );
        })}
      </div>
    </section>
  );
}