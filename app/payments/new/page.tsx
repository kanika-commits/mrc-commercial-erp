"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

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

  return `${account.bank_name || "Bank"} | ${last4}`;
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

    setCompanies(companyData || []);

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

    const { data: accountData, error: accountError } = await supabase
      .from("company_bank_accounts")
      .select("id, company_id, bank_name, account_number, ifsc")
      .eq("status", "active")
      .order("bank_name");

    if (accountError) {
      setMessage(accountError.message);
      return;
    }

    setBankAccounts(accountData || []);
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

    const organizationId = "7208169c-4e3f-4d6b-b068-31931a39120f";

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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Payment Entry</h1>
          <p className="text-gray-500">
            Excel-style payment entry with company-wise account selection.
          </p>
        </div>

        <Link href="/payments" className="rounded-lg border px-4 py-2">
          Back
        </Link>
      </div>

      {message && (
        <div className="rounded-lg border bg-yellow-50 p-3 text-sm text-yellow-800">
          {message}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full min-w-[1600px] text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-2 text-left">Company</th>
              <th className="p-2 text-left">Payment Type</th>
              <th className="p-2 text-left">Reference</th>
              <th className="p-2 text-left">From Account</th>
              <th className="p-2 text-left">Vendor / Party</th>
              <th className="p-2 text-left">Payment Date</th>
              <th className="p-2 text-left">Total Payment</th>
              <th className="p-2 text-left">TDS Deducted</th>
              <th className="p-2 text-left">Transferred Amount</th>
              <th className="p-2 text-left">Remove</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="border-t">
                <td className="p-2">
                  <select
                    value={row.company_id}
                    onChange={(e) =>
                      updateRow(index, "company_id", e.target.value)
                    }
                    className="w-full rounded border px-2 py-1"
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

                <td className="p-2">
                  <select
                    value={row.payment_type}
                    onChange={(e) =>
                      updateRow(index, "payment_type", e.target.value)
                    }
                    className="w-full rounded border px-2 py-1"
                  >
                    {PAYMENT_TYPES.map((type) => (
                      <option key={type}>{type}</option>
                    ))}
                  </select>
                </td>

                <td className="p-2">
                  {row.payment_type === "Work Order" ? (
                    <select
                      value={row.work_order_id}
                      onChange={(e) =>
                        handleWorkOrderSelect(index, e.target.value)
                      }
                      disabled={!row.company_id}
                      className="w-full rounded border px-2 py-1 disabled:bg-gray-100"
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
                      className="w-full rounded border bg-gray-100 px-2 py-1"
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
                      className="w-full rounded border px-2 py-1 disabled:bg-gray-100"
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
                      className="w-full rounded border px-2 py-1"
                      placeholder="Reference"
                    />
                  ) : (
                    <input
                      value={row.reference_number}
                      onChange={(e) =>
                        updateRow(index, "reference_number", e.target.value)
                      }
                      className="w-full rounded border px-2 py-1"
                      placeholder="Reference"
                    />
                  )}
                </td>

                <td className="p-2">
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
                    className="w-full rounded border px-2 py-1 disabled:bg-gray-100"
                  >
                    <option value="">
                      {row.company_id ? "Select Account" : "Select Company First"}
                    </option>

                    {accountsForCompany(row.company_id).map((account) => (
                      <option key={account.id} value={account.id}>
                        {accountLabel(account)}
                      </option>
                    ))}
                  </select>
                </td>

                <td className="p-2">
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
                    className="w-full rounded border bg-gray-50 px-2 py-1"
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
                  ₹ {transferred(row).toLocaleString("en-IN")}
                </td>

                <td className="p-2">
                  <button
                    type="button"
                    onClick={() => removeRow(index)}
                    className="rounded bg-red-100 px-2 py-1 text-red-700"
                  >
                    X
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-between">
        <button
          type="button"
          onClick={() =>
            setRows((prev) => [...prev, ...Array.from({ length: 10 }, emptyRow)])
          }
          className="rounded-lg border px-4 py-2"
        >
          + Add 10 Rows
        </button>

        <button
          type="button"
          onClick={savePayments}
          disabled={saving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-60"
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
    <td className="p-2">
      <input
        type={type}
        step="1"
        min={type === "number" ? "0" : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border px-2 py-1"
      />
    </td>
  );
}