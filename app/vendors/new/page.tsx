"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Contact = {
  contact_name: string;
  contact_number: string;
  email: string;
  designation: string;
  is_primary: boolean;
};

type FileKey =
  | "PAN"
  | "AADHAAR_CIN"
  | "GST_CERTIFICATE"
  | "PAN_AADHAAR_ATTACHMENT"
  | "MSME_CERTIFICATE"
  | "BANK_PROOF"
  | "ADDITIONAL_DOCUMENT";

export default function NewVendorPage() {
    console.log("SUPABASE URL:", process.env.NEXT_PUBLIC_SUPABASE_URL);
console.log(
  "SUPABASE KEY:",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.substring(0, 20)
);
  const router = useRouter();

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const [form, setForm] = useState({
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

    account_holder_name: "",
    bank_name: "",
    account_number: "",
    ifsc_code: "",
    branch_name: "",
  });

  const [contacts, setContacts] = useState<Contact[]>([
    {
      contact_name: "",
      contact_number: "",
      email: "",
      designation: "",
      is_primary: true,
    },
  ]);

  const [files, setFiles] = useState<Record<FileKey, File | null>>({
  PAN: null,
  AADHAAR_CIN: null,
  GST_CERTIFICATE: null,
  PAN_AADHAAR_ATTACHMENT: null,
  MSME_CERTIFICATE: null,
  BANK_PROOF: null,
  ADDITIONAL_DOCUMENT: null,
});

  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate() {
    const newErrors: Record<string, string> = {};

    const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
    const aadhaarRegex = /^[2-9][0-9]{11}$/;
    const cinRegex = /^[A-Z][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/;
    const gstRegex =
      /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
    const mobileRegex = /^[6-9][0-9]{9}$/;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;

    if (!form.vendor_name.trim()) newErrors.vendor_name = "Vendor Name is required.";

    if (!form.pan.trim()) newErrors.pan = "PAN is required.";
    else if (!panRegex.test(form.pan)) newErrors.pan = "Invalid PAN. Example: ABCDE1234F";

    if (!form.aadhaar_cin.trim()) {
      newErrors.aadhaar_cin = "Aadhaar / CIN is required.";
    } else if (
      form.contractor_type === "Proprietor" &&
      !aadhaarRegex.test(form.aadhaar_cin)
    ) {
      newErrors.aadhaar_cin = "Invalid Aadhaar. It must be 12 digits.";
    } else if (
      form.contractor_type === "Company" &&
      !cinRegex.test(form.aadhaar_cin)
    ) {
      newErrors.aadhaar_cin = "Invalid CIN format.";
    }

    if (form.gstin.trim()) {
      if (!gstRegex.test(form.gstin)) {
        newErrors.gstin = "Invalid GSTIN format.";
      } else if (form.gstin.substring(2, 12) !== form.pan) {
        newErrors.gstin = "GSTIN PAN does not match entered PAN.";
      }
    }

    contacts.forEach((contact, index) => {
      if (!contact.contact_name.trim()) {
        newErrors[`contact_name_${index}`] = "Contact name is required.";
      }

      if (!contact.contact_number.trim()) {
        newErrors[`contact_number_${index}`] = "Contact number is required.";
      } else if (!mobileRegex.test(contact.contact_number)) {
        newErrors[`contact_number_${index}`] = "Enter valid 10 digit mobile number.";
      }

      if (contact.email && !emailRegex.test(contact.email)) {
        newErrors[`email_${index}`] = "Invalid email format.";
      }
    });

    if (!form.account_holder_name.trim())
      newErrors.account_holder_name = "Account holder name is required.";
    if (!form.bank_name.trim()) newErrors.bank_name = "Bank name is required.";
    if (!form.account_number.trim())
      newErrors.account_number = "Account number is required.";
    if (!form.ifsc_code.trim()) newErrors.ifsc_code = "IFSC code is required.";
    else if (!ifscRegex.test(form.ifsc_code))
      newErrors.ifsc_code = "Invalid IFSC. Example: HDFC0001234";

    if (form.msme_registered === "Yes" && !form.msme_number.trim()) {
      newErrors.msme_number = "MSME number is required.";
    }

    if (!files.PAN) newErrors.PAN = "PAN copy is required.";

if (!files.AADHAAR_CIN)
  newErrors.AADHAAR_CIN = "Aadhaar / CIN copy is required.";

if (!files.PAN_AADHAAR_ATTACHMENT)
  newErrors.PAN_AADHAAR_ATTACHMENT = "PAN-Aadhaar proof is required.";

if (!files.BANK_PROOF)
  newErrors.BANK_PROOF = "Cancelled cheque / bank proof is required.";

if (form.gstin && !files.GST_CERTIFICATE) {
  newErrors.GST_CERTIFICATE =
    "GST certificate is required when GSTIN is entered.";
}

    if (form.msme_registered === "Yes" && !files.MSME_CERTIFICATE) {
      newErrors.MSME_CERTIFICATE = "MSME certificate is required.";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) {
    const { name, value } = e.target;

    const finalValue =
      ["pan", "gstin", "aadhaar_cin", "ifsc_code"].includes(name)
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
        contact_name: "",
        contact_number: "",
        email: "",
        designation: "",
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

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>, key: FileKey) {
    setFiles((prev) => ({
      ...prev,
      [key]: e.target.files?.[0] || null,
    }));
  }

  async function uploadDocument(
    organizationId: string,
    vendorId: string,
    documentType: FileKey,
    file: File
  ) {
    const safeName = file.name.replace(/[^a-zA-Z0-9.]/g, "_");
    const path = `${organizationId}/${vendorId}/${documentType}_${Date.now()}_${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from("Vendor-Documents")
      .upload(path, file);

    if (uploadError) throw uploadError;

    return {
      organization_id: organizationId,
      vendor_id: vendorId,
      document_type: documentType,
      file_name: file.name,
      file_url: path,
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");

    if (!validate()) {
      setMessage("Please fix the highlighted errors before saving.");
      return;
    }

    try {
      setSaving(true);

    const organizationId =
  "7208169c-4e3f-4d6b-b068-31931a39120f";
  const duplicateConditions = [
  `pan.eq.${form.pan}`,
  `aadhaar_cin.eq.${form.aadhaar_cin}`,
];

if (form.gstin) {
  duplicateConditions.push(`gstin.eq.${form.gstin}`);
}

const { data: duplicateVendor, error: duplicateError } = await supabase
  .from("vendors")
  .select("id, vendor_name, pan, aadhaar_cin, gstin")
  .eq("organization_id", organizationId)
  .or(duplicateConditions.join(","))
  .limit(1)
  .maybeSingle();

if (duplicateError) throw duplicateError;

if (duplicateVendor) {
  throw new Error(
    `Vendor already exists with same PAN / Aadhaar-CIN / GSTIN: ${duplicateVendor.vendor_name}`
  );
}

      const { data: vendor, error: vendorError } = await supabase
        .from("vendors")
        .insert({
          organization_id: organizationId,
          vendor_name: form.vendor_name.trim(),
          vendor_type: form.vendor_type,
          contractor_type: form.contractor_type,
          status: form.status,
          pan: form.pan,
          aadhaar_cin: form.aadhaar_cin,
          gstin: form.gstin || null,
          pan_aadhaar_link_status: form.pan_aadhaar_link_status,
          msme_registered: form.msme_registered === "Yes",
          msme_number: form.msme_registered === "Yes" ? form.msme_number : null,
          msme_category:
            form.msme_registered === "Yes" ? form.msme_category : null,
        })
        .select("id")
        .single();

      if (vendorError) throw vendorError;

      const vendorId = vendor.id;

      const contactRows = contacts.map((contact) => ({
        organization_id: organizationId,
        vendor_id: vendorId,
        contact_name: contact.contact_name.trim(),
        contact_number: contact.contact_number.trim(),
        email: contact.email.trim() || null,
        designation: contact.designation.trim() || null,
        is_primary: contact.is_primary,
      }));

      const { error: contactError } = await supabase
        .from("vendor_contacts")
        .insert(contactRows);

      if (contactError) throw contactError;

      const { error: bankError } = await supabase
        .from("vendor_bank_accounts")
        .insert({
          organization_id: organizationId,
          vendor_id: vendorId,
          account_holder_name: form.account_holder_name.trim(),
          account_number: form.account_number.trim(),
          ifsc_code: form.ifsc_code.trim(),
          bank_name: form.bank_name.trim(),
          branch_name: form.branch_name.trim() || null,
          is_primary: true,
        });

      if (bankError) throw bankError;

      const documentRows = [];

      for (const [documentType, file] of Object.entries(files) as [
        FileKey,
        File | null
      ][]) {
        if (file) {
          const uploaded = await uploadDocument(
            organizationId,
            vendorId,
            documentType,
            file
          );
          documentRows.push(uploaded);
        }
      }

      if (documentRows.length > 0) {
        const { error: documentError } = await supabase
          .from("vendor_documents")
          .insert(documentRows);

        if (documentError) throw documentError;
      }

      router.push("/vendors");
    } catch (error: any) {
      console.error(error);
      setMessage(error.message || "Something went wrong while saving vendor.");
    } finally {
      setSaving(false);
    }
  }

  function ErrorText({ name }: { name: string }) {
    if (!errors[name]) return null;
    return <p className="mt-1 text-sm text-red-600">{errors[name]}</p>;
  }

  const inputClass = "w-full rounded-lg border px-3 py-2";
  const errorClass = "border-red-500";

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Add Vendor</h1>
        <p className="text-gray-500">
          Create contractor, subcontractor, consultant or supplier profile.
        </p>
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
              onChange={handleChange}
              className={`${inputClass} ${errors.vendor_name ? errorClass : ""}`}
            />
            <ErrorText name="vendor_name" />
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
            <label className="mb-1 block text-sm font-medium">
              Contractor Type *
            </label>
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
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    Contact Name *
                  </label>
                  <input
                    value={contact.contact_name}
                    onChange={(e) =>
                      updateContact(index, "contact_name", e.target.value)
                    }
                    className={`${inputClass} ${
                      errors[`contact_name_${index}`] ? errorClass : ""
                    }`}
                  />
                  <ErrorText name={`contact_name_${index}`} />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium">
                    Contact Number *
                  </label>
                  <input
                    value={contact.contact_number}
                    onChange={(e) =>
                      updateContact(index, "contact_number", e.target.value)
                    }
                    className={`${inputClass} ${
                      errors[`contact_number_${index}`] ? errorClass : ""
                    }`}
                  />
                  <ErrorText name={`contact_number_${index}`} />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium">Email</label>
                  <input
                    value={contact.email}
                    onChange={(e) =>
                      updateContact(index, "email", e.target.value)
                    }
                    className={`${inputClass} ${
                      errors[`email_${index}`] ? errorClass : ""
                    }`}
                  />
                  <ErrorText name={`email_${index}`} />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium">
                    Designation
                  </label>
                  <input
                    value={contact.designation}
                    onChange={(e) =>
                      updateContact(index, "designation", e.target.value)
                    }
                    className={inputClass}
                  />
                </div>

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
        <h2 className="mb-4 text-xl font-semibold">Tax & Compliance</h2>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium">PAN *</label>
            <input
              name="pan"
              value={form.pan}
              onChange={handleChange}
              className={`${inputClass} uppercase ${errors.pan ? errorClass : ""}`}
            />
            <ErrorText name="pan" />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              Aadhaar / CIN *
            </label>
            <input
              name="aadhaar_cin"
              value={form.aadhaar_cin}
              onChange={handleChange}
              className={`${inputClass} uppercase ${
                errors.aadhaar_cin ? errorClass : ""
              }`}
            />
            <ErrorText name="aadhaar_cin" />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">GSTIN</label>
            <input
              name="gstin"
              value={form.gstin}
              onChange={handleChange}
              className={`${inputClass} uppercase ${
                errors.gstin ? errorClass : ""
              }`}
            />
            <ErrorText name="gstin" />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              PAN Linked with Aadhaar *
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
              className={`${inputClass} ${
                errors.msme_number ? errorClass : ""
              }`}
            />
            <ErrorText name="msme_number" />
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
        <h2 className="mb-4 text-xl font-semibold">Bank Details</h2>

        <div className="grid gap-4 md:grid-cols-2">
          {[
            ["account_holder_name", "Account Holder Name *"],
            ["bank_name", "Bank Name *"],
            ["account_number", "Account Number *"],
            ["ifsc_code", "IFSC Code *"],
            ["branch_name", "Branch Name"],
          ].map(([name, label]) => (
            <div key={name}>
              <label className="mb-1 block text-sm font-medium">{label}</label>
              <input
                name={name}
                value={(form as any)[name]}
                onChange={handleChange}
                className={`${inputClass} ${errors[name] ? errorClass : ""}`}
              />
              <ErrorText name={name} />
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-xl font-semibold">Documents & Attachments</h2>

        <div className="grid gap-4 md:grid-cols-2">
          {[
  ["PAN", "PAN Copy *"],
  ["AADHAAR_CIN", "Aadhaar / CIN Copy *"],
  ["GST_CERTIFICATE", "GST Certificate"],
  ["PAN_AADHAAR_ATTACHMENT", "PAN-Aadhaar Proof *"],
  ["MSME_CERTIFICATE", "MSME Certificate"],
  ["BANK_PROOF", "Cancelled Cheque / Bank Proof *"],
  ["ADDITIONAL_DOCUMENT", "Additional Documents"],
].map(([key, label]) => (
            <div key={key} className={key === "ADDITIONAL_DOCUMENT" ? "md:col-span-2" : ""}>
              <label className="mb-1 block text-sm font-medium">{label}</label>
              <input
                type="file"
                onChange={(e) => handleFileChange(e, key as FileKey)}
                className={`${inputClass} ${errors[key] ? errorClass : ""}`}
              />
              <ErrorText name={key} />
            </div>
          ))}
        </div>
      </section>

      <div className="flex justify-end gap-3">
        <Link href="/vendors" className="rounded-lg border px-4 py-2">
          Cancel
        </Link>

        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save Vendor"}
        </button>
      </div>
    </form>
  );
}