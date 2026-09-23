"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { sortCompanies } from "@/lib/companyOrdering";
import AlertMessage from "@/components/AlertMessage";
import { mapPaymentGridPaste, matchPaymentOption, normalizePaymentDate, transferredPaymentAmount } from "@/lib/payments/paymentGrid";
import { paymentPurchaseOrderLabel } from "@/lib/payments/purchaseOrderPayment";

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
  po_source: "siteqube" | "manual";
  purchase_order_id: string;
  site_id: string;
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
  po_source: "siteqube",
  purchase_order_id: "",
  site_id: "",
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
  const [paymentCompanies, setPaymentCompanies] = useState<any[]>([]);
  const [allCompanies, setAllCompanies] = useState<any[]>([]);
  const [defaultCompanyId, setDefaultCompanyId] = useState("");
  const [workOrders, setWorkOrders] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [purchaseOrderVendors, setPurchaseOrderVendors] = useState<any[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);
  const [paymentSites, setPaymentSites] = useState<any[]>([]);
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function fetchWithToken(url: string) {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error("Please sign in again to load payment form data.");
    }

    return fetch(url, {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });
  }

  async function loadData() {
    try {
      const [lookupResponse, accountResponse, poLookupResponse] = await Promise.all([
        fetchWithToken("/api/commercial/create-lookups"),
        fetchWithToken("/api/payments/company-bank-accounts"),
        fetchWithToken("/api/payments/purchase-order-lookups"),
      ]);

      const lookupResult = await lookupResponse.json();
      const accountResult = await accountResponse.json();
      const poLookupResult = await poLookupResponse.json();

      if (!lookupResponse.ok) {
        throw new Error(lookupResult.error || "Failed to load payment form data.");
      }

      if (!accountResponse.ok) {
        throw new Error(accountResult.error || "Failed to load company bank accounts.");
      }
      if (!poLookupResponse.ok) {
        throw new Error(poLookupResult.error || "Failed to load Purchase Order payment lookups.");
      }

      const lookupCompanies = (lookupResult.companies || []) as any[];
      const companySource =
        lookupCompanies.length > 0
          ? lookupCompanies
          : Array.from(
              new Map(
                ((lookupResult.work_orders || []) as any[])
                  .map((workOrder) => workOrder.companies)
                  .filter((company) => company?.id)
                  .map((company) => [company.id, company]),
              ).values(),
            );
      const sortedCompanies: any[] = sortCompanies(companySource as any[]);
      setAllCompanies(sortedCompanies);
      setCompanies(sortedCompanies);
      const sortedPaymentCompanies: any[] = sortCompanies(poLookupResult.companies || []);
      setPaymentCompanies(sortedPaymentCompanies);
      setAllCompanies((previous) => Array.from(new Map([...previous, ...sortedPaymentCompanies].map((company: any) => [company.id, company])).values()));
      setDefaultCompanyId(sortedCompanies[0]?.id || "");
      setWorkOrders(lookupResult.work_orders || []);
      setInvoices(lookupResult.invoices || []);
      setVendors(lookupResult.vendors || []);
      setPurchaseOrderVendors(lookupResult.purchase_order_vendors || []);
      setPurchaseOrders(poLookupResult.purchase_orders || []);
      setPaymentSites(poLookupResult.sites || []);

      const allowedCompanyIds = new Set([...sortedCompanies, ...sortedPaymentCompanies].map((company: any) => company.id));
      const activeAccounts = (accountResult.accounts || []).filter(
        (account: any) =>
          String(account.status || "active").toLowerCase() === "active" &&
          allowedCompanyIds.has(account.company_id)
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
    } catch (error: any) {
      setMessage(error.message || "Failed to load payment form data.");
    }
  }

  function transferred(row: Row) {
    return transferredPaymentAmount(row.total_payment, row.tds_amount);
  }

  function newPaymentRow(): Row {
    return { ...emptyRow(), company_id: defaultCompanyId };
  }

  function accountsForCompany(companyId: string) {
    return bankAccounts.filter((account) => account.company_id === companyId);
  }

  function companiesForRow(row: Row) {
    return row.payment_type === "Purchase Order" && paymentCompanies.length ? paymentCompanies : companies;
  }

  function sitesForRow(row: Row) {
    const company = [...companies, ...paymentCompanies].find((item) => item.id === row.company_id);
    return paymentSites.filter((site) => !company?.organization_id || site.organization_id === company.organization_id);
  }

  function siteLabel(siteId: string) {
    const site = paymentSites.find((item) => item.id === siteId);
    return site ? [site.site_code, site.site_name].filter(Boolean).join(" — ") : "";
  }

  function handleCompanySelect(index: number, companyId: string) {
    setRows((previous) => previous.map((current, rowIndex) => {
      if (rowIndex !== index) return current;
      let row = { ...current, company_id: companyId, company_bank_account_id: "" };
      if (row.payment_type === "Purchase Order" && row.po_source === "siteqube") {
        const selectedPo = purchaseOrders.find((item) => item.id === row.purchase_order_id);
        if (selectedPo && selectedPo.company_id !== companyId) {
          row = { ...row, purchase_order_id: "", site_id: "", vendor_id: "", vendor_name: "", reference_number: "" };
        }
      }
      return row;
    }));
  }

  function handlePurchaseOrderSelect(index: number, purchaseOrderId: string) {
    const purchaseOrder = purchaseOrders.find((item) => item.id === purchaseOrderId);
    setRows((previous) => previous.map((row, rowIndex) => rowIndex === index ? {
      ...row,
      ...(purchaseOrder ? {
        company_id: purchaseOrder.company_id,
        purchase_order_id: purchaseOrder.id,
        site_id: purchaseOrder.site_id,
        vendor_id: purchaseOrder.vendor_id,
        vendor_name: purchaseOrder.vendor_name || "",
        reference_number: purchaseOrder.po_number,
        company_bank_account_id: row.company_id === purchaseOrder.company_id ? row.company_bank_account_id : "",
      } : {
        purchase_order_id: "", site_id: "", vendor_id: "", vendor_name: "", reference_number: "",
      }),
    } : row));
  }

  function handlePurchaseOrderSourceSelect(index: number, source: "siteqube" | "manual") {
    setRows((previous) => previous.map((row, rowIndex) => rowIndex === index ? {
      ...row,
      po_source: source,
      purchase_order_id: "",
      site_id: "",
      vendor_id: "",
      vendor_name: "",
      reference_number: "",
    } : row));
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
    const number = workOrder?.wo_number || "-";
    const type = String(workOrder?.wo_type || "").trim();
    return type ? `${number} — ${type}` : number;
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
        row.purchase_order_id ||
        row.site_id ||
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

  async function fetchVendorsForWorkOrder(workOrderId: string) {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error("Please sign in again to load vendor for work order.");
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
      throw new Error(result.error || "Failed to load vendor for work order.");
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

    return { linkedVendors, linkedVendor };
  }

  async function loadVendorForWorkOrder(index: number, workOrderId: string) {
    try {
      const { linkedVendors, linkedVendor } = await fetchVendorsForWorkOrder(workOrderId);
      if (linkedVendors.length === 0 && !linkedVendor?.vendor_id) {
        setMessage("No vendor linked to selected Work Order");
        setRows((prev) => prev.map((row, i) => i === index ? { ...row, vendor_id: "", vendor_name: "", linked_vendors: [] } : row));
        return;
      }

      setRows((prev) => prev.map((row, i) => i === index ? {
        ...row,
        linked_vendors: linkedVendors,
        vendor_id: linkedVendors.length === 1 ? linkedVendor.vendor_id || "" : "",
        vendor_name: linkedVendors.length === 1 ? linkedVendor.vendor_name || "" : "",
      } : row));
    } catch (error: any) {
      setMessage(error.message || "Failed to load vendor for work order.");
    }
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
        row.po_source = "siteqube";
        row.purchase_order_id = "";
        row.site_id = "";
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

  async function handlePaste(e: React.ClipboardEvent<HTMLElement>, startRow: number, startColumn: number) {
    const clipboardText = e.clipboardData.getData("text");
    if (!clipboardText.includes("\t") && !clipboardText.includes("\n")) return;
    e.preventDefault();
    setMessage("");

    const pasteRows = mapPaymentGridPaste(clipboardText, startRow, startColumn);
    const nextRows = [...rows];
    const changedWorkOrderRows: number[] = [];
    const pendingWorkOrderParty = new Map<number, string>();

    try {
      for (const pasteRow of pasteRows) {
        while (nextRows.length <= pasteRow.rowIndex) nextRows.push(newPaymentRow());
        let row = { ...nextRows[pasteRow.rowIndex] };
        const values = pasteRow.values;

        if (values.company !== undefined) {
          if (!values.company) {
            if (row.company_id && values.from_account === undefined) row.company_bank_account_id = "";
            row.company_id = "";
          }
          else {
            const company = matchPaymentOption(values.company, companies, (item) => [item.id, item.company_name, item.company_code, `${item.company_code || ""} - ${item.company_name || ""}`, `${item.company_name || ""} (${item.company_code || ""})`]);
            if (!company) throw new Error(`Paste rejected: Company “${values.company}” does not match one available company.`);
            if (row.company_id !== company.id && values.from_account === undefined) row.company_bank_account_id = "";
            row.company_id = company.id;
            if (row.payment_type === "Purchase Order" && row.po_source === "siteqube") {
              const selectedPo = purchaseOrders.find((item) => item.id === row.purchase_order_id);
              if (selectedPo && selectedPo.company_id !== company.id) {
                row = { ...row, purchase_order_id: "", site_id: "", vendor_id: "", vendor_name: "", reference_number: "" };
              }
            }
          }
        }

        if (values.payment_type !== undefined && values.payment_type) {
          const paymentType = PAYMENT_TYPES.find((value) => value.toLowerCase() === values.payment_type!.toLowerCase());
          if (!paymentType) throw new Error(`Paste rejected: Payment Against “${values.payment_type}” is not an available option.`);
          if (row.payment_type !== paymentType) row = { ...row, payment_type: paymentType, reference_number: "", work_order_id: "", invoice_id: "", to_company_bank_account_id: "", vendor_id: "", vendor_name: "", linked_vendors: [] };
        }

        if (values.reference !== undefined) {
          if (row.payment_type === "Work Order") {
            if (!values.reference) {
              row = { ...row, reference_number: "", work_order_id: "", invoice_id: "", vendor_id: "", vendor_name: "", linked_vendors: [] };
            } else {
              const workOrder = matchPaymentOption(values.reference, workOrders, (item) => [item.id, item.wo_number, workOrderLabel(item)]);
              if (!workOrder) throw new Error(`Paste rejected: Work Order “${values.reference}” does not match an available Work Order.`);
              row = { ...row, company_id: row.company_id || workOrder.company_id || defaultCompanyId, reference_number: workOrder.wo_number || "", work_order_id: workOrder.id, invoice_id: "", vendor_id: "", vendor_name: "", linked_vendors: [] };
              changedWorkOrderRows.push(pasteRow.rowIndex);
            }
          } else if (row.payment_type === "Purchase Order" && row.po_source === "siteqube") {
            if (!values.reference) {
              row = { ...row, purchase_order_id: "", site_id: "", reference_number: "", vendor_id: "", vendor_name: "" };
            } else {
              const purchaseOrder = matchPaymentOption(values.reference, purchaseOrders, (item) => [item.id, item.po_number, paymentPurchaseOrderLabel(item)]);
              if (!purchaseOrder) throw new Error(`Paste rejected: SiteQube PO “${values.reference}” does not match an available current Purchase Order. Choose Manual / Old PO to enter a legacy reference.`);
              row = { ...row, company_bank_account_id: row.company_id !== purchaseOrder.company_id ? "" : row.company_bank_account_id, company_id: purchaseOrder.company_id, purchase_order_id: purchaseOrder.id, site_id: purchaseOrder.site_id, vendor_id: purchaseOrder.vendor_id, vendor_name: purchaseOrder.vendor_name || "", reference_number: purchaseOrder.po_number };
            }
          } else {
            row.reference_number = values.reference;
          }
        }

        if (values.from_account !== undefined) {
          if (!values.from_account) row.company_bank_account_id = "";
          else {
            const availableAccounts = accountsForCompany(row.company_id);
            const account = matchPaymentOption(values.from_account, availableAccounts, (item) => [item.id, accountLabel(item), item.bank_name, item.account_number]);
            if (!account) throw new Error(`Paste rejected: From Account “${values.from_account}” does not match an available account for this company.`);
            row.company_bank_account_id = account.id;
          }
        }

        if (values.payment_date !== undefined) {
          const paymentDate = normalizePaymentDate(values.payment_date);
          if (paymentDate === null) throw new Error(`Paste rejected: Payment Date “${values.payment_date}” is not a valid date.`);
          row.payment_date = paymentDate;
        }
        if (values.total_payment !== undefined) row.total_payment = onlyNumber(values.total_payment);
        if (values.tds_amount !== undefined) row.tds_amount = onlyNumber(values.tds_amount);

        if (values.party !== undefined) {
          if (row.payment_type === "Work Order") {
            if (values.party) pendingWorkOrderParty.set(pasteRow.rowIndex, values.party);
            else { row.vendor_id = ""; row.vendor_name = ""; }
          } else if (row.payment_type === "Purchase Order") {
            if (row.po_source === "siteqube") {
              const selectedPo = purchaseOrders.find((item) => item.id === row.purchase_order_id);
              if (values.party && (!selectedPo || !matchPaymentOption(values.party, [selectedPo], (item) => [item.vendor_id, item.vendor_name]))) {
                throw new Error(`Paste rejected: Vendor / Party “${values.party}” does not match the selected SiteQube PO.`);
              }
            }
            else if (!values.party) { row.vendor_id = ""; row.vendor_name = ""; }
            else {
              const vendor = matchPaymentOption(values.party, purchaseOrderVendors, (item) => [item.id, item.vendor_name]);
              if (!vendor) throw new Error(`Paste rejected: Vendor / Party “${values.party}” does not match an available vendor.`);
              row.vendor_id = vendor.id;
              row.vendor_name = vendor.vendor_name || "";
            }
          } else if (row.payment_type === "Internal Transfer") {
            if (!values.party) row.to_company_bank_account_id = "";
            else {
              const account = matchPaymentOption(values.party, bankAccounts.filter((item) => item.id !== row.company_bank_account_id), (item) => [item.id, `${companyLabel(item.company_id)} - ${accountLabel(item)}`, accountLabel(item), item.bank_name, item.account_number]);
              if (!account) throw new Error(`Paste rejected: To Account “${values.party}” does not match an available account.`);
              row.to_company_bank_account_id = account.id;
              row.reference_number = `Internal Transfer to ${companyLabel(account.company_id)} - ${accountLabel(account)}`;
            }
          } else {
            row.vendor_id = "";
            row.vendor_name = values.party;
          }
        }

        nextRows[pasteRow.rowIndex] = row;
      }

      const vendorOptionsByWorkOrder = new Map<string, { linkedVendors: any[]; linkedVendor: any }>();
      const workOrderRows = new Set([...changedWorkOrderRows, ...Array.from(pendingWorkOrderParty.keys())]);
      const workOrderIds = Array.from(new Set(Array.from(workOrderRows).map((index) => nextRows[index]?.work_order_id).filter(Boolean)));
      await Promise.all(workOrderIds.map(async (workOrderId) => {
        const cached = nextRows.find((row) => row.work_order_id === workOrderId && row.linked_vendors.length > 0);
        if (cached) vendorOptionsByWorkOrder.set(workOrderId, { linkedVendors: cached.linked_vendors, linkedVendor: cached.linked_vendors.length === 1 ? cached.linked_vendors[0] : null });
        else vendorOptionsByWorkOrder.set(workOrderId, await fetchVendorsForWorkOrder(workOrderId));
      }));

      for (const rowIndex of workOrderRows) {
        const row = nextRows[rowIndex];
        if (!row?.work_order_id) continue;
        const options = vendorOptionsByWorkOrder.get(row.work_order_id);
        if (!options) continue;
        row.linked_vendors = options.linkedVendors;
        const pastedParty = pendingWorkOrderParty.get(rowIndex);
        if (pastedParty) {
          const vendorChoices = options.linkedVendor && !options.linkedVendors.some((item) => item.vendor_id === options.linkedVendor.vendor_id)
            ? [...options.linkedVendors, options.linkedVendor]
            : options.linkedVendors;
          const vendor = matchPaymentOption(pastedParty, vendorChoices, (item) => [item.vendor_id, item.vendor_name, `${item.vendor_name} — ${item.vendor_role}`]);
          if (!vendor) throw new Error(`Paste rejected: Vendor / Party “${pastedParty}” is not linked to the selected Work Order.`);
          row.vendor_id = vendor.vendor_id;
          row.vendor_name = vendor.vendor_name || "";
        } else if (options.linkedVendors.length === 1) {
          row.vendor_id = options.linkedVendor?.vendor_id || "";
          row.vendor_name = options.linkedVendor?.vendor_name || "";
        }
      }

      setRows(nextRows);
      setMessage(`Pasted ${pasteRows.length} payment row${pasteRows.length === 1 ? "" : "s"}.`);
    } catch (error: any) {
      setMessage(error.message || "Paste rejected. Check the pasted values against the available options.");
    }
  }

  function handleGridKeyDown(event: React.KeyboardEvent<HTMLTableSectionElement>) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    const cells = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-payment-grid-cell='true']"))
      .filter((cell) => !cell.hasAttribute("readonly") && !cell.hasAttribute("disabled"));
    const currentIndex = cells.indexOf(target);
    if (currentIndex < 0) return;

    if (event.key === "Tab") {
      const nextIndex = currentIndex + (event.shiftKey ? -1 : 1);
      if (nextIndex >= 0 && nextIndex < cells.length) {
        event.preventDefault();
        cells[nextIndex]?.focus();
      }
      return;
    }

    if (event.key === "Enter" && target instanceof HTMLInputElement && target.type !== "date") {
      event.preventDefault();
      (cells[currentIndex + 1] || cells[0])?.focus();
      return;
    }

    if (target instanceof HTMLInputElement && target.type === "text" && ["ArrowUp", "ArrowDown"].includes(event.key)) {
      const rowIndex = Number(target.closest("tr")?.getAttribute("data-payment-grid-row"));
      const column = target.getAttribute("data-payment-grid-column");
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const nextRow = event.currentTarget.querySelector<HTMLElement>(`[data-payment-grid-row="${rowIndex + direction}"] [data-payment-grid-column="${column}"]`);
      if (nextRow && nextRow.tagName === "INPUT" && !nextRow.hasAttribute("readonly")) {
        event.preventDefault();
        nextRow.focus();
      }
    }
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

      if (row.payment_type === "Purchase Order") {
        if (row.po_source === "siteqube") {
          const selectedPo = purchaseOrders.find((item) => item.id === row.purchase_order_id);
          if (!selectedPo) throw new Error(`Row ${rowNo}: Select a current SiteQube Purchase Order.`);
          if (row.company_id !== selectedPo.company_id || row.site_id !== selectedPo.site_id || row.vendor_id !== selectedPo.vendor_id || row.reference_number !== selectedPo.po_number) {
            throw new Error(`Row ${rowNo}: Purchase Order, Company, Site, Vendor and Reference must match.`);
          }
        } else if (row.po_source === "manual") {
          if (!row.site_id) throw new Error(`Row ${rowNo}: Site / Project is required for a Manual / Old PO.`);
          if (!row.reference_number.trim()) throw new Error(`Row ${rowNo}: Manual PO Number / Reference is required.`);
        } else {
          throw new Error(`Row ${rowNo}: Choose SiteQube PO or Manual / Old PO.`);
        }
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
      formData.append("po_source", row.payment_type === "Purchase Order" ? row.po_source : "");
      formData.append("purchase_order_id", row.payment_type === "Purchase Order" && row.po_source === "siteqube" ? row.purchase_order_id : "");
      formData.append("site_id", row.payment_type === "Purchase Order" ? row.site_id : "");
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
        type={message === "Payments saved successfully." || message.startsWith("Pasted ") ? "success" : "error"}
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

        <div className="max-h-[70vh] overflow-auto">
        <table className="w-full min-w-[1500px] border-collapse text-sm">
          <thead className="sticky top-0 z-20 bg-slate-100 text-xs uppercase tracking-wide text-slate-600 shadow-[0_1px_0_0_#cbd5e1]">
            <tr>
              <th className="border border-slate-200 px-2.5 py-2 text-left font-semibold">Company</th>
              <th className="border border-slate-200 px-2.5 py-2 text-left font-semibold">Payment Against</th>
              <th className="border border-slate-200 px-2.5 py-2 text-left font-semibold">Reference</th>
              <th className="border border-slate-200 px-2.5 py-2 text-left font-semibold">From Account</th>
              <th className="border border-slate-200 px-2.5 py-2 text-left font-semibold">Vendor / Party</th>
              <th className="border border-slate-200 px-2.5 py-2 text-left font-semibold">Payment Date</th>
              <th className="border border-slate-200 px-2.5 py-2 text-right font-semibold">Total Payment</th>
              <th className="border border-slate-200 px-2.5 py-2 text-right font-semibold">TDS Deducted</th>
              <th className="border border-slate-200 px-2.5 py-2 text-right font-semibold">Transferred Amount</th>
              <th className="border border-slate-200 px-2.5 py-2 text-center font-semibold">Remove</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100" onKeyDown={handleGridKeyDown}>
            {rows.map((row, index) => (
              <tr key={index} data-payment-grid-row={index} className={`transition hover:bg-sky-50/70 ${index % 2 ? "bg-slate-50/70" : "bg-white"}`}>
                <td className="border border-slate-200 p-1 align-middle">
                  <select
                    data-payment-grid-cell="true"
                    data-payment-grid-column="0"
                    value={row.company_id}
                    onChange={(e) => handleCompanySelect(index, e.target.value)}
                    disabled={row.payment_type === "Purchase Order" && row.po_source === "siteqube" && Boolean(row.purchase_order_id)}
                    onPaste={(e) => handlePaste(e, index, 0)}
                    className="h-8 w-full rounded border border-transparent bg-white px-2 text-[13px] outline-none transition hover:border-slate-300 focus:border-sky-600 focus:bg-sky-50 focus:ring-2 focus:ring-sky-100 disabled:bg-slate-100"
                  >
                    <option value="">Select Company</option>
                    {companiesForRow(row).map((company) => (
                      <option key={company.id} value={company.id}>
                        {company.company_name}
                        {company.company_code
                          ? ` (${company.company_code})`
                          : ""}
                      </option>
                    ))}
                  </select>
                </td>

                <td className="border border-slate-200 p-1 align-middle">
                  <select
                    data-payment-grid-cell="true"
                    data-payment-grid-column="1"
                    value={row.payment_type}
                    onChange={(e) =>
                      updateRow(index, "payment_type", e.target.value)
                    }
                    onPaste={(e) => handlePaste(e, index, 1)}
                    className="h-8 w-full rounded border border-transparent bg-white px-2 text-[13px] outline-none transition hover:border-slate-300 focus:border-sky-600 focus:bg-sky-50 focus:ring-2 focus:ring-sky-100"
                  >
                    {PAYMENT_TYPES.map((type) => (
                      <option key={type}>{type}</option>
                    ))}
                  </select>
                </td>

                <td className="border border-slate-200 p-1 align-middle">
                  {row.payment_type === "Purchase Order" ? (
                    <div className="min-w-44 space-y-1.5">
                      <select
                        data-payment-grid-cell="true"
                        data-payment-grid-column="2"
                        aria-label={`PO Source row ${index + 1}`}
                        value={row.po_source}
                        onChange={(event) => handlePurchaseOrderSourceSelect(index, event.target.value as "siteqube" | "manual")}
                        className="h-7 w-full rounded border border-slate-200 bg-slate-50 px-2 text-[11px] font-semibold text-slate-700 outline-none focus:border-sky-600"
                      >
                        <option value="siteqube">SiteQube PO</option>
                        <option value="manual">Manual / Old PO</option>
                      </select>
                      {row.po_source === "siteqube" ? (
                        <select
                          data-payment-grid-cell="true"
                          data-payment-grid-column="2"
                          aria-label={`SiteQube Purchase Order row ${index + 1}`}
                          value={row.purchase_order_id}
                          onChange={(event) => handlePurchaseOrderSelect(index, event.target.value)}
                          onPaste={(event) => handlePaste(event, index, 2)}
                          className="h-8 w-full rounded border border-slate-200 bg-white px-2 text-[12px] outline-none focus:border-sky-600"
                        >
                          <option value="">Select current PO</option>
                          {purchaseOrders.filter((po) => !row.company_id || po.company_id === row.company_id).map((po) => (
                            <option key={po.id} value={po.id}>
                              {paymentPurchaseOrderLabel(po)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          data-payment-grid-cell="true"
                          data-payment-grid-column="2"
                          aria-label={`Manual PO Number row ${index + 1}`}
                          value={row.reference_number}
                          onChange={(event) => updateRow(index, "reference_number", event.target.value)}
                          onPaste={(event) => handlePaste(event, index, 2)}
                          placeholder="Manual PO Number *"
                          className="h-8 w-full rounded border border-slate-200 bg-white px-2 text-[12px] outline-none focus:border-sky-600"
                        />
                      )}
                      {row.po_source === "manual" ? (
                        <select
                          data-payment-grid-cell="true"
                          data-payment-grid-column="2"
                          aria-label={`Site / Project row ${index + 1}`}
                          value={row.site_id}
                          onChange={(event) => updateRow(index, "site_id", event.target.value)}
                          className="h-7 w-full rounded border border-slate-200 bg-white px-2 text-[11px] outline-none focus:border-sky-600"
                        >
                          <option value="">Select Site / Project *</option>
                          {sitesForRow(row).map((site) => (
                            <option key={site.id} value={site.id}>{siteLabel(site.id)}</option>
                          ))}
                        </select>
                      ) : (
                        <div className="truncate px-1 text-[11px] text-slate-600" title={siteLabel(row.site_id)}>
                          Site: {siteLabel(row.site_id) || "Selected from PO"}
                        </div>
                      )}
                    </div>
                  ) : row.payment_type === "Work Order" ? (
                    <select
                      data-payment-grid-cell="true"
                      data-payment-grid-column="2"
                      value={row.work_order_id}
                      onChange={(e) =>
                        handleWorkOrderSelect(index, e.target.value)
                      }
                      onPaste={(e) => handlePaste(e, index, 2)}
                      className="h-8 w-full rounded border border-transparent bg-white px-2 text-[13px] outline-none transition hover:border-slate-300 focus:border-sky-600 focus:bg-sky-50 focus:ring-2 focus:ring-sky-100"
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
                      data-payment-grid-cell="true"
                      data-payment-grid-column="2"
                      value={row.reference_number}
                      onChange={(e) =>
                        updateRow(index, "reference_number", e.target.value)
                      }
                      onPaste={(e) => handlePaste(e, index, 2)}
                      className="h-8 w-full rounded border border-transparent bg-white px-2 text-[13px] outline-none transition hover:border-slate-300 focus:border-sky-600 focus:bg-sky-50 focus:ring-2 focus:ring-sky-100"
                      placeholder={textReferenceLabels[row.payment_type] || "Reference"}
                    />
                  )}
                </td>

                <td className="border border-slate-200 p-1 align-middle">
                  {(() => {
                    const companyAccounts = accountsForCompany(row.company_id);
                    return (
                  <select
                    data-payment-grid-cell="true"
                    data-payment-grid-column="3"
                    value={row.company_bank_account_id}
                    onChange={(e) =>
                      updateRow(
                        index,
                        "company_bank_account_id",
                        e.target.value
                      )
                    }
                    disabled={!row.company_id || companyAccounts.length === 0}
                    onPaste={(e) => handlePaste(e, index, 3)}
                    className="h-8 w-full rounded border border-transparent bg-white px-2 text-[13px] outline-none transition hover:border-slate-300 focus:border-sky-600 focus:bg-sky-50 focus:ring-2 focus:ring-sky-100 disabled:bg-slate-100"
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

                <td className="border border-slate-200 p-1 align-middle">
                  {row.payment_type === "Work Order" && row.linked_vendors.length > 1 ? (
                    <select
                      data-payment-grid-cell="true"
                      data-payment-grid-column="4"
                      value={row.vendor_id}
                      onChange={(e) => {
                        const vendor = row.linked_vendors.find(
                          (item: any) => item.vendor_id === e.target.value
                        );
                        updateRow(index, "vendor_id", e.target.value);
                        updateRow(index, "vendor_name", vendor?.vendor_name || "");
                      }}
                      onPaste={(e) => handlePaste(e, index, 4)}
                      className="h-8 w-full rounded border border-transparent bg-white px-2 text-[13px] outline-none transition hover:border-slate-300 focus:border-sky-600 focus:bg-sky-50 focus:ring-2 focus:ring-sky-100"
                    >
                      <option value="">Select Vendor</option>
                      {row.linked_vendors.map((vendor: any) => (
                        <option key={vendor.vendor_id} value={vendor.vendor_id}>
                          {vendor.vendor_name} — {vendor.vendor_role}
                        </option>
                      ))}
                    </select>
                  ) : row.payment_type === "Purchase Order" && row.po_source === "siteqube" ? (
                    <input
                      data-payment-grid-cell="true"
                      data-payment-grid-column="4"
                      aria-label={`PO Vendor row ${index + 1}`}
                      value={row.vendor_name}
                      readOnly
                      onPaste={(event) => handlePaste(event, index, 4)}
                      className="h-8 w-full rounded border border-transparent bg-slate-100 px-2 text-[13px] text-slate-700 outline-none"
                      placeholder="Vendor from PO"
                    />
                  ) : row.payment_type === "Purchase Order" ? (
                    <select
                      data-payment-grid-cell="true"
                      data-payment-grid-column="4"
                      aria-label={`Manual PO Vendor row ${index + 1}`}
                      value={row.vendor_id}
                      onChange={(e) => {
                        const vendor = purchaseOrderVendors.find(
                          (item) => item.id === e.target.value
                        );
                        updateRow(index, "vendor_id", e.target.value);
                        updateRow(index, "vendor_name", vendor?.vendor_name || "");
                      }}
                      onPaste={(e) => handlePaste(e, index, 4)}
                      className="h-8 w-full rounded border border-transparent bg-white px-2 text-[13px] outline-none transition hover:border-slate-300 focus:border-sky-600 focus:bg-sky-50 focus:ring-2 focus:ring-sky-100"
                    >
                      <option value="">Select Vendor *</option>
                      {purchaseOrderVendors.map((vendor) => (
                        <option key={vendor.id} value={vendor.id}>
                          {vendor.vendor_name}
                        </option>
                      ))}
                    </select>
                  ) : row.payment_type === "Internal Transfer" ? (
                    <select
                      data-payment-grid-cell="true"
                      data-payment-grid-column="4"
                      value={row.to_company_bank_account_id}
                      onChange={(e) =>
                        handleInternalTransferSelect(index, e.target.value)
                      }
                      onPaste={(e) => handlePaste(e, index, 4)}
                      className="h-8 w-full rounded border border-transparent bg-white px-2 text-[13px] outline-none transition hover:border-slate-300 focus:border-sky-600 focus:bg-sky-50 focus:ring-2 focus:ring-sky-100"
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
                      data-payment-grid-cell="true"
                      data-payment-grid-column="4"
                      value={row.vendor_name}
                      onChange={(e) =>
                        updateRow(index, "vendor_name", e.target.value)
                      }
                      readOnly={
                        row.payment_type === "Work Order" ||
                        row.payment_type === "Invoice"
                      }
                      onPaste={(e) => handlePaste(e, index, 4)}
                      className="h-8 w-full rounded border border-transparent bg-slate-50 px-2 text-[13px] outline-none transition hover:border-slate-300 focus:border-sky-600 focus:ring-2 focus:ring-sky-100 read-only:text-slate-600"
                      placeholder="Vendor / Party"
                    />
                  )}
                </td>

                <Cell
                  value={row.payment_date}
                  type="date"
                  rowIndex={index}
                  columnIndex={5}
                  onPaste={(e) => handlePaste(e, index, 5)}
                  onChange={(value) => updateRow(index, "payment_date", value)}
                />

                <Cell
                  value={row.total_payment}
                  type="number"
                  rowIndex={index}
                  columnIndex={6}
                  onPaste={(e) => handlePaste(e, index, 6)}
                  prefix="₹"
                  onChange={(value) =>
                    updateRow(index, "total_payment", onlyNumber(value))
                  }
                />

                <Cell
                  value={row.tds_amount}
                  type="number"
                  rowIndex={index}
                  columnIndex={7}
                  onPaste={(e) => handlePaste(e, index, 7)}
                  prefix="₹"
                  onChange={(value) =>
                    updateRow(index, "tds_amount", onlyNumber(value))
                  }
                />

                <td className="border border-slate-200 p-1 font-medium">
                  <div aria-readonly="true" className="flex h-8 items-center justify-end rounded border border-slate-200 bg-slate-100 px-2 font-semibold tabular-nums text-slate-700">
                    ₹ {transferred(row).toLocaleString("en-IN")}
                  </div>
                </td>

                <td className="border border-slate-200 p-1 text-center align-middle">
                  <button
                    type="button"
                    onClick={() => removeRow(index)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded border border-red-200 bg-red-50 text-xs font-bold text-red-700 transition hover:bg-red-100"
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
  rowIndex,
  columnIndex,
  onPaste,
  prefix,
  type = "text",
}: {
  value: string;
  onChange: (value: string) => void;
  rowIndex: number;
  columnIndex: number;
  onPaste: (event: React.ClipboardEvent<HTMLInputElement>) => void;
  prefix?: string;
  type?: string;
}) {
  return (
    <td className="border border-slate-200 p-1 align-middle">
      <div className="relative">
        {prefix && <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">{prefix}</span>}
        <input
          data-payment-grid-cell="true"
          data-payment-grid-column={columnIndex}
          data-payment-grid-row={rowIndex}
          type={type}
          step="1"
          min={type === "number" ? "0" : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onPaste={onPaste}
          className={`h-8 w-full rounded border border-transparent bg-white px-2 text-[13px] outline-none transition hover:border-slate-300 focus:border-sky-600 focus:bg-sky-50 focus:ring-2 focus:ring-sky-100 ${type === "number" ? "text-right tabular-nums" : ""} ${prefix ? "pl-6" : ""}`}
        />
      </div>
    </td>
  );
}
