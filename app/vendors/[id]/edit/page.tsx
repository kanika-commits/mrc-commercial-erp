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
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
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

    setForm((prev) => ({
      ...prev,
      [name]: finalValue,
    }));
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
      {
        ...emptyContact,
        is_primary: false,
      },
    ]);
  }

  function removeContact(index: number) {
    if (contacts.length === 1) return;
    setContacts((prev) => prev.filter((_, i) => i !== index));
  }

  function setPrimaryContact(index: number) {
    setContacts((prev) =>
      prev.map((contact, i) => ({
        ...contact,
        is_primary: i === index,
      }))
    );
  }

  function updateBank(index: number, field: keyof BankAccount, value: string | boolean) {
    setBankAccounts((prev) =>
      prev.map((bank, i) => (i === index ? { ...bank, [field]: value } : bank))
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
      {
        ...emptyGstin,
        is_primary: false,
      },
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
      const primary = next[index]?.gstin || "";

      setForm((current) => ({ ...current, gstin: primary }));

      return next;
    });
  }

  function addBankAccount() {
    setBankAccounts((prev) => [
      ...prev,
      {
        ...emptyBankAccount,
        is_primary: false,
      },
    ]);
  }

  function removeBankAccount(index: number) {
    if (bankAccounts.length === 1) return;
    setBankAccounts((prev) => prev.filter((_, i) => i !== index));
  }

  function setPrimaryBank(index: number) {
    setBankAccounts((prev) =>
      prev.map((bank, i) => ({
        ...bank,
        is_primary: i === index,
      }))
    );
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>, key: FileKey) {
    setFiles((prev) => ({
      ...prev,
      [key]: e.target.files?.[0] || null,
    }));
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
    return <p className="text-gray-500">Loading vendor...</p>;
  }

  const inputClass = "w-full rounded-lg border px-3 py-2";

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Edit Vendor</h1>
          <p className="mt-2 text-gray-500">
            Update vendor master information, contacts, bank accounts and documents.
          </p>
        </div>

        <Link href={`/vendors/${vendorId}`} className="rounded-lg border px-4 py-2">
          Back to Vendor
        </Link>
      </div>

      {message && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {message}
        </div>
      )}

      <section className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-xl font-semibold">Basic Information</h2>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium">Vendor Name *</label>
            <input
              name="vendor_name"
              value={form.vendor_name}
              readOnly
              className="w-full rounded-lg border bg-gray-100 px-3 py-2 text-gray-600"
            />
            <p className="mt-1 text-xs text-gray-500">
              Vendor name can only be changed by Super Admin.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Vendor Type *</label>
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
            <label className="mb-1 block text-sm font-medium">Contractor Type *</label>
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
            <label className="mb-1 block text-sm font-medium">Status *</label>
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

      <section className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-xl font-semibold">Tax & Compliance</h2>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium">PAN</label>
            <input
              name="pan"
              value={form.pan}
              onChange={handleChange}
              className={`${inputClass} uppercase`}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Aadhaar / CIN</label>
            <input
              name="aadhaar_cin"
              value={form.aadhaar_cin}
              onChange={handleChange}
              className={`${inputClass} uppercase`}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">GSTIN</label>
            <input
              name="gstin"
              value={
                gstins.find((gstin) => gstin.is_primary)?.gstin || form.gstin
              }
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
            <label className="mb-1 block text-sm font-medium">
              PAN Linked with Aadhaar
            </label>
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

      <section className="rounded-lg border bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold">GST Details</h2>
          <button
            type="button"
            onClick={addGstin}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            + Add GSTIN
          </button>
        </div>

        <div className="space-y-4">
          {gstins.map((gstin, index) => (
            <div key={index} className="rounded-lg border p-4">
              <div className="mb-3 flex items-center justify-between">
                <strong>GSTIN {index + 1}</strong>
                <button
                  type="button"
                  onClick={() => removeGstin(index)}
                  className="text-sm text-red-600"
                >
                  Remove
                </button>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <input
                  aria-label="GSTIN"
                  value={gstin.gstin}
                  onChange={(e) => updateGstin(index, "gstin", e.target.value)}
                  className={`${inputClass} uppercase`}
                  placeholder="GSTIN"
                />
                <input
                  aria-label="State code"
                  value={gstin.state_code}
                  onChange={(e) =>
                    updateGstin(index, "state_code", e.target.value.toUpperCase())
                  }
                  className={`${inputClass} uppercase`}
                  placeholder="State Code"
                />
                <input
                  aria-label="State name"
                  value={gstin.state_name}
                  onChange={(e) => updateGstin(index, "state_name", e.target.value)}
                  className={inputClass}
                  placeholder="State Name"
                />
                <label className="flex items-center gap-2 text-sm">
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

      <section className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-xl font-semibold">MSME</h2>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium">
              MSME Registered?
            </label>
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
            <label className="mb-1 block text-sm font-medium">MSME Number</label>
            <input
              name="msme_number"
              value={form.msme_number}
              onChange={handleChange}
              className={inputClass}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">MSME Category</label>
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

      <section className="rounded-lg border bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Contact Persons</h2>
          <button
            type="button"
            onClick={addContact}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            + Add Contact
          </button>
        </div>

        <div className="space-y-4">
          {contacts.map((contact, index) => (
            <div key={index} className="rounded-lg border p-4">
              <div className="mb-3 flex items-center justify-between">
                <strong>Contact {index + 1}</strong>
                {contacts.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeContact(index)}
                    className="text-sm text-red-600"
                  >
                    Remove
                  </button>
                )}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <input
                  aria-label="Contact name"
                  value={contact.contact_name}
                  onChange={(e) =>
                    updateContact(index, "contact_name", e.target.value)
                  }
                  className={inputClass}
                  placeholder="Contact Name"
                />
                <input
                  aria-label="Contact number"
                  value={contact.contact_number}
                  onChange={(e) =>
                    updateContact(index, "contact_number", e.target.value)
                  }
                  className={inputClass}
                  placeholder="Contact Number"
                />
                <input
                  aria-label="Email"
                  value={contact.email}
                  onChange={(e) => updateContact(index, "email", e.target.value)}
                  className={inputClass}
                  placeholder="Email"
                />
                <input
                  aria-label="Designation"
                  value={contact.designation}
                  onChange={(e) =>
                    updateContact(index, "designation", e.target.value)
                  }
                  className={inputClass}
                  placeholder="Designation"
                />
                <label className="flex items-center gap-2 text-sm">
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

      <section className="rounded-lg border bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Bank Accounts</h2>
          <button
            type="button"
            onClick={addBankAccount}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            + Add Bank Account
          </button>
        </div>

        <div className="space-y-4">
          {bankAccounts.map((bank, index) => (
            <div key={index} className="rounded-lg border p-4">
              <div className="mb-3 flex items-center justify-between">
                <strong>Bank Account {index + 1}</strong>
                {bankAccounts.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeBankAccount(index)}
                    className="text-sm text-red-600"
                  >
                    Remove
                  </button>
                )}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <input
                  aria-label="Account holder name"
                  value={bank.account_holder_name}
                  onChange={(e) =>
                    updateBank(index, "account_holder_name", e.target.value)
                  }
                  className={inputClass}
                  placeholder="Account Holder Name"
                />
                <input
                  aria-label="Bank name"
                  value={bank.bank_name}
                  onChange={(e) => updateBank(index, "bank_name", e.target.value)}
                  className={inputClass}
                  placeholder="Bank Name"
                />
                <input
                  aria-label="Account number"
                  value={bank.account_number}
                  onChange={(e) =>
                    updateBank(index, "account_number", e.target.value)
                  }
                  className={inputClass}
                  placeholder="Account Number"
                />
                <input
                  aria-label="IFSC code"
                  value={bank.ifsc_code}
                  onChange={(e) =>
                    updateBank(index, "ifsc_code", e.target.value.toUpperCase())
                  }
                  className={`${inputClass} uppercase`}
                  placeholder="IFSC Code"
                />
                <input
                  aria-label="Branch name"
                  value={bank.branch_name}
                  onChange={(e) => updateBank(index, "branch_name", e.target.value)}
                  className={inputClass}
                  placeholder="Branch Name"
                />
                <label className="flex items-center gap-2 text-sm">
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

      <section className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-xl font-semibold">Documents & Attachments</h2>

        <div className="mb-6 overflow-x-auto">
          {documents.length === 0 ? (
            <p className="text-sm text-gray-500">No documents uploaded.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">File</th>
                  <th className="px-3 py-2">Uploaded</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {documents.map((document) => (
                  <tr key={document.id}>
                    <td className="px-3 py-2 font-medium">
                      {document.document_type}
                    </td>
                    <td className="px-3 py-2">{document.file_name || "-"}</td>
                    <td className="px-3 py-2">
                      {document.uploaded_at
                        ? new Date(document.uploaded_at).toLocaleDateString("en-IN")
                        : "-"}
                    </td>
                    <td className="px-3 py-2">
                      {document.is_verified ? "Verified" : "Pending"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => openDocument(document)}
                        disabled={!document.file_url}
                        className="rounded-lg border px-3 py-1 text-xs disabled:opacity-50"
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
              <label className="mb-1 block text-sm font-medium">{label}</label>
              <input
                type="file"
                onChange={(e) => handleFileChange(e, key as FileKey)}
                className={inputClass}
              />
            </div>
          ))}
        </div>
      </section>

      <div className="flex justify-end gap-3">
        <Link href={`/vendors/${vendorId}`} className="rounded-lg border px-4 py-2">
          Cancel
        </Link>

        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </form>
  );
}
