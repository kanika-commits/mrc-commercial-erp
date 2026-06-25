"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  ExternalLink,
  FileText,
  Landmark,
  Pencil,
  Phone,
  Trash2,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAccessContext } from "@/components/AccessContext";
import { can } from "@/lib/accessControl";
import AuditTrailCard from "@/components/AuditTrailCard";
import { formatIstTimestamp } from "@/lib/dateTime";

function money(value: any) {
  return `₹ ${Number(value || 0).toLocaleString("en-IN")}`;
}

export default function VendorDetailPage() {
  const { access, loading: accessLoading } = useAccessContext();
  const params = useParams();
  const vendorId = params.id as string;

  const [vendor, setVendor] = useState<any>(null);
  const [contacts, setContacts] = useState<any[]>([]);
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [gstins, setGstins] = useState<any[]>([]);
  const [workOrders, setWorkOrders] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [sites, setSites] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const permissions = access?.permissions || [];
  const canEdit = can(permissions, "vendors", "edit");
  const canDelete = can(permissions, "vendors", "delete");

  const loadVendorLedger = useCallback(async () => {
    try {
      setLoading(true);
      setMessage("");

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Your session expired. Please log in again.");
      }

      const vendorResponse = await fetch(`/api/vendors/${vendorId}`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      const vendorResult = await vendorResponse.json();

      if (!vendorResponse.ok) {
        throw new Error(vendorResult.error || "Failed to load vendor master.");
      }

      setVendor(vendorResult.vendor);
      setContacts(vendorResult.contacts || []);
      setBankAccounts(vendorResult.bankAccounts || []);
      setDocuments(vendorResult.documents || []);
      setGstins(vendorResult.gstins || []);
      const mergedWorkOrders = (vendorResult.workOrders || []).sort((a: any, b: any) =>
        String(a.wo_number || "").localeCompare(String(b.wo_number || ""))
      );
      const mergedWorkOrderIds = mergedWorkOrders.map((wo: any) => wo.id);

      setWorkOrders(mergedWorkOrders);

      const { data: paymentData, error: paymentError } = mergedWorkOrderIds.length
        ? await supabase
            .from("payments")
            .select("id, work_order_id, vendor_id, total_payment, payment_amount, transferred_amount")
            .eq("vendor_id", vendorId)
            .in("work_order_id", mergedWorkOrderIds)
            .order("payment_date", { ascending: true })
        : { data: [], error: null };

      if (paymentError) throw paymentError;
      setPayments(paymentData || []);

      const companyIds = Array.from(
        new Set(mergedWorkOrders.map((wo: any) => wo.company_id).filter(Boolean))
      );
      const siteIds = Array.from(
        new Set(mergedWorkOrders.map((wo: any) => wo.site_id).filter(Boolean))
      );

      const [{ data: companyData, error: companyError }, { data: siteData, error: siteError }] =
        await Promise.all([
          companyIds.length
            ? supabase
                .from("companies")
                .select("id, company_name, company_code")
                .in("id", companyIds)
            : Promise.resolve({ data: [], error: null }),
          siteIds.length
            ? supabase
                .from("sites")
                .select("id, site_name, site_code")
                .in("id", siteIds)
            : Promise.resolve({ data: [], error: null }),
        ]);

      if (companyError) throw companyError;
      if (siteError) throw siteError;

      setCompanies(companyData || []);
      setSites(siteData || []);
    } catch (error: any) {
      setMessage(error.message || "Failed to load vendor ledger.");
    } finally {
      setLoading(false);
    }
  }, [vendorId]);

  useEffect(() => {
    if (!accessLoading && access) {
      loadVendorLedger();
    }
  }, [access, accessLoading, loadVendorLedger]);

  const companyMap = useMemo(() => {
    return new Map(companies.map((company: any) => [company.id, company]));
  }, [companies]);

  const siteMap = useMemo(() => {
    return new Map(sites.map((site: any) => [site.id, site]));
  }, [sites]);

  const paymentTotalsByWorkOrder = useMemo(() => {
    const map = new Map<string, number>();

    payments.forEach((payment: any) => {
      const workOrderId = payment.work_order_id;
      if (!workOrderId) return;

      const amount = Number(
        payment.total_payment || payment.payment_amount || payment.transferred_amount || 0
      );

      map.set(workOrderId, (map.get(workOrderId) || 0) + amount);
    });

    return map;
  }, [payments]);

  const workOrderRows = useMemo(() => {
    return workOrders.map((wo) => {
      const basicValue = Number(wo.wo_value || 0);
      const gstPercent = Number(wo.gst_percent ?? 18);
      const gstAmount = (basicValue * (Number.isFinite(gstPercent) ? gstPercent : 0)) / 100;
      const totalValue = basicValue + gstAmount;
      const totalPayments = paymentTotalsByWorkOrder.get(wo.id) || 0;

      return {
        ...wo,
        basicValue,
        gstAmount,
        totalValue,
        totalPayments,
      };
    });
  }, [workOrders, paymentTotalsByWorkOrder]);

  const vendorAmountDue = useMemo(() => {
    return workOrders.reduce(
      (sum, workOrder) => sum + Number(workOrder.amount_due || 0),
      0
    );
  }, [workOrders]);

  async function deleteVendor() {
    const ok = window.confirm(
      `Delete vendor "${vendor?.vendor_name || "Vendor"}"? This will remove it from the active vendor list.`
    );

    if (!ok) return;

    try {
      setMessage("");

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Your session expired. Please log in again.");
      }

      const response = await fetch(`/api/vendors/${vendorId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to delete vendor.");
      }

      window.location.href = "/vendors";
    } catch (error: any) {
      setMessage(error.message || "Failed to delete vendor.");
    }
  }

  async function openVendorDocument(document: any) {
    if (!document.id) {
      alert("Document id is missing.");
      return;
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      alert("Your session expired. Please log in again.");
      return;
    }

    const response = await fetch(`/api/vendors/${vendorId}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ document_id: document.id }),
    });
    const result = await response.json();

    if (!response.ok || !result.signedUrl) {
      console.error("Vendor document open failed", {
        document,
        error: result.error,
      });
      alert(result.error || "Unable to open this document.");
      return;
    }

    window.open(result.signedUrl, "_blank", "noopener,noreferrer");
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Loading vendor ledger...</p>;
  }

  if (message) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {message}
      </div>
    );
  }

  if (!vendor) return <p className="text-red-600">Vendor not found.</p>;

  const uniqueGstins = [
    ...(vendor.gstin
      ? [
          {
            id: "vendor-primary-gstin",
            gstin: vendor.gstin,
            state_code: vendor.gstin.slice(0, 2),
            state_name: "",
            is_primary: true,
          },
        ]
      : []),
    ...gstins.filter(
      (gstin) => gstin.gstin && gstin.gstin !== vendor.gstin
    ),
  ];
  const gstCertificate = documents.find(
    (document) => document.document_type === "GST_CERTIFICATE"
  );
  const bankProof = documents.find((document) => document.document_type === "BANK_PROOF");
  const showPanAadhaarLinked = isProprietorship(vendor.contractor_type);

  return (
    <section className="space-y-8">
      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <span>Master Setup</span>
        <span>/</span>
        <Link href="/vendors" className="text-slate-600 hover:text-slate-950">
          Vendors
        </Link>
        <span>/</span>
        <span className="text-blue-700">Detail</span>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="min-w-0">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              <Building2 className="h-3.5 w-3.5" />
              Vendor Master
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-950 md:text-4xl">
              {vendor.vendor_name}
            </h1>
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge>{vendor.contractor_type || "Contractor Type -"}</Badge>
              <Badge>PAN: {vendor.pan || "-"}</Badge>
              <Badge>GSTIN: {vendor.gstin || "-"}</Badge>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            {canEdit && (
              <Link
                href={`/vendors/${vendorId}/edit`}
                className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-700 shadow-sm hover:bg-blue-50"
              >
                <Pencil className="h-4 w-4" />
                Edit Vendor
              </Link>
            )}
            {canDelete && (
              <button
                type="button"
                onClick={deleteVendor}
                className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 shadow-sm hover:bg-red-50"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </button>
            )}
            <Link
              href="/vendors"
              className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-semibold shadow-sm hover:bg-slate-50"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Vendors
            </Link>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6 items-start">
        <div className="col-span-12 space-y-6 xl:col-span-8">
          <VendorCard title="Basic Information" icon={<Building2 className="h-5 w-5" />}>
            <div className="grid gap-x-8 gap-y-6 md:grid-cols-2 lg:grid-cols-3">
              <Info label="Vendor Name" value={vendor.vendor_name} />
              <Info label="Contractor Type" value={vendor.contractor_type} />
              <Info label="PAN" value={vendor.pan} />
              <Info label="Aadhaar/CIN" value={vendor.aadhaar_cin} />
              <Info label="GSTIN" value={vendor.gstin} />
              <Info
                label="MSME Registered"
                value={vendor.msme_registered ? "Yes" : "No"}
              />
              <Info label="MSME Number" value={vendor.msme_number} />
              <Info label="MSME Category" value={vendor.msme_category} />
              {showPanAadhaarLinked && (
                <Info
                  label="PAN-Aadhaar Linked"
                  value={vendor.pan_aadhaar_link_status}
                />
              )}
            </div>
          </VendorCard>

          <AuditTrailCard
            createdAt={vendor.created_at}
            updatedAt={vendor.updated_at}
          />

          <VendorCard title="GST Details" icon={<FileText className="h-5 w-5" />}>
            {uniqueGstins.length === 0 ? (
              <EmptyState message="No GST details added." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3 text-left">GSTIN</th>
                      <th className="px-4 py-3 text-left">State Code</th>
                      <th className="px-4 py-3 text-left">State</th>
                      <th className="px-4 py-3 text-left">Type</th>
                      <th className="px-4 py-3 text-right">Attachment</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {uniqueGstins.map((gstin) => (
                      <tr key={gstin.id || gstin.gstin} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-semibold text-slate-950">
                          {gstin.gstin || "-"}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {gstin.state_code || gstin.gstin?.slice(0, 2) || "-"}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {gstin.state_name || "-"}
                        </td>
                        <td className="px-4 py-3">
                          {gstin.is_primary ? <Badge>Primary GSTIN</Badge> : "-"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {gstCertificate?.file_url ? (
                            <button
                              type="button"
                              onClick={() => openVendorDocument(gstCertificate)}
                              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              Open
                            </button>
                          ) : (
                            "-"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </VendorCard>

          <VendorCard
            title="Document Repository"
            icon={<FileText className="h-5 w-5" />}
          >
            {documents.length === 0 ? (
              <EmptyState message="No documents uploaded." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3 text-left">Document</th>
                      <th className="px-4 py-3 text-left">Linked Number</th>
                      <th className="px-4 py-3 text-left">Uploaded</th>
                      <th className="px-4 py-3 text-left">Status</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {documents.map((document) => (
                      <tr key={document.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                              <FileText className="h-4 w-4" />
                            </div>
                            <div>
                              <p className="font-semibold text-slate-950">
                                {formatDocumentType(document.document_type)}
                              </p>
                              <p className="text-xs text-slate-500">
                                {document.file_name || "-"}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {getDocumentDisplayNumber(
                            document,
                            vendor,
                            gstins,
                            bankAccounts
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {formatDateTime(document.uploaded_at)}
                        </td>
                        <td className="px-4 py-3">
                          {document.is_verified ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Verified
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              Pending
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            disabled={!document.file_url}
                            onClick={() => openVendorDocument(document)}
                            className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </VendorCard>

          <div className="grid gap-4 md:grid-cols-2">
            <SmallSummaryTile
              title="Work Orders"
              value={String(workOrderRows.length)}
            />
            <SmallSummaryTile
              title="Amount Due"
              value={formatSignedMoney(vendorAmountDue)}
              tone={amountDueTone(vendorAmountDue)}
            />
          </div>

          <VendorCard title="Work Orders linked to this vendor" icon={<Building2 className="h-5 w-5" />}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1050px] text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-left">S.No.</th>
                    <th className="px-4 py-3 text-left">Company</th>
                    <th className="px-4 py-3 text-left">Site</th>
                    <th className="px-4 py-3 text-left">WO Number</th>
                    <th className="px-4 py-3 text-left">WO Date</th>
                    <th className="px-4 py-3 text-right">WO Basic Value</th>
                    <th className="px-4 py-3 text-right">GST</th>
                    <th className="px-4 py-3 text-right">Total Value of WO</th>
                    <th className="px-4 py-3 text-right">Total Payments</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {workOrderRows.map((wo, index) => {
                    const company = companyMap.get(wo.company_id);
                    const site = siteMap.get(wo.site_id);

                    return (
                      <tr key={wo.id} className="hover:bg-slate-50 align-top">
                        <td className="px-4 py-4">{index + 1}</td>
                        <td className="px-4 py-4 font-semibold text-slate-800">
                          {company?.company_name || company?.company_code || "-"}
                        </td>
                        <td className="px-4 py-4 font-semibold text-slate-800">
                          {site?.site_name || site?.site_code || "-"}
                        </td>
                        <td className="px-4 py-4 font-semibold text-blue-700">
                          <Link href={`/work-orders/${wo.id}`} className="hover:underline">
                            {wo.wo_number || "-"}
                          </Link>
                        </td>
                        <td className="px-4 py-4">{formatDate(wo.wo_date)}</td>
                        <td className="px-4 py-4 text-right font-semibold">
                          {money(wo.basicValue)}
                        </td>
                        <td className="px-4 py-4 text-right font-semibold">
                          {money(wo.gstAmount)}
                        </td>
                        <td className="px-4 py-4 text-right font-semibold">
                          {money(wo.totalValue)}
                        </td>
                        <td className="px-4 py-4 text-right font-semibold">
                          {money(wo.totalPayments)}
                        </td>
                      </tr>
                    );
                  })}

                  {workOrderRows.length === 0 && (
                    <tr>
                      <td colSpan={9} className="p-8 text-center text-slate-500">
                        No linked Work Orders found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </VendorCard>
        </div>

        <aside className="col-span-12 space-y-6 xl:col-span-4">
          <VendorCard title="Contact Persons" icon={<Phone className="h-5 w-5" />}>
            {contacts.length === 0 ? (
              <EmptyState message="No contact persons added." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3 text-left">Name</th>
                      <th className="px-4 py-3 text-left">Contact Number</th>
                      <th className="px-4 py-3 text-left">Email</th>
                      <th className="px-4 py-3 text-left">Designation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {contacts.map((contact) => (
                      <tr key={contact.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-xs font-bold text-blue-800">
                              {getInitials(contact.contact_name)}
                            </span>
                            <span className="font-semibold text-slate-950">
                              {contact.contact_name || "-"}
                            </span>
                            {contact.is_primary && <Badge>Primary</Badge>}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {contact.contact_number || "-"}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          <span className="break-all">{contact.email || "-"}</span>
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {contact.designation || "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </VendorCard>

          <VendorCard title="Bank Accounts" icon={<Landmark className="h-5 w-5" />}>
            {bankAccounts.length === 0 ? (
              <EmptyState message="No bank accounts added." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3 text-left">Account Number</th>
                      <th className="px-4 py-3 text-left">IFSC Code</th>
                      <th className="px-4 py-3 text-left">Bank Name</th>
                      <th className="px-4 py-3 text-left">Branch</th>
                      <th className="px-4 py-3 text-right">Attachment</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {bankAccounts.map((account) => (
                      <tr key={account.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-slate-950">
                              {maskAccount(account.account_number)}
                            </span>
                            {account.is_primary && <Badge>Primary</Badge>}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {account.ifsc_code || "-"}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {account.bank_name || "-"}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {account.branch_name || "-"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {bankProof?.file_url ? (
                            <button
                              type="button"
                              onClick={() => openVendorDocument(bankProof)}
                              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              Open
                            </button>
                          ) : (
                            "-"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </VendorCard>
        </aside>
      </div>
    </section>
  );

}

function VendorCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-5 py-4">
        <div className="flex items-center gap-2 text-slate-950">
          {icon && <span className="text-blue-700">{icon}</span>}
          <h2 className="text-lg font-semibold">{title}</h2>
        </div>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function SmallSummaryTile({
  title,
  value,
  tone = "neutral",
}: {
  title: string;
  value: string;
  tone?: "positive" | "negative" | "neutral";
}) {
  const toneClass =
    tone === "positive"
      ? "border-emerald-200 bg-emerald-50/60 text-emerald-700"
      : tone === "negative"
        ? "border-red-200 bg-red-50/60 text-red-600"
        : "border-slate-200 bg-white text-slate-700";

  return (
    <div className={`rounded-2xl border p-5 shadow-sm ${toneClass}`}>
      <p className="text-sm font-semibold text-slate-500">{title}</p>
      <p className="mt-2 text-2xl font-bold tracking-tight">{value}</p>
    </div>
  );
}

function getInitials(value: string | null) {
  if (!value) return "V";
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

function Info({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 font-medium text-slate-950">
        {value === null || value === undefined || value === "" ? "-" : String(value)}
      </p>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
      {children}
    </span>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 p-6 text-center text-sm text-slate-500">
      {message}
    </div>
  );
}

function maskAccount(value: string | null) {
  if (!value) return "-";
  const last4 = value.slice(-4);
  return `•••• •••• ${last4}`;
}

function isProprietorship(value: string | null) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "proprietor" || normalized === "proprietorship";
}

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function amountDueTone(value: number): "positive" | "negative" | "neutral" {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

function formatSignedMoney(value: number) {
  const absolute = money(Math.abs(value));
  if (value > 0) return `+${absolute}`;
  if (value < 0) return `-${absolute}`;
  return money(0);
}

function formatDateTime(value: string | null) {
  return formatIstTimestamp(value);
}

function formatDocumentType(value: string | null) {
  if (!value) return "Document";

  const labels: Record<string, string> = {
    PAN: "PAN",
    AADHAAR_CIN: "Aadhaar/CIN",
    GST_CERTIFICATE: "GST Certificate",
    PAN_AADHAAR_ATTACHMENT: "PAN-Aadhaar Linked Proof",
    MSME_CERTIFICATE: "MSME Certificate",
    BANK_PROOF: "Bank Proof",
    ADDITIONAL_DOCUMENT: "Additional Document",
  };

  return labels[value] || value.replace(/_/g, " ");
}

function getDocumentDisplayNumber(
  document: any,
  vendor: any,
  gstins: any[],
  bankAccounts: any[]
) {
  if (document.document_number) return document.document_number;

  const primaryGstin =
    gstins.find((gstin) => gstin.is_primary)?.gstin ||
    gstins.find((gstin) => gstin.gstin)?.gstin ||
    vendor?.gstin;
  const primaryBank =
    bankAccounts.find((account) => account.is_primary) || bankAccounts[0];

  switch (document.document_type) {
    case "PAN":
      return vendor?.pan || "-";
    case "AADHAAR_CIN":
      return vendor?.aadhaar_cin || "-";
    case "GST_CERTIFICATE":
      return primaryGstin || "-";
    case "PAN_AADHAAR_ATTACHMENT":
      return vendor?.pan_aadhaar_link_status || "-";
    case "MSME_CERTIFICATE":
      return vendor?.msme_number || "-";
    case "BANK_PROOF":
      return primaryBank?.account_number
        ? `Account ending ${primaryBank.account_number.slice(-4)}`
        : "-";
    case "ADDITIONAL_DOCUMENT":
      return document.remarks || "-";
    default:
      return "-";
  }
}
