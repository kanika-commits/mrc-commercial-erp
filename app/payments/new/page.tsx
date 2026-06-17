"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { sortCompanies } from "@/lib/companyOrdering";

const PAYMENT_TYPES = [
  "Work Order",
  "Purchase Order",
  "Internal Transfer",
  "Fuel",
  "Local Purchase",
  "Bank Interest/EMI/Charges",
  "Salary",
  "Reimbursement",
  "Others",
];

type Row = {
  company_id: string;
  payment_type: string;
  reference_number: string;
  work_order_id: string;
  company_bank_account_id: string;
  vendor_id: string;
  vendor_name: string;
  payment_date: string;
  total_payment: string;
  tds_amount: string;
};

const emptyRow = (): Row => ({
  company_id: "",
  payment_type: "Work Order",
  reference_number: "",
  work_order_id: "",
  company_bank_account_id: "",
  vendor_id: "",
  vendor_name: "",
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

export default function NewPaymentPage() {
  const [rows, setRows] = useState<Row[]>(Array.from({ length: 10 }, emptyRow));
  const [companies, setCompanies] = useState<any[]>([]);
  const [workOrders, setWorkOrders] = useState<any[]>([]);
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

    setCompanies(sortCompanies(companyData || []));

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

    setBankAccounts(
      (accountResult.accounts || []).filter(
        (account: any) => String(account.status || "active").toLowerCase() === "active"
      )
    );
  }

  function transferred(row: Row) {
    const total = Math.round(Number(row.total_payment || 0));
    const tds = Math.round(Number(row.tds_amount || 0));
    return total - tds;
  }

  function accountsForCompany(companyId: string) {
    if (!companyId) return [];
    return bankAccounts.filter((account) => account.company_id === companyId);
  }

  function workOrdersForCompany(companyId: string) {
    if (!companyId) return [];
    return workOrders.filter((wo) => wo.company_id === companyId);
  }

  const manualPaymentTypes = [
    "Fuel",
    "Local Purchase",
    "Bank Interest/EMI/Charges",
    "Salary",
    "Reimbursement",
    "Others",
  ];

  async function loadVendorForWorkOrder(index: number, workOrderId: string) {
    const { data, error } = await supabase
      .from("work_order_vendors")
      .select(`
        vendor_id,
        vendor_role,
        is_primary,
        vendors (
          id,
          vendor_name
        )
      `)
      .eq("work_order_id", workOrderId)
      .order("is_primary", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      setMessage(error.message || "Failed to load vendor for work order.");
      return;
    }

    setRows((prev) =>
      prev.map((row, i) =>
        i === index
          ? (() => {
    const vendorRelation: any = data?.vendors;
    const linkedVendor = Array.isArray(vendorRelation)
      ? vendorRelation[0]
      : vendorRelation;

    return {
      ...row,
      vendor_id: linkedVendor?.id || "",
      vendor_name: linkedVendor?.vendor_name || "",
    };
  })()
: row
      )
    );
  }

  function updateRow(index: number, field: keyof Row, value: string) {
    setRows((prev) => {
      const updated = [...prev];
      const row = { ...updated[index], [field]: value };

      if (field === "company_id") {
        row.reference_number = "";
        row.work_order_id = "";
        row.company_bank_account_id = "";
        row.vendor_id = "";
        row.vendor_name = "";
      }

      if (field === "payment_type") {
        row.reference_number = "";
        row.work_order_id = "";
        row.vendor_id = "";
        row.vendor_name = "";
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
              company_id: wo?.company_id || row.company_id,
              work_order_id: workOrderId,
              reference_number: wo?.wo_number || "",
              vendor_id: "",
              vendor_name: "",
            }
          : row
      )
    );

    if (workOrderId) {
      loadVendorForWorkOrder(index, workOrderId);
    }
  }

  function handleInternalTransferSelect(index: number, accountId: string) {
    const account = bankAccounts.find((item) => item.id === accountId);

    setRows((prev) =>
      prev.map((row, i) =>
        i === index
          ? {
              ...row,
              reference_number: account ? accountLabel(account) : "",
              vendor_id: "",
              vendor_name: "",
            }
          : row
      )
    );
  }

  function removeRow(index: number) {
    setRows((prev) => {
      if (prev.length === 1) return [emptyRow()];
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
        updated.push(emptyRow());
      }

      pastedRows.forEach((cols, i) => {
        const targetIndex = rowIndex + i;

        updated[targetIndex] = {
          company_id: "",
          payment_type: cols[0] || "Work Order",
          reference_number: cols[1] || "",
          work_order_id: "",
          company_bank_account_id: "",
          vendor_id: "",
          vendor_name: cols[3] || "",
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

  const filledRows = rows.filter(
    (row) =>
      row.company_id ||
      row.reference_number ||
      row.work_order_id ||
      row.company_bank_account_id ||
      row.vendor_name ||
      Number(row.total_payment || 0) > 0
  );

  if (filledRows.length === 0) {
    setMessage("Please fill at least one payment row.");
    return;
  }

  try {
    setSaving(true);

    const organizationId = "3b65abde-9f9f-4f1b-bd40-fa261a76920b";
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const userEmail = session?.user?.email || "";
    const userName =
      session?.user?.user_metadata?.full_name ||
      session?.user?.user_metadata?.name ||
      userEmail;

    for (const [index, row] of filledRows.entries()) {
      const rowNo = index + 1;

      if (!row.company_id) {
        throw new Error(`Row ${rowNo}: Company is required.`);
      }

      if (!row.payment_type) {
        throw new Error(`Row ${rowNo}: Payment Type is required.`);
      }

      if (!row.company_bank_account_id) {
        throw new Error(`Row ${rowNo}: From Account is required.`);
      }

      if (row.payment_type === "Work Order" && !row.work_order_id) {
        throw new Error(`Row ${rowNo}: Work Order is required.`);
      }

      if (row.payment_type === "Internal Transfer" && !row.reference_number) {
        throw new Error(`Row ${rowNo}: Receiving Account is required.`);
      }

      if (
        row.payment_type !== "Internal Transfer" &&
        row.payment_type !== "Work Order" &&
        !row.reference_number.trim()
      ) {
        throw new Error(`Row ${rowNo}: Reference is required.`);
      }

      if (
        row.payment_type !== "Internal Transfer" &&
        !row.vendor_name.trim()
      ) {
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

      const { error } = await supabase.from("payments").insert({
        organization_id: organizationId,
        company_id: row.company_id,

        payment_type: row.payment_type,
        reference_number: reference,

        work_order_id: row.work_order_id || null,
        vendor_id: row.vendor_id || null,
        company_bank_account_id: row.company_bank_account_id,

        payment_number: `PAY-${Date.now()}-${rowNo}`,
        payment_date:
          row.payment_date || new Date().toISOString().slice(0, 10),

        total_payment: total,
        tds_amount: tds,
        transferred_amount: transfer,
        payment_amount: transfer,

        payment_mode: "Bank Transfer",
        status: "Draft",
        remarks: null,
        created_by_name: userName || null,
        created_by_email: userEmail || null,
      });

      if (error) throw error;
    }

    setMessage("Payments saved successfully.");
    setRows(Array.from({ length: 10 }, emptyRow));
  } catch (error: any) {
    setMessage(error.message || "Failed to save payments.");
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

      {message && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {message}
        </div>
      )}

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
              <th className="px-3 py-3 text-left font-semibold">Payment Type</th>
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
                      disabled={!row.company_id}
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-slate-400 disabled:bg-slate-100"
                    >
                      <option value="">
                        {row.company_id
                          ? "Select Work Order"
                          : "Select Company First"}
                      </option>

                      {workOrdersForCompany(row.company_id).map((wo) => (
                        <option key={wo.id} value={wo.id}>
                          {wo.wo_number}
                        </option>
                      ))}
                    </select>
                  ) : row.payment_type === "Purchase Order" ? (
                    <select
                      disabled
                      className="h-10 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 text-sm text-slate-500"
                    >
                      <option>Purchase Order module not built yet</option>
                    </select>
                  ) : row.payment_type === "Internal Transfer" ? (
                    <select
                      value={row.reference_number}
                      onChange={(e) =>
                        handleInternalTransferSelect(index, e.target.value)
                      }
                      disabled={!row.company_id}
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-slate-400 disabled:bg-slate-100"
                    >
                      <option value="">
                        {row.company_id
                          ? "Select Receiving Account"
                          : "Select Company First"}
                      </option>

                      {accountsForCompany(row.company_id).map((account) => (
                        <option key={account.id} value={account.id}>
                          {accountLabel(account)}
                        </option>
                      ))}
                    </select>
                  ) : manualPaymentTypes.includes(row.payment_type) ? (
                    <input
                      value={row.reference_number}
                      onChange={(e) =>
                        updateRow(index, "reference_number", e.target.value)
                      }
                      onPaste={(e) => handlePaste(e, index)}
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-slate-400"
                      placeholder="Reference"
                    />
                  ) : (
                    <input
                      value={row.reference_number}
                      onChange={(e) =>
                        updateRow(index, "reference_number", e.target.value)
                      }
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-slate-400"
                      placeholder="Reference"
                    />
                  )}
                </td>

                <td className="px-3 py-3 align-top">
                  <select
                    value={row.company_bank_account_id}
                    onChange={(e) =>
                      updateRow(
                        index,
                        "company_bank_account_id",
                        e.target.value
                      )
                    }
                    disabled={!row.company_id}
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-slate-400 disabled:bg-slate-100"
                  >
                      <option value="">
                        {row.company_id
                          ? accountsForCompany(row.company_id).length > 0
                            ? "Select Account"
                            : "No accounts found for this company"
                          : "Select Company First"}
                      </option>

                    {accountsForCompany(row.company_id).map((account) => (
                      <option key={account.id} value={account.id}>
                        {accountLabel(account)}
                      </option>
                    ))}
                  </select>
                </td>

                <td className="px-3 py-3 align-top">
                  <input
                    value={
                      row.payment_type === "Internal Transfer"
                        ? "Internal Transfer"
                        : row.vendor_name
                    }
                    onChange={(e) =>
                      updateRow(index, "vendor_name", e.target.value)
                    }
                    readOnly={
                      row.payment_type === "Work Order" ||
                      row.payment_type === "Purchase Order" ||
                      row.payment_type === "Internal Transfer"
                    }
                    className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-slate-400 read-only:text-slate-600"
                    placeholder={
                      manualPaymentTypes.includes(row.payment_type)
                        ? "Vendor / Party"
                        : ""
                    }
                  />
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
            setRows((prev) => [...prev, ...Array.from({ length: 10 }, emptyRow)])
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
