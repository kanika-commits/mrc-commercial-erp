"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  ExternalLink,
  FileText,
  Paperclip,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

function money(value: any) {
  return `₹ ${Number(value || 0).toLocaleString("en-IN")}`;
}

function statusClass(value?: string | null) {
  const status = String(value || "").toLowerCase();
  if (status === "approved") return "border-green-200 bg-green-50 text-green-700";
  if (status === "pending") return "border-yellow-200 bg-yellow-50 text-yellow-700";
  if (status === "rejected") return "border-red-200 bg-red-50 text-red-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

export default function RABillDetailPage() {
  const params = useParams();
  const billId = params.id as string;

  const [bill, setBill] = useState<any>(null);
  const [workOrder, setWorkOrder] = useState<any>(null);
  const [company, setCompany] = useState<any>(null);
  const [site, setSite] = useState<any>(null);
  const [vendor, setVendor] = useState<any>(null);
  const [documents, setDocuments] = useState<any[]>([]);
  const [previousRABills, setPreviousRABills] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadBill();
  }, [billId]);

  async function loadBill() {
    try {
      setLoading(true);
      setMessage("");

      const { data: billData, error: billError } = await supabase
        .from("ra_bills")
        .select("*")
        .eq("id", billId)
        .single();

      if (billError) throw billError;
      setBill(billData);

      if (billData.work_order_id) {
        const { data: woData, error: woError } = await supabase
          .from("work_orders")
          .select("id, wo_number, wo_value, wo_date, company_id, site_id")
          .eq("id", billData.work_order_id)
          .maybeSingle();

        if (woError) throw woError;
        setWorkOrder(woData);

        if (woData?.company_id) {
          const { data: companyData } = await supabase
            .from("companies")
            .select("id, company_name, company_code")
            .eq("id", woData.company_id)
            .maybeSingle();

          setCompany(companyData);
        }

        if (woData?.site_id) {
          const { data: siteData } = await supabase
            .from("sites")
            .select("id, site_name, site_code")
            .eq("id", woData.site_id)
            .maybeSingle();

          setSite(siteData);
        }

        const { data: previousData, error: previousError } = await supabase
          .from("ra_bills")
          .select("id, ra_number, ra_date, gross_amount, net_amount, approval_status, created_at")
          .eq("work_order_id", billData.work_order_id)
          .order("created_at", { ascending: true });

        if (previousError) throw previousError;
        setPreviousRABills(previousData || []);
      }

      if (billData.vendor_id) {
        const { data: vendorData, error: vendorError } = await supabase
          .from("vendors")
          .select("id, vendor_name, pan, gstin")
          .eq("id", billData.vendor_id)
          .maybeSingle();

        if (vendorError) throw vendorError;
        setVendor(vendorData);
      }

      const { data: documentData, error: documentError } = await supabase
        .from("ra_bill_documents")
        .select("*")
        .eq("ra_bill_id", billId)
        .order("uploaded_at", { ascending: false });

      if (documentError) throw documentError;
      setDocuments(documentData || []);
    } catch (error: any) {
      setMessage(error.message || "Failed to load RA Bill.");
    } finally {
      setLoading(false);
    }
  }

  async function openDocument(path: string | null) {
    if (!path) return;

    const { data, error } = await supabase.storage
      .from("ra-bill-documents")
      .createSignedUrl(path, 60);

    if (error) {
      setMessage(error.message);
      return;
    }

    window.open(data.signedUrl, "_blank");
  }

  const totals = useMemo(() => {
    const woValue = Number(workOrder?.wo_value || 0);
    const currentGross = Number(bill?.gross_amount || 0);

    const previousTotal = previousRABills
      .filter((item) => item.id !== bill?.id)
      .reduce((sum, item) => sum + Number(item.gross_amount || 0), 0);

    const totalAfterThisRA = previousTotal + currentGross;
    const balanceAfterThisRA = woValue - totalAfterThisRA;

    return {
      woValue,
      previousTotal,
      currentGross,
      totalAfterThisRA,
      balanceAfterThisRA,
    };
  }, [bill, workOrder, previousRABills]);

  if (loading) {
    return <p className="text-sm text-slate-500">Loading RA Bill...</p>;
  }

  if (message) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {message}
      </div>
    );
  }

  if (!bill) {
    return <p className="text-red-600">RA Bill not found.</p>;
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
            <FileText className="h-3.5 w-3.5" />
            RA Bill Detail
          </div>

          <h1 className="text-3xl font-bold text-slate-950">
            RA Bill {bill.ra_number}
          </h1>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusClass(
                bill.approval_status
              )}`}
            >
              {bill.approval_status || "Pending"}
            </span>

            <span className="text-sm text-slate-500">
              Created against WO {workOrder?.wo_number || "-"}
            </span>
          </div>
        </div>

        <Link
          href="/ra-bills"
          className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to RA Bills
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        <Summary title="WO Value" value={money(totals.woValue)} />
        <Summary title="Previous RA Total" value={money(totals.previousTotal)} />
        <Summary title="Current RA" value={money(totals.currentGross)} />
        <Summary title="Total Billed" value={money(totals.totalAfterThisRA)} />
        <Summary
          title="Balance"
          value={money(totals.balanceAfterThisRA)}
          warning={totals.balanceAfterThisRA < 0}
        />
      </div>

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Building2 className="h-5 w-5 text-slate-400" />
          <h2 className="text-xl font-semibold text-slate-950">
            Work Order & Site Details
          </h2>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <Info label="Work Order" value={workOrder?.wo_number || "-"} />
          <Info label="Company" value={company?.company_name || "-"} />
          <Info label="Site" value={site?.site_name || "-"} />
          <Info label="Vendor" value={vendor?.vendor_name || "-"} />
          <Info label="WO Date" value={workOrder?.wo_date || "-"} />
          <Info label="RA Date" value={bill.ra_date || "-"} />
          <Info label="PAN" value={vendor?.pan || "-"} />
          <Info label="GSTIN" value={vendor?.gstin || "-"} />
        </div>

        {bill.work_order_id && (
          <Link
            href={`/work-orders/${bill.work_order_id}`}
            className="mt-5 inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium hover:bg-slate-50"
          >
            Open Work Order
            <ExternalLink className="h-4 w-4" />
          </Link>
        )}
      </section>

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-xl font-semibold text-slate-950">
          Commercial Summary
        </h2>

        <div className="grid gap-4 md:grid-cols-4">
          <Summary title="Value of Work Done" value={money(bill.gross_amount)} />
          <Summary title="Security Deduction" value={money(bill.recovery_amount)} />
          <Summary title="GST Amount" value={money(bill.retention_amount)} />
          <Summary title="Net Payable" value={money(bill.net_amount)} />
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-xl font-semibold text-slate-950">
          RA History for this Work Order
        </h2>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="p-3 text-left">RA No</th>
                <th className="p-3 text-left">Date</th>
                <th className="p-3 text-right">Gross</th>
                <th className="p-3 text-right">Net</th>
                <th className="p-3 text-left">Approval</th>
                <th className="p-3 text-right">Action</th>
              </tr>
            </thead>

            <tbody>
              {previousRABills.map((item) => (
                <tr
                  key={item.id}
                  className={`border-t ${item.id === bill.id ? "bg-amber-50" : ""}`}
                >
                  <td className="p-3 font-medium">
                    {item.ra_number}
                    {item.id === bill.id && (
                      <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                        Current
                      </span>
                    )}
                  </td>
                  <td className="p-3">{item.ra_date || "-"}</td>
                  <td className="p-3 text-right">{money(item.gross_amount)}</td>
                  <td className="p-3 text-right">{money(item.net_amount)}</td>
                  <td className="p-3">{item.approval_status || "Pending"}</td>
                  <td className="p-3 text-right">
                    <Link
                      href={`/ra-bills/${item.id}`}
                      className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-white"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}

              {previousRABills.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-slate-500">
                    No RA history found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Paperclip className="h-5 w-5 text-slate-400" />
          <h2 className="text-xl font-semibold text-slate-950">
            RA Bill Attachments
          </h2>
        </div>

        {documents.length === 0 ? (
          <p className="text-sm text-red-600">No attachments found.</p>
        ) : (
          <div className="space-y-3">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-3"
              >
                <div>
                  <p className="font-medium text-slate-950">{doc.file_name}</p>
                  <p className="text-xs text-slate-500">
                    Uploaded:{" "}
                    {doc.uploaded_at
                      ? new Date(doc.uploaded_at).toLocaleString()
                      : "-"}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => openDocument(doc.file_url)}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800"
                >
                  Open
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {bill.remarks && (
        <section className="rounded-2xl border bg-white p-6 shadow-sm">
          <h2 className="mb-2 text-xl font-semibold text-slate-950">Remarks</h2>
          <p className="text-sm leading-6 text-slate-700">{bill.remarks}</p>
        </section>
      )}
    </section>
  );
}

function Summary({
  title,
  value,
  warning,
}: {
  title: string;
  value: string;
  warning?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-5 shadow-sm ${
        warning ? "border-yellow-200 bg-yellow-50" : "bg-white"
      }`}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {title}
      </p>
      <p className="mt-2 text-lg font-bold text-slate-950">{value}</p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 font-medium text-slate-950">{value}</p>
    </div>
  );
}