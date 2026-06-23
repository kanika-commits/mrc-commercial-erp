"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { sortCompanies } from "@/lib/companyOrdering";
import AlertMessage from "@/components/AlertMessage";

const PAYMENT_TYPES = [
  "Work Order",
  "Purchase Order",
  "Salary",
  "Local Purchase",
  "Fuel",
  "Internal Transfer",
  "Other",
];

type Row = {
  company_id: string;
  payment_type: string;
  reference_number: string;
  work_order_id: string;
  invoice_id: string;
  company_bank_account_id: string;
  to_company_bank_account_id: string;
  vendor_id: string;
  vendor_name: string;
  linked_vendors: any[];
  payment_date: string;
  total_payment: string;
  tds_amount: string;
};

const emptyRow = (): Row => ({
  company_id: "",
  payment_type: "Work Order",
  reference_number: "",
  work_order_id: "",
  invoice_id: "",
  company_bank_account_id: "",
  to_company_bank_account_id: "",
  vendor_id: "",
  vendor_name: "",
  linked_vendors: [],
  payment_date: "",
  total_payment: "",
  tds_amount: "0",
});

function onlyNumber(value: string) {
  return value.replace(/[^\d]/g, "");
}

function accountLabel(account: any) {
  const last4 = account.account_number
    ? account.account_number.slice(-4)
    : "----";

  return `${account.bank_name || "Bank"} • ****${last4}`;
}

function friendlyPaymentError(error: any) {
  const message = String(error?.message || "");
  const details = String(error?.details || "");
  const constraint = String(error?.constraint || "");
  const haystack = `${message} ${details} ${constraint}`.toLowerCase();

  if (
    error?.code === "23505" &&
    haystack.includes("payments_unique_number_per_org")
  ) {
    return "Payment number already exists.";
  }

  if (
    error?.code === "23505" &&
    haystack.includes("payments_unique_utr_per_org_when_present")
  ) {
    return "UTR number already exists.";
  }

  return error?.message || "Failed to save payments.";
}

