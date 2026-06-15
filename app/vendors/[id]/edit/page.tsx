"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type VendorForm = {
  vendor_name: string;
  vendor_type: string;
  contractor_type: string;
  status: string;
  pan: string;
  aadhaar_cin: string;
  gstin: string;
  pan_aadhaar_link_status: string;
  msme_registered: string;
  msme_number: string;
  msme_category: string;
};

type Contact = {
  contact_name: string;
  contact_number: string;
  email: string;
  designation: string;
  is_primary: boolean;
};

type BankAccount = {
  account_holder_name: string;
  account_number: string;
  ifsc_code: string;
  bank_name: string;
  branch_name: string;
  is_primary: boolean;
};

type GstinRow = {
  gstin: string;
  state_code: string;
  state_name: string;
  is_primary: boolean;
};

type VendorDocument = {
  id: string;
  document_type: string;
  file_name: string | null;
  file_url: string | null;
  uploaded_at: string | null;
  is_verified?: boolean | null;
};

type FileKey =
  | "PAN"
  | "AADHAAR_CIN"
  | "GST_CERTIFICATE"
  | "PAN_AADHAAR_ATTACHMENT"
  | "MSME_CERTIFICATE"
  | "BANK_PROOF"
  | "ADDITIONAL_DOCUMENT";

const emptyContact: Contact = {
  contact_name: "",
  contact_number: "",
  email: "",
  designation: "",
  is_primary: true,
};

const emptyBankAccount: BankAccount = {
  account_holder_name: "",
  account_number: "",
  ifsc_code: "",
  bank_name: "",
  branch_name: "",
  is_primary: true,
};

const emptyGstin: GstinRow = {
  gstin: "",
  state_code: "",
  state_name: "",
  is_primary: true,
};