export default function NewPaymentPage() {
  const [rows, setRows] = useState<Row[]>(Array.from({ length: 10 }, emptyRow));
  const [companies, setCompanies] = useState<any[]>([]);
  const [allCompanies, setAllCompanies] = useState<any[]>([]);
  const [defaultCompanyId, setDefaultCompanyId] = useState("");
  const [workOrders, setWorkOrders] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [purchaseOrderVendors, setPurchaseOrderVendors] = useState<any[]>([]);
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const { data: companyData, error: companyError } = await supabase
      .from("companies")
      .select("id, company_name, company_code")
      .eq("status", "active")
      .order("company_name");

    if (companyError) {
      setMessage(companyError.message);
      return;
    }

    const sortedCompanies = sortCompanies(companyData || []);
    setAllCompanies(sortedCompanies);
    setCompanies(sortedCompanies);
    setDefaultCompanyId(sortedCompanies[0]?.id || "");

    const { data: woData, error: woError } = await supabase
      .from("work_orders")
      .select("id, wo_number, company_id")
      .in("approval_status", ["Approved", "approved"])
      .eq("status", "active")
      .order("wo_number");

    if (woError) {
      setMessage(woError.message);
      return;
    }

    setWorkOrders(woData || []);

    const { data: invoiceData, error: invoiceError } = await supabase
      .from("invoices")
      .select("id, invoice_number, work_order_id, vendor_id, invoice_amount, itc_status")
      .ilike("itc_status", "claimed")
      .order("invoice_number");

    if (invoiceError) {
      setMessage(invoiceError.message);
      return;
    }

    setInvoices(invoiceData || []);

    const invoiceVendorIds = Array.from(
      new Set((invoiceData || []).map((invoice: any) => invoice.vendor_id).filter(Boolean))
    );

    if (invoiceVendorIds.length) {
      const { data: vendorData, error: vendorError } = await supabase
        .from("vendors")
        .select("id, vendor_name")
        .in("id", invoiceVendorIds);

      if (vendorError) {
        setMessage(vendorError.message);
        return;
      }

      setVendors(vendorData || []);
    } else {
      setVendors([]);
    }

    const { data: activeVendorData, error: activeVendorError } = await supabase
      .from("vendors")
      .select("id, vendor_name")
      .eq("status", "active")
      .order("vendor_name");

    if (activeVendorError) {
      setMessage(activeVendorError.message);
      return;
    }

    setPurchaseOrderVendors(activeVendorData || []);

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      setMessage("Please sign in again to load company bank accounts.");
      return;
    }

    const accountResponse = await fetch("/api/company-bank-accounts", {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });
    const accountResult = await accountResponse.json();

    if (!accountResponse.ok) {
      setMessage(accountResult.error || "Failed to load company bank accounts.");
      return;
    }

    const activeAccounts = (accountResult.accounts || []).filter(
      (account: any) => String(account.status || "active").toLowerCase() === "active"
    );

    setBankAccounts(activeAccounts);
    setRows((prev) =>
      prev.map((row) => {
        const companyId = row.company_id || sortedCompanies[0]?.id || "";
        const fromAccount = activeAccounts.find(
          (account: any) => account.id === row.company_bank_account_id
        );
        const toAccount = activeAccounts.find(
          (account: any) => account.id === row.to_company_bank_account_id
        );

        return {
          ...row,
          company_id: companyId,
          company_bank_account_id:
            fromAccount?.company_id === companyId ? row.company_bank_account_id : "",
          to_company_bank_account_id: toAccount ? row.to_company_bank_account_id : "",
        };
      })
    );
  }

  function transferred(row: Row) {
    const total = Math.round(Number(row.total_payment || 0));
    const tds = Math.round(Number(row.tds_amount || 0));
    return total - tds;
  }

  function newPaymentRow(): Row {
    return { ...emptyRow(), company_id: defaultCompanyId };
  }

  function accountsForCompany(companyId: string) {
    return bankAccounts.filter((account) => account.company_id === companyId);
  }

  function workOrdersForCompany(_companyId: string) {
    return workOrders;
  }

  function invoicesForCompany(_companyId: string) {
    return invoices;
  }

  function companyLabel(companyId: string | null) {
    const company = allCompanies.find((item) => item.id === companyId);
    if (!company) return "-";
    return company.company_code
      ? `${company.company_code} - ${company.company_name}`
      : company.company_name || "-";
  }

  function workOrderLabel(workOrder: any) {
    return workOrder.wo_number || "-";
  }

  function invoiceLabel(invoice: any) {
    const wo = workOrders.find((item) => item.id === invoice.work_order_id);
    const parts = [
      invoice.invoice_number || "-",
      wo?.wo_number,
      invoice.invoice_amount ? `₹ ${Number(invoice.invoice_amount).toLocaleString("en-IN")}` : "",
    ].filter(Boolean);
    return parts.join(" - ");
  }

  function vendorNameById(vendorId: string | null | undefined) {
    return vendors.find((vendor) => vendor.id === vendorId)?.vendor_name || "";
  }

  function isPaymentRowFilled(row: Row) {
    return Boolean(
        row.reference_number.trim() ||
        row.work_order_id ||
        row.invoice_id ||
        row.payment_date ||
        Number(row.total_payment || 0) > 0 ||
        Number(row.tds_amount || 0) > 0 ||
        row.company_bank_account_id ||
        row.to_company_bank_account_id ||
        row.vendor_id
    );
  }

  const textReferenceLabels: Record<string, string> = {
    "Purchase Order": "Purchase Order Number",
    Salary: "Salary Reference / Employee",
    "Local Purchase": "Local Purchase Reference",
    Fuel: "Fuel Reference",
    "Internal Transfer": "Transfer Reference",
    Other: "Reference / Remarks",
  };

  async function loadVendorForWorkOrder(index: number, workOrderId: string) {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      setMessage("Please sign in again to load vendor for work order.");
      return;
    }

    const response = await fetch(
      `/api/work-orders/vendors?work_order_id=${encodeURIComponent(workOrderId)}`,
      {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      }
    );

    const result = await response.json();

    if (!response.ok) {
      setMessage(result.error || "Failed to load vendor for work order.");
      return;
    }

    const linkedVendors = (result.all_vendors?.[workOrderId] || [])
      .map((row: any) => ({
        vendor_id: row.vendor_id,
        vendor_name: row.vendor?.vendor_name || "",
        vendor_role: row.vendor_role || "-",
      }))
      .filter((row: any) => row.vendor_id);
    const linkedVendor =
      linkedVendors.length === 1
        ? linkedVendors[0]
        : result.vendors?.[workOrderId];

    if (linkedVendors.length === 0 && !linkedVendor?.vendor_id) {
      setMessage("No vendor linked to selected Work Order");
      setRows((prev) =>
        prev.map((row, i) =>
          i === index ? { ...row, vendor_id: "", vendor_name: "", linked_vendors: [] } : row
        )
      );
      return;
    }

    setRows((prev) =>
      prev.map((row, i) =>
        i === index
          ? {
              ...row,
              linked_vendors: linkedVendors,
              vendor_id: linkedVendors.length === 1 ? linkedVendor.vendor_id || "" : "",
              vendor_name: linkedVendors.length === 1 ? linkedVendor.vendor_name || "" : "",
            }
          : row
      )
    );
  }

  function updateRow(index: number, field: keyof Row, value: string) {
    setRows((prev) => {
      const updated = [...prev];
      const row = { ...updated[index], [field]: value };

      if (field === "company_id") {
        row.company_bank_account_id = "";
      }

      if (field === "payment_type") {
        row.reference_number = "";
        row.work_order_id = "";
        row.invoice_id = "";
        row.to_company_bank_account_id = "";
        row.vendor_id = "";
        row.vendor_name = "";
        row.linked_vendors = [];
      }

      if (field === "total_payment" || field === "tds_amount") {
        (row as any)[field] = onlyNumber(value);
      }

      updated[index] = row;
      return updated;
    });
  }

  function handleWorkOrderSelect(index: number, workOrderId: string) {
    const wo = workOrders.find((item) => item.id === workOrderId);

    setRows((prev) =>
      prev.map((row, i) =>
        i === index
          ? {
              ...row,
              company_id: row.company_id || wo?.company_id || defaultCompanyId,
              work_order_id: workOrderId,
              invoice_id: "",
              reference_number: wo?.wo_number || "",
              vendor_id: "",
              vendor_name: "",
              linked_vendors: [],
            }
          : row
      )
    );

    if (workOrderId) {
      loadVendorForWorkOrder(index, workOrderId);
    }
  }

  function handleInvoiceSelect(index: number, invoiceId: string) {
    const invoice = invoices.find((item) => item.id === invoiceId);
    const wo = workOrders.find((item) => item.id === invoice?.work_order_id);
    const vendorName = vendorNameById(invoice?.vendor_id);

    setRows((prev) =>
      prev.map((row, i) =>
        i === index
          ? {
              ...row,
              company_id: row.company_id || wo?.company_id || defaultCompanyId,
              invoice_id: invoiceId,
              work_order_id: invoice?.work_order_id || "",
              reference_number: invoice?.invoice_number || "",
              vendor_id: invoice?.vendor_id || "",
              vendor_name: vendorName,
              linked_vendors: [],
            }
          : row
      )
    );
  }

  function handleInternalTransferSelect(index: number, accountId: string) {
    const account = bankAccounts.find((item) => item.id === accountId);
    const reference = account
      ? `Internal Transfer to ${companyLabel(account.company_id)} - ${accountLabel(account)}`
      : "";

    setRows((prev) =>
      prev.map((row, i) =>
        i === index
          ? {
              ...row,
              to_company_bank_account_id: accountId,
              reference_number: reference,
              vendor_id: "",
              vendor_name: "",
            }
          : row
      )
    );
  }

  function removeRow(index: number) {
    setRows((prev) => {
      if (prev.length === 1) return [newPaymentRow()];
      return prev.filter((_, i) => i !== index);
    });
  }

  function handlePaste(
    e: React.ClipboardEvent<HTMLInputElement>,
    rowIndex: number
  ) {
    const text = e.clipboardData.getData("text");
    if (!text.includes("\t") && !text.includes("\n")) return;

    e.preventDefault();

    const pastedRows = text
      .trim()
      .split("\n")
      .map((line) => line.split("\t"));

    setRows((prev) => {
      const updated = [...prev];

      while (updated.length < rowIndex + pastedRows.length) {
        updated.push(newPaymentRow());
      }

      pastedRows.forEach((cols, i) => {
        const targetIndex = rowIndex + i;

        updated[targetIndex] = {
          company_id: defaultCompanyId,
          payment_type: cols[0] || "Work Order",
          reference_number: cols[1] || "",
          work_order_id: "",
          invoice_id: "",
          company_bank_account_id: "",
          to_company_bank_account_id: "",
          vendor_id: "",
          vendor_name: cols[3] || "",
          linked_vendors: [],
          payment_date: cols[4] || "",
          total_payment: onlyNumber(cols[5] || ""),
          tds_amount: onlyNumber(cols[6] || "0"),
        };
      });

      return updated;
    });
  }

  async function savePayments() {
  setMessage("");

  const filledRows = rows.filter(isPaymentRowFilled);

  if (filledRows.length === 0) {
    setMessage("Please enter at least one payment row.");
    return;
  }

  try {
    setSaving(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error("Your session expired. Please log in again.");
    }

    for (const [index, row] of filledRows.entries()) {
      const rowNo = index + 1;

      if (!row.company_id) {
        throw new Error(`Row ${rowNo}: Company is required.`);
      }

      if (!row.payment_type) {
        throw new Error(`Row ${rowNo}: Payment Against is required.`);
      }

      if (!row.company_bank_account_id) {
        throw new Error(`Row ${rowNo}: From Account is required.`);
      }

      if (row.payment_type === "Internal Transfer") {
        if (!row.to_company_bank_account_id) {
          throw new Error(`Row ${rowNo}: To Account is required for Internal Transfer.`);
        }

        if (row.to_company_bank_account_id === row.company_bank_account_id) {
          throw new Error(`Row ${rowNo}: From Account and To Account cannot be same.`);
        }
      }

      if (row.payment_type === "Work Order" && !row.work_order_id) {
        throw new Error(`Row ${rowNo}: Work Order is required.`);
      }

      if (
        row.payment_type !== "Work Order" &&
        !row.reference_number.trim()
      ) {
        throw new Error(`Row ${rowNo}: Reference is required.`);
      }

      if (row.payment_type === "Work Order" && !row.vendor_id) {
        throw new Error(`Row ${rowNo}: No vendor linked to selected Work Order.`);
      }

      if (row.payment_type === "Purchase Order" && !row.vendor_id) {
        throw new Error(`Row ${rowNo}: Vendor / Party is required.`);
      }

      if (!row.total_payment || Number(row.total_payment || 0) <= 0) {
        throw new Error(`Row ${rowNo}: Total Payment must be greater than 0.`);
      }

      const total = Math.round(Number(row.total_payment || 0));
      const tds = Math.round(Number(row.tds_amount || 0));
      const transfer = total - tds;

      if (transfer < 0) {
        throw new Error(`Row ${rowNo}: TDS cannot exceed Total Payment.`);
      }

      const reference =
        row.reference_number.trim() ||
        row.vendor_name.trim() ||
        row.payment_type;

      const formData = new FormData();
      formData.append("company_id", row.company_id);
      formData.append("payment_type", row.payment_type);
      formData.append("reference_number", reference);
      formData.append("work_order_id", row.work_order_id || "");
      formData.append("invoice_id", row.invoice_id || "");
      formData.append("vendor_id", row.vendor_id || "");
      formData.append("company_bank_account_id", row.company_bank_account_id);
      formData.append("to_company_bank_account_id", row.to_company_bank_account_id || "");
      formData.append("payment_number", `PAY-${Date.now()}-${rowNo}`);
      formData.append(
        "payment_date",
        row.payment_date || new Date().toISOString().slice(0, 10)
      );
      formData.append("total_payment", String(total));
      formData.append("tds_amount", String(tds));
      formData.append("transferred_amount", String(transfer));
      formData.append("payment_mode", "Bank Transfer");

      const response = await fetch("/api/payments", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: formData,
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to save payment.");
      }
    }

    setMessage("Payments saved successfully.");
    setRows(Array.from({ length: 10 }, newPaymentRow));
  } catch (error: any) {
    setMessage(friendlyPaymentError(error));
  } finally {
    setSaving(false);
  }
}

  return (
    <div className="space-y-6 pb-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center rounded bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
            Payments
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">
            Payment Entry
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Excel-style payment entry with company-wise account selection.
          </p>
        </div>

        <Link
          href="/payments"
          className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
        >
          Back
        </Link>
      </div>

      <AlertMessage
        type={message === "Payments saved successfully." ? "success" : "error"}
        message={message}
        onClose={() => setMessage("")}
      />

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-white px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-950">
            Payment Rows
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Paste or enter rows directly. Transferred amount is calculated from total payment minus TDS.
          </p>
        </div>

        <div className="overflow-x-auto">
        <table className="w-full min-w-[1600px] text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-3 py-3 text-left font-semibold">Company</th>
              <th className="px-3 py-3 text-left font-semibold">Payment Against</th>
              <th className="px-3 py-3 text-left font-semibold">Reference</th>
              <th className="px-3 py-3 text-left font-semibold">From Account</th>
              <th className="px-3 py-3 text-left font-semibold">Vendor / Party</th>
              <th className="px-3 py-3 text-left font-semibold">Payment Date</th>
              <th className="px-3 py-3 text-left font-semibold">Total Payment</th>
              <th className="px-3 py-3 text-left font-semibold">TDS Deducted</th>
              <th className="px-3 py-3 text-left font-semibold">Transferred Amount</th>
              <th className="px-3 py-3 text-left font-semibold">Remove</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100">
            {rows.map((row, index) => (
              <tr key={index} className="transition hover:bg-slate-50">
                <td className="px-3 py-3 align-top">
                  <select
                    value={row.company_id}
                    onChange={(e) =>
                      updateRow(index, "company_id", e.target.value)
                    }
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-slate-400"
                  >
                    <option value="">Select Company</option>
                    {companies.map((company) => (
                      <option key={company.id} value={company.id}>
                        {company.company_name}
                        {company.company_code
                          ? ` (${company.company_code})`
                          : ""}
                      </option>
                    ))}
                  </select>
                </td>

                <td className="px-3 py-3 align-top">
                  <select
                    value={row.payment_type}
                    onChange={(e) =>
                      updateRow(index, "payment_type", e.target.value)
                    }
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-slate-400"
                  >
                    {PAYMENT_TYPES.map((type) => (
                      <option key={type}>{type}</option>
                    ))}
                  </select>
                </td>

                <td className="px-3 py-3 align-top">
                  {row.payment_type === "Work Order" ? (
                    <select
                      value={row.work_order_id}
                      onChange={(e) =>
                        handleWorkOrderSelect(index, e.target.value)
                      }
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-slate-400"
                    >
                      <option value="">Select Work Order</option>

                      {workOrdersForCompany(row.company_id).map((wo) => (
                        <option key={wo.id} value={wo.id}>
                          {workOrderLabel(wo)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={row.reference_number}
                      onChange={(e) =>
                        updateRow(index, "reference_number", e.target.value)
                      }
                      onPaste={(e) => handlePaste(e, index)}
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-slate-400"
                      placeholder={textReferenceLabels[row.payment_type] || "Reference"}
                    />
                  )}
                </td>

                <td className="px-3 py-3 align-top">
                  {(() => {
                    const companyAccounts = accountsForCompany(row.company_id);
                    return (
                  <select
                    value={row.company_bank_account_id}
                    onChange={(e) =>
                      updateRow(
                        index,
                        "company_bank_account_id",
                        e.target.value
                      )
                    }
                    disabled={!row.company_id || companyAccounts.length === 0}
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-slate-400 disabled:bg-slate-100"
                  >
                      <option value="">
                        {row.company_id
                          ? companyAccounts.length > 0
                            ? "Select Account"
                            : "No active accounts for this company"
                          : "Select Company first"}
                      </option>

                    {companyAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {accountLabel(account)}
                      </option>
                    ))}
                  </select>
                    );
                  })()}
                </td>

                <td className="px-3 py-3 align-top">
                  {row.payment_type === "Work Order" && row.linked_vendors.length > 1 ? (
                    <select
                      value={row.vendor_id}
                      onChange={(e) => {
                        const vendor = row.linked_vendors.find(
                          (item: any) => item.vendor_id === e.target.value
                        );
                        updateRow(index, "vendor_id", e.target.value);
                        updateRow(index, "vendor_name", vendor?.vendor_name || "");
                      }}
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-slate-400"
                    >
                      <option value="">Select Vendor</option>
                      {row.linked_vendors.map((vendor: any) => (
                        <option key={vendor.vendor_id} value={vendor.vendor_id}>
                          {vendor.vendor_name} — {vendor.vendor_role}
                        </option>
                      ))}
                    </select>
                  ) : row.payment_type === "Purchase Order" ? (
                    <select
                      value={row.vendor_id}
                      onChange={(e) => {
                        const vendor = purchaseOrderVendors.find(
                          (item) => item.id === e.target.value
                        );
                        updateRow(index, "vendor_id", e.target.value);
                        updateRow(index, "vendor_name", vendor?.vendor_name || "");
                      }}
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-slate-400"
                    >
                      <option value="">Select Vendor</option>
                      {purchaseOrderVendors.map((vendor) => (
                        <option key={vendor.id} value={vendor.id}>
                          {vendor.vendor_name}
                        </option>
                      ))}
                    </select>
                  ) : row.payment_type === "Internal Transfer" ? (
                    <select
                      value={row.to_company_bank_account_id}
                      onChange={(e) =>
                        handleInternalTransferSelect(index, e.target.value)
                      }
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-slate-400"
                    >
                      <option value="">Select To Account</option>
                      {bankAccounts.map((account) => (
                        <option
                          key={account.id}
                          value={account.id}
                          disabled={account.id === row.company_bank_account_id}
                        >
                          {companyLabel(account.company_id)} - {accountLabel(account)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={row.vendor_name}
                      onChange={(e) =>
                        updateRow(index, "vendor_name", e.target.value)
                      }
                      readOnly={
                        row.payment_type === "Work Order" ||
                        row.payment_type === "Invoice"
                      }
                      className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-slate-400 read-only:text-slate-600"
                      placeholder="Vendor / Party"
                    />
                  )}
                </td>

                <Cell
                  value={row.payment_date}
                  type="date"
                  onChange={(value) => updateRow(index, "payment_date", value)}
                />

                <Cell
                  value={row.total_payment}
                  type="number"
                  onChange={(value) =>
                    updateRow(index, "total_payment", onlyNumber(value))
                  }
                />

                <Cell
                  value={row.tds_amount}
                  type="number"
                  onChange={(value) =>
                    updateRow(index, "tds_amount", onlyNumber(value))
                  }
                />

                <td className="p-2 font-medium">
                  <div className="flex h-10 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 font-semibold text-slate-950">
                    ₹ {transferred(row).toLocaleString("en-IN")}
                  </div>
                </td>

                <td className="px-3 py-3 align-top">
                  <button
                    type="button"
                    onClick={() => removeRow(index)}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-sm font-bold text-red-700 transition hover:bg-red-100"
                  >
                    X
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <button
          type="button"
          onClick={() =>
            setRows((prev) => [
              ...prev,
              ...Array.from({ length: 10 }, newPaymentRow),
            ])
          }
          className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
        >
          + Add 10 Rows
        </button>

        <button
          type="button"
          onClick={savePayments}
          disabled={saving}
          className="rounded-lg bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save Payments"}
        </button>
      </div>
    </div>
  );
}

function Cell({
  value,
  onChange,
  type = "text",
}: {
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <td className="px-3 py-3 align-top">
      <input
        type={type}
        step="1"
        min={type === "number" ? "0" : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-slate-400"
      />
    </td>
  );
}