export default function EditVendorPage() {
  const params = useParams();
  const router = useRouter();
  const vendorId = params.id as string;

  const [form, setForm] = useState<VendorForm>({
    vendor_name: "",
    vendor_type: "Contractor",
    contractor_type: "Company",
    status: "active",
    pan: "",
    aadhaar_cin: "",
    gstin: "",
    pan_aadhaar_link_status: "Yet to check",
    msme_registered: "No",
    msme_number: "",
    msme_category: "Micro",
  });
  const [contacts, setContacts] = useState<Contact[]>([{ ...emptyContact }]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([
    { ...emptyBankAccount },
  ]);
  const [gstins, setGstins] = useState<GstinRow[]>([{ ...emptyGstin }]);
  const [documents, setDocuments] = useState<VendorDocument[]>([]);
  const [files, setFiles] = useState<Record<FileKey, File | null>>({
    PAN: null,
    AADHAAR_CIN: null,
    GST_CERTIFICATE: null,
    PAN_AADHAAR_ATTACHMENT: null,
    MSME_CERTIFICATE: null,
    BANK_PROOF: null,
    ADDITIONAL_DOCUMENT: null,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function loadVendor() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session?.access_token) {
          throw new Error("Your session expired. Please log in again.");
        }

        const response = await fetch(`/api/vendors/${vendorId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error || "Failed to load vendor.");
        }

        const vendor = result.vendor;

        setForm({
          vendor_name: vendor.vendor_name || "",
          vendor_type: vendor.vendor_type || "Contractor",
          contractor_type: vendor.contractor_type || "Company",
          status: vendor.status || "active",
          pan: vendor.pan || "",
          aadhaar_cin: vendor.aadhaar_cin || "",
          gstin: vendor.gstin || "",
          pan_aadhaar_link_status:
            vendor.pan_aadhaar_link_status || "Yet to check",
          msme_registered: vendor.msme_registered ? "Yes" : "No",
          msme_number: vendor.msme_number || "",
          msme_category: vendor.msme_category || "Micro",
        });

        setContacts(
          result.contacts?.length
            ? result.contacts.map((contact: any) => ({
                contact_name: contact.contact_name || "",
                contact_number: contact.contact_number || "",
                email: contact.email || "",
                designation: contact.designation || "",
                is_primary: contact.is_primary === true,
              }))
            : [{ ...emptyContact }]
        );

        setBankAccounts(
          result.bankAccounts?.length
            ? result.bankAccounts.map((bank: any) => ({
                account_holder_name: bank.account_holder_name || "",
                account_number: bank.account_number || "",
                ifsc_code: bank.ifsc_code || "",
                bank_name: bank.bank_name || "",
                branch_name: bank.branch_name || "",
                is_primary: bank.is_primary === true,
              }))
            : [{ ...emptyBankAccount }]
        );

        const loadedGstins =
          result.gstins?.length > 0
            ? result.gstins
            : vendor.gstin
            ? [
                {
                  gstin: vendor.gstin,
                  state_code: vendor.gstin.slice(0, 2),
                  state_name: "",
                  is_primary: true,
                },
              ]
            : [];

        setGstins(
          loadedGstins.length
            ? loadedGstins.map((gstin: any, index: number) => ({
                gstin: gstin.gstin || "",
                state_code: gstin.state_code || gstin.gstin?.slice(0, 2) || "",
                state_name: gstin.state_name || "",
                is_primary: gstin.is_primary === true || index === 0,
              }))
            : [{ ...emptyGstin }]
        );

        setDocuments(result.documents || []);
      } catch (error: any) {
        setMessage(error.message || "Failed to load vendor.");
      } finally {
        setLoading(false);
      }
    }

    if (vendorId) loadVendor();
  }, [vendorId]);

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) {
    const { name, value } = e.target;
    const finalValue = ["pan", "gstin", "aadhaar_cin", "ifsc_code"].includes(name)
      ? value.toUpperCase()
      : value;

    setForm((prev) => ({ ...prev, [name]: finalValue }));
  }

  function updateContact(index: number, field: keyof Contact, value: string | boolean) {
    setContacts((prev) =>
      prev.map((contact, i) =>
        i === index ? { ...contact, [field]: value } : contact
      )
    );
  }

  function addContact() {
    setContacts((prev) => [
      ...prev,
      { ...emptyContact, is_primary: false },
    ]);
  }

  function removeContact(index: number) {
    if (contacts.length === 1) return;
    setContacts((prev) => prev.filter((_, i) => i !== index));
  }

  function setPrimaryContact(index: number) {
    setContacts((prev) =>
      prev.map((contact, i) => ({ ...contact, is_primary: i === index }))
    );
  }

  function updateBank(index: number, field: keyof BankAccount, value: string | boolean) {
    setBankAccounts((prev) =>
      prev.map((bank, i) => (i === index ? { ...bank, [field]: value } : bank))
    );
  }

  function addBankAccount() {
    setBankAccounts((prev) => [
      ...prev,
      { ...emptyBankAccount, is_primary: false },
    ]);
  }

  function removeBankAccount(index: number) {
    if (bankAccounts.length === 1) return;
    setBankAccounts((prev) => prev.filter((_, i) => i !== index));
  }

  function setPrimaryBank(index: number) {
    setBankAccounts((prev) =>
      prev.map((bank, i) => ({ ...bank, is_primary: i === index }))
    );
  }

  function updateGstin(index: number, field: keyof GstinRow, value: string | boolean) {
    setGstins((prev) =>
      prev.map((gstin, i) => {
        if (i !== index) return gstin;

        if (field === "gstin" && typeof value === "string") {
          const normalized = value.toUpperCase();
          return {
            ...gstin,
            gstin: normalized,
            state_code: normalized.slice(0, 2),
          };
        }

        return { ...gstin, [field]: value };
      })
    );
  }

  function addGstin() {
    setGstins((prev) => [
      ...prev,
      { ...emptyGstin, is_primary: false },
    ]);
  }

  function removeGstin(index: number) {
    if (gstins.length === 1) {
      setGstins([{ ...emptyGstin }]);
      setForm((prev) => ({ ...prev, gstin: "" }));
      return;
    }

    setGstins((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (!next.some((gstin) => gstin.is_primary)) {
        next[0] = { ...next[0], is_primary: true };
      }
      const primary = next.find((gstin) => gstin.is_primary)?.gstin || "";
      setForm((current) => ({ ...current, gstin: primary }));
      return next;
    });
  }

  function setPrimaryGstin(index: number) {
    setGstins((prev) => {
      const next = prev.map((gstin, i) => ({
        ...gstin,
        is_primary: i === index,
      }));
      setForm((current) => ({ ...current, gstin: next[index]?.gstin || "" }));
      return next;
    });
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>, key: FileKey) {
    setFiles((prev) => ({ ...prev, [key]: e.target.files?.[0] || null }));
  }

  async function openDocument(document: VendorDocument) {
    if (!document.id) {
      setMessage("Document id is missing.");
      return;
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      setMessage("Your session expired. Please log in again.");
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
      setMessage(
        result.error || `Could not open ${document.file_name || "document"}.`
      );
      return;
    }

    window.open(result.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");

    if (!form.vendor_name.trim()) {
      setMessage("Vendor Name is required.");
      return;
    }

    if (form.status === "active" && !form.pan.trim()) {
      setMessage("PAN is required when vendor status is active.");
      return;
    }

    const contactRows = contacts.filter((contact) =>
      [
        contact.contact_name,
        contact.contact_number,
        contact.email,
        contact.designation,
      ].some((value) => value.trim())
    );

    for (const contact of contactRows) {
      if (!contact.contact_name.trim() || !contact.contact_number.trim()) {
        setMessage("Contact name and contact number are required for contact rows.");
        return;
      }
    }

    const bankRows = bankAccounts.filter((bank) =>
      [
        bank.account_holder_name,
        bank.account_number,
        bank.ifsc_code,
        bank.bank_name,
        bank.branch_name,
      ].some((value) => value.trim())
    );

    for (const bank of bankRows) {
      if (
        !bank.account_holder_name.trim() ||
        !bank.account_number.trim() ||
        !bank.ifsc_code.trim() ||
        !bank.bank_name.trim()
      ) {
        setMessage(
          "Account holder, account number, IFSC and bank name are required for bank rows."
        );
        return;
      }
    }

    const gstinRows = gstins.filter((gstin) => gstin.gstin.trim());
    const primaryGstin = gstinRows.find((gstin) => gstin.is_primary) || gstinRows[0];

    if (
      form.pan_aadhaar_link_status === "Yes" &&
      !documents.some((document) => document.document_type === "PAN_AADHAAR_ATTACHMENT") &&
      !files.PAN_AADHAAR_ATTACHMENT
    ) {
      setMessage("PAN-Aadhaar Link Proof is required when PAN is linked with Aadhaar.");
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

      const payload = new FormData();

      payload.append(
        "vendor",
        JSON.stringify({
          vendor_type: form.vendor_type,
          contractor_type: form.contractor_type,
          status: form.status,
          pan: form.pan,
          aadhaar_cin: form.aadhaar_cin,
          gstin: primaryGstin?.gstin || form.gstin,
          pan_aadhaar_link_status: form.pan_aadhaar_link_status,
          msme_registered: form.msme_registered,
          msme_number: form.msme_number,
          msme_category: form.msme_category,
        })
      );
      payload.append("contacts", JSON.stringify(contactRows));
      payload.append("bank_accounts", JSON.stringify(bankRows));
      payload.append("gstins", JSON.stringify(gstinRows));

      for (const [documentType, file] of Object.entries(files) as [
        FileKey,
        File | null
      ][]) {
        if (file) {
          payload.append(`document:${documentType}`, file);
        }
      }

      const response = await fetch(`/api/vendors/${vendorId}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: payload,
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to update vendor.");
      }

      router.push(`/vendors/${vendorId}`);
    } catch (error: any) {
      setMessage(error.message || "Failed to update vendor.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Loading vendor...</p>;
  }

  function documentLabel(value: string | null) {
    const labels: Record<string, string> = {
      PAN: "PAN",
      AADHAAR_CIN: "Aadhaar/CIN",
      GST_CERTIFICATE: "GST Certificate",
      PAN_AADHAAR_ATTACHMENT: "PAN-Aadhaar Link Proof",
      MSME_CERTIFICATE: "MSME Certificate",
      BANK_PROOF: "Bank Proof",
      ADDITIONAL_DOCUMENT: "Additional Document",
    };

    return value ? labels[value] || value.replace(/_/g, " ") : "Document";
  }

  function documentLinkedNumber(document: VendorDocument) {
    const primaryGstin =
      gstins.find((gstin) => gstin.is_primary)?.gstin ||
      gstins.find((gstin) => gstin.gstin)?.gstin ||
      form.gstin;
    const primaryBank =
      bankAccounts.find((account) => account.is_primary) || bankAccounts[0];

    switch (document.document_type) {
      case "PAN":
        return form.pan || "-";
      case "AADHAAR_CIN":
        return form.aadhaar_cin || "-";
      case "GST_CERTIFICATE":
        return primaryGstin || "-";
      case "PAN_AADHAAR_ATTACHMENT":
        return [form.pan, form.pan_aadhaar_link_status].filter(Boolean).join(" / ") || "-";
      case "MSME_CERTIFICATE":
        return form.msme_number || "-";
      case "BANK_PROOF":
        return primaryBank?.account_number
          ? `Account ending ${primaryBank.account_number.slice(-4)}`
          : "-";
      default:
        return "-";
    }
  }

  const inputClass =
    "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-sky-700 focus:ring-2 focus:ring-sky-100";
  const compactInputClass =
    "h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-sky-700 focus:ring-2 focus:ring-sky-100";
  const labelClass =
    "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500";
  const cardClass =
    "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
  const sectionTitleClass = "text-lg font-semibold text-slate-950";

  return (
    <form onSubmit={handleSubmit} className="space-y-6 pb-24">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <nav className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            <span>Master Setup</span>
            <span>/</span>
            <span>Vendors</span>
            <span>/</span>
            <span className="text-slate-700">Edit Vendor</span>
          </nav>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold text-slate-950">
              Edit Vendor:{" "}
              <span className="text-sky-700">{form.vendor_name || "Vendor"}</span>
            </h1>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold uppercase text-emerald-700">
              {form.status || "active"}
            </span>
          </div>
          <p className="mt-2 text-sm text-slate-500">
            Update vendor master information, contacts, bank accounts and documents.
          </p>
        </div>

        <Link
          href={`/vendors/${vendorId}`}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Back to Vendor Master
        </Link>
      </div>

      {message && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {message}
        </div>
      )}

      <div className="grid grid-cols-12 gap-6">
        <section className={`${cardClass} col-span-12 border-t-4 border-t-sky-700 lg:col-span-8`}>
          <div className="mb-5 flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className={sectionTitleClass}>Basic Information</h2>
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Ref ID: {vendorId.slice(0, 8)}
            </span>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className={labelClass}>Vendor Name *</label>
              <input
                name="vendor_name"
                value={form.vendor_name}
                readOnly
                className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-600"
              />
              <p className="mt-1 text-xs text-slate-500">
                Vendor name can only be changed by Super Admin / Platform Owner.
              </p>
            </div>

            <div>
              <label className={labelClass}>Vendor Type *</label>
              <select
                name="vendor_type"
                value={form.vendor_type}
                onChange={handleChange}
                className={inputClass}
              >
                <option>Contractor</option>
                <option>Supplier</option>
                <option>Consultant</option>
                <option>Labour Contractor</option>
                <option>Equipment Rental</option>
                <option>Transporter</option>
              </select>
            </div>

            <div>
              <label className={labelClass}>Contractor Type *</label>
              <select
                name="contractor_type"
                value={form.contractor_type}
                onChange={handleChange}
                className={inputClass}
              >
                <option>Company</option>
                <option>LLP</option>
                <option>Partnership</option>
                <option>Proprietor</option>
              </select>
            </div>

            <div>
              <label className={labelClass}>Status *</label>
              <select
                name="status"
                value={form.status}
                onChange={handleChange}
                className={inputClass}
              >
                <option value="active">active</option>
                <option value="inactive">inactive</option>
                <option value="blocked">blocked</option>
              </select>
            </div>
          </div>
        </section>

        <section className={`${cardClass} col-span-12 border-t-4 border-t-sky-700 lg:col-span-4`}>
          <div className="mb-5 border-b border-slate-100 pb-3">
            <h2 className={sectionTitleClass}>MSME Status</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className={labelClass}>MSME Registered?</label>
              <select
                name="msme_registered"
                value={form.msme_registered}
                onChange={handleChange}
                className={inputClass}
              >
                <option>No</option>
                <option>Yes</option>
              </select>
            </div>

            <div>
              <label className={labelClass}>MSME Number</label>
              <input
                name="msme_number"
                value={form.msme_number}
                onChange={handleChange}
                className={inputClass}
                placeholder="UDYAM-XX-00-0000000"
              />
            </div>

            <div>
              <label className={labelClass}>MSME Category</label>
              <select
                name="msme_category"
                value={form.msme_category}
                onChange={handleChange}
                className={inputClass}
              >
                <option>Micro</option>
                <option>Small</option>
                <option>Medium</option>
              </select>
            </div>
          </div>
        </section>

        <section className={`${cardClass} col-span-12 border-t-4 border-t-sky-700`}>
          <div className="mb-5 flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className={sectionTitleClass}>Tax & Compliance</h2>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
              Master tax profile
            </span>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <label className={labelClass}>PAN</label>
              <input
                name="pan"
                value={form.pan}
                onChange={handleChange}
                className={`${inputClass} uppercase`}
              />
            </div>

            <div>
              <label className={labelClass}>Aadhaar / CIN</label>
              <input
                name="aadhaar_cin"
                value={form.aadhaar_cin}
                onChange={handleChange}
                className={`${inputClass} uppercase`}
              />
            </div>

            <div>
              <label className={labelClass}>Primary GSTIN</label>
              <input
                name="gstin"
                value={gstins.find((gstin) => gstin.is_primary)?.gstin || form.gstin}
                onChange={(e) => {
                  const primaryIndex = Math.max(
                    0,
                    gstins.findIndex((gstin) => gstin.is_primary)
                  );
                  const normalized = e.target.value.toUpperCase();

                  setForm((prev) => ({ ...prev, gstin: normalized }));
                  updateGstin(primaryIndex, "gstin", normalized);
                }}
                className={`${inputClass} uppercase`}
              />
            </div>

            <div>
              <label className={labelClass}>PAN-Aadhaar Link Status</label>
              <select
                name="pan_aadhaar_link_status"
                value={form.pan_aadhaar_link_status}
                onChange={handleChange}
                className={inputClass}
              >
                <option>Yet to check</option>
                <option>Yes</option>
                <option>No</option>
              </select>
            </div>
          </div>
        </section>

        <section className={`${cardClass} col-span-12 border-t-4 border-t-sky-700 xl:col-span-6`}>
          <div className="mb-5 flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className={sectionTitleClass}>GST Details</h2>
            <button
              type="button"
              onClick={addGstin}
              className="rounded-lg border border-sky-200 px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-50"
            >
              + Add GSTIN
            </button>
          </div>

          <div className="space-y-4">
            {gstins.map((gstin, index) => (
              <div key={index} className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="rounded bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-700">
                    GSTIN {index + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeGstin(index)}
                    className="text-xs font-semibold uppercase text-red-600"
                  >
                    Remove
                  </button>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <input
                    aria-label="GSTIN"
                    value={gstin.gstin}
                    onChange={(e) => updateGstin(index, "gstin", e.target.value)}
                    className={`${compactInputClass} uppercase`}
                    placeholder="GSTIN"
                  />
                  <input
                    aria-label="State code"
                    value={gstin.state_code}
                    onChange={(e) =>
                      updateGstin(index, "state_code", e.target.value.toUpperCase())
                    }
                    className={`${compactInputClass} uppercase`}
                    placeholder="State Code"
                  />
                  <input
                    aria-label="State name"
                    value={gstin.state_name}
                    onChange={(e) => updateGstin(index, "state_name", e.target.value)}
                    className={compactInputClass}
                    placeholder="State Name"
                  />
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      checked={gstin.is_primary}
                      onChange={() => setPrimaryGstin(index)}
                    />
                    Primary GSTIN
                  </label>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className={`${cardClass} col-span-12 border-t-4 border-t-sky-700 xl:col-span-6`}>
          <div className="mb-5 flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className={sectionTitleClass}>Contact Persons</h2>
            <button
              type="button"
              onClick={addContact}
              className="rounded-lg border border-sky-200 px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-50"
            >
              + Add Contact
            </button>
          </div>

          <div className="space-y-4">
            {contacts.map((contact, index) => (
              <div key={index} className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-100 text-xs font-bold text-sky-800">
                      {(contact.contact_name || `C${index + 1}`)
                        .split(" ")
                        .map((part) => part[0])
                        .join("")
                        .slice(0, 2)
                        .toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-950">
                        {contact.contact_name || `Contact ${index + 1}`}
                      </p>
                      <p className="text-xs text-slate-500">
                        {contact.designation || "Vendor contact"}
                      </p>
                    </div>
                  </div>
                  {contacts.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeContact(index)}
                      className="text-xs font-semibold uppercase text-red-600"
                    >
                      Remove
                    </button>
                  )}
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <input
                    aria-label="Contact name"
                    value={contact.contact_name}
                    onChange={(e) =>
                      updateContact(index, "contact_name", e.target.value)
                    }
                    className={compactInputClass}
                    placeholder="Contact Name"
                  />
                  <input
                    aria-label="Contact number"
                    value={contact.contact_number}
                    onChange={(e) =>
                      updateContact(index, "contact_number", e.target.value)
                    }
                    className={compactInputClass}
                    placeholder="Contact Number"
                  />
                  <input
                    aria-label="Email"
                    value={contact.email}
                    onChange={(e) => updateContact(index, "email", e.target.value)}
                    className={compactInputClass}
                    placeholder="Email"
                  />
                  <input
                    aria-label="Designation"
                    value={contact.designation}
                    onChange={(e) =>
                      updateContact(index, "designation", e.target.value)
                    }
                    className={compactInputClass}
                    placeholder="Designation"
                  />
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      checked={contact.is_primary}
                      onChange={() => setPrimaryContact(index)}
                    />
                    Primary Contact
                  </label>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className={`${cardClass} col-span-12 border-t-4 border-t-sky-700`}>
          <div className="mb-5 flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className={sectionTitleClass}>Bank Accounts</h2>
            <button
              type="button"
              onClick={addBankAccount}
              className="rounded-lg border border-sky-200 px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-50"
            >
              + Add Bank Account
            </button>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            {bankAccounts.map((bank, index) => (
              <div key={index} className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <div className="mb-4 flex items-center justify-between">
                  <span className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold uppercase text-slate-600">
                    {bank.bank_name || `Bank ${index + 1}`}
                  </span>
                  {bankAccounts.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeBankAccount(index)}
                      className="text-xs font-semibold uppercase text-red-600"
                    >
                      Remove
                    </button>
                  )}
                </div>

                <div className="grid gap-3">
                  <input
                    aria-label="Account holder name"
                    value={bank.account_holder_name}
                    onChange={(e) =>
                      updateBank(index, "account_holder_name", e.target.value)
                    }
                    className={compactInputClass}
                    placeholder="Account Holder Name"
                  />
                  <input
                    aria-label="Bank name"
                    value={bank.bank_name}
                    onChange={(e) => updateBank(index, "bank_name", e.target.value)}
                    className={compactInputClass}
                    placeholder="Bank Name"
                  />
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                    <input
                      aria-label="Account number"
                      value={bank.account_number}
                      onChange={(e) =>
                        updateBank(index, "account_number", e.target.value)
                      }
                      className={compactInputClass}
                      placeholder="Account Number"
                    />
                    <input
                      aria-label="IFSC code"
                      value={bank.ifsc_code}
                      onChange={(e) =>
                        updateBank(index, "ifsc_code", e.target.value.toUpperCase())
                      }
                      className={`${compactInputClass} uppercase`}
                      placeholder="IFSC Code"
                    />
                  </div>
                  <input
                    aria-label="Branch name"
                    value={bank.branch_name}
                    onChange={(e) => updateBank(index, "branch_name", e.target.value)}
                    className={compactInputClass}
                    placeholder="Branch Name"
                  />
                  <label className="flex items-center gap-2 border-t border-slate-200 pt-3 text-sm font-medium text-slate-700">
                    <input
                      type="radio"
                      checked={bank.is_primary}
                      onChange={() => setPrimaryBank(index)}
                    />
                    Primary Bank Account
                  </label>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className={`${cardClass} col-span-12 border-t-4 border-t-sky-700`}>
          <div className="mb-5 border-b border-slate-100 pb-3">
            <h2 className={sectionTitleClass}>Documents & Attachments</h2>
          </div>

          <div className="mb-7 overflow-x-auto">
            {documents.length === 0 ? (
              <p className="rounded-xl border border-dashed p-6 text-center text-sm text-slate-500">
                No documents uploaded.
              </p>
            ) : (
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="border-y bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">File</th>
                    <th className="px-4 py-3">Linked Number</th>
                    <th className="px-4 py-3">Uploaded</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {documents.map((document) => (
                    <tr key={document.id}>
                      <td className="px-4 py-3 font-semibold">
                        {documentLabel(document.document_type)}
                      </td>
                      <td className="px-4 py-3">{document.file_name || "-"}</td>
                      <td className="px-4 py-3 text-slate-500">
                        {documentLinkedNumber(document)}
                      </td>
                      <td className="px-4 py-3">
                        {document.uploaded_at
                          ? new Date(document.uploaded_at).toLocaleDateString("en-IN")
                          : "-"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-1 text-xs font-semibold ${
                            document.is_verified
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-amber-50 text-amber-700"
                          }`}
                        >
                          {document.is_verified ? "Verified" : "Pending"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => openDocument(document)}
                          disabled={!document.file_url}
                          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50"
                        >
                          Open
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {[
              ["PAN", "PAN Copy"],
              ["AADHAAR_CIN", "Aadhaar / CIN Copy"],
              ["GST_CERTIFICATE", "GST Certificate"],
              ["PAN_AADHAAR_ATTACHMENT", "PAN-Aadhaar Link Proof"],
              ["MSME_CERTIFICATE", "MSME Certificate"],
              ["BANK_PROOF", "Cancelled Cheque / Bank Proof"],
              ["ADDITIONAL_DOCUMENT", "Additional Documents"],
            ].map(([key, label]) => (
              <div
                key={key}
                className={key === "ADDITIONAL_DOCUMENT" ? "md:col-span-2" : ""}
              >
                <label className={labelClass}>{label}</label>
                <input
                  type="file"
                  onChange={(e) => handleFileChange(e, key as FileKey)}
                  className="h-auto w-full rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-sm outline-none transition hover:border-sky-300 focus:border-sky-700"
                />
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="sticky bottom-0 z-10 -mx-2 mt-8 flex justify-end gap-3 border-t border-slate-200 bg-slate-50/95 px-2 py-4 backdrop-blur">
        <Link
          href={`/vendors/${vendorId}`}
          className="rounded-xl border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Cancel Changes
        </Link>

        <button
          type="submit"
          disabled={saving}
          className="rounded-xl bg-sky-700 px-6 py-2 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </form>
  );
}
