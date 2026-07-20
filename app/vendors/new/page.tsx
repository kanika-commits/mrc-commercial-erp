"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import AlertMessage from "@/components/AlertMessage";

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

const MAX_VENDOR_DOCUMENT_FILE_SIZE = 2 * 1024 * 1024;
const MAX_VENDOR_DOCUMENT_TOTAL_SIZE = 4.5 * 1024 * 1024;
const VENDOR_DOCUMENT_SIZE_ERROR =
  "Uploaded documents are too large for one save. Please compress files or upload fewer/smaller documents. Maximum allowed now: 2 MB per file and 4.5 MB total.";
const VENDOR_DOCUMENT_413_ERROR =
  "Uploaded documents are too large for one save. Please compress files or upload fewer/smaller documents.";

function isProprietorship(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized === "proprietor" || normalized === "proprietorship";
}

function isIndividual(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized === "individual";
}

function isPartnershipOrLlp(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized === "partnership" || normalized === "llp";
}

function allowsAadhaar(value: string) {
  return isIndividual(value) || isProprietorship(value) || isPartnershipOrLlp(value);
}

function requiresAadhaar(value: string) {
  return isIndividual(value) || isProprietorship(value);
}

function isCinContractorType(value: string) {
  const normalized = value.trim().toLowerCase();
  return [
    "company",
    "private limited",
    "private limited company",
    "pvt ltd",
    "pvt. ltd.",
    "public limited",
    "public limited company",
    "limited",
  ].includes(normalized);
}

function requiresGstin(value: string) {
  return isProprietorship(value) || isCinContractorType(value);
}

function requiresPanAadhaarProof(value: string) {
  return isIndividual(value) || isProprietorship(value);
}

function identityValueForContractorType(form: {
  contractor_type: string;
  aadhaar_number: string;
  cin_number: string;
}) {
  return isCinContractorType(form.contractor_type)
    ? form.cin_number.trim().toUpperCase()
    : form.aadhaar_number.trim();
}

async function parseVendorSaveResponse(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();

  if (response.status === 413) {
    return {
      error: VENDOR_DOCUMENT_413_ERROR,
      raw_response: text,
    };
  }

  if (contentType.includes("application/json") || text.trim().startsWith("{")) {
    try {
      return JSON.parse(text);
    } catch {
      return {
        error: text.trim()
          ? `Vendor save returned an invalid JSON response: ${text.trim()}`
          : `Vendor save failed with HTTP ${response.status} ${response.statusText}`.trim(),
        raw_response: text,
      };
    }
  }

  return {
    error:
      text.trim()
        ? `Vendor save failed before the API returned JSON: ${text.trim()}`
        :
      `Vendor save failed with HTTP ${response.status} ${response.statusText}`.trim(),
    raw_response: text,
  };
}

function validateVendorDocumentSizes(files: Record<FileKey, File | null>) {
  const selectedFiles = Object.values(files).filter((file): file is File => Boolean(file));
  const totalSize = selectedFiles.reduce((sum, file) => sum + file.size, 0);
  const oversizedFile = selectedFiles.find((file) => file.size > MAX_VENDOR_DOCUMENT_FILE_SIZE);

  if (oversizedFile || totalSize > MAX_VENDOR_DOCUMENT_TOTAL_SIZE) {
    return VENDOR_DOCUMENT_SIZE_ERROR;
  }

  return "";
}

export default function NewVendorPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const linkWorkOrderId = searchParams.get("link_work_order_id") || "";
  const linkVendorRole = searchParams.get("vendor_role") || "Subcontractor";
  const returnTo = searchParams.get("return_to") || "/vendors";

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [duplicateVendor, setDuplicateVendor] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const [form, setForm] = useState({
    vendor_name: "",
    contractor_type: "Company",
    status: "active",

    pan: "",
    aadhaar_number: "",
    cin_number: "",
    gstin: "",
    pan_aadhaar_link_status: "",

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
  const [currentStep, setCurrentStep] = useState(1);

  function collectValidationErrors() {
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
    if (!form.contractor_type.trim())
      newErrors.contractor_type = "Contractor Type is required.";

    if (!form.pan.trim()) newErrors.pan = "PAN is required.";
    else if (!panRegex.test(form.pan)) newErrors.pan = "Invalid PAN. Example: ABCDE1234F";

    if (requiresAadhaar(form.contractor_type) && !form.aadhaar_number.trim()) {
      newErrors.aadhaar_number = "Aadhaar Number is required.";
    } else if (
      allowsAadhaar(form.contractor_type) &&
      form.aadhaar_number.trim() &&
      !aadhaarRegex.test(form.aadhaar_number)
    ) {
      newErrors.aadhaar_number = "Invalid Aadhaar. It must be 12 digits.";
    }

    if (isCinContractorType(form.contractor_type) && !form.cin_number.trim()) {
      newErrors.cin_number = "CIN Number is required.";
    } else if (
      isCinContractorType(form.contractor_type) &&
      form.cin_number.trim() &&
      !cinRegex.test(form.cin_number)
    ) {
      newErrors.cin_number = "Invalid CIN format.";
    }

    if (requiresGstin(form.contractor_type) && !form.gstin.trim()) {
      newErrors.gstin = "GSTIN is required.";
    } else if (form.gstin.trim()) {
      if (!gstRegex.test(form.gstin)) {
        newErrors.gstin = "Invalid GSTIN format.";
      } else if (form.gstin.substring(2, 12) !== form.pan) {
        newErrors.gstin = "GSTIN PAN does not match entered PAN.";
      }
    }

    if (contacts.length === 0) {
      newErrors.contacts = "At least one contact is required.";
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

    if (form.msme_registered === "Yes" && !form.msme_category.trim()) {
      newErrors.msme_category = "MSME category is required.";
    }

    if (!files.PAN) newErrors.PAN = "PAN copy is required.";

    const needsIdentityDocument =
      requiresAadhaar(form.contractor_type) ||
      isCinContractorType(form.contractor_type) ||
      (isPartnershipOrLlp(form.contractor_type) && !!form.aadhaar_number.trim());

    if (needsIdentityDocument && !files.AADHAAR_CIN) {
      newErrors.AADHAAR_CIN = isCinContractorType(form.contractor_type)
        ? "CIN attachment is required."
        : "Aadhaar attachment is required.";
    }

if (!files.BANK_PROOF)
  newErrors.BANK_PROOF = "Cancelled cheque / bank proof is required.";

if ((requiresGstin(form.contractor_type) || form.gstin) && !files.GST_CERTIFICATE) {
  newErrors.GST_CERTIFICATE =
    "GST certificate is required when GSTIN is entered.";
}

    if (
      requiresPanAadhaarProof(form.contractor_type) &&
      !files.PAN_AADHAAR_ATTACHMENT
    ) {
      newErrors.PAN_AADHAAR_ATTACHMENT =
        "PAN-Aadhaar Linked Proof is required.";
    }

    if (form.msme_registered === "Yes" && !files.MSME_CERTIFICATE) {
      newErrors.MSME_CERTIFICATE = "MSME certificate is required.";
    }

    return newErrors;
  }

  function validate(step?: number) {
    const newErrors = collectValidationErrors();
    setErrors(newErrors);

    return Object.entries(newErrors).every(
      ([key]) => !step || getErrorStep(key) !== step
    );
  }

  function getErrorStep(key: string) {
    if (["vendor_name", "contractor_type"].includes(key)) {
      return 1;
    }

    if (
      key === "contacts" ||
      key.startsWith("contact_name_") ||
      key.startsWith("contact_number_") ||
      key.startsWith("email_")
    ) {
      return 2;
    }

    if (["pan", "aadhaar_number", "cin_number", "gstin"].includes(key)) {
      return 3;
    }

    if (
      [
        "account_holder_name",
        "bank_name",
        "account_number",
        "ifsc_code",
        "msme_number",
      ].includes(key)
    ) {
      return 4;
    }

    return 5;
  }

  const currentStepErrors = Object.entries(errors).filter(
    ([key]) => getErrorStep(key) === currentStep
  );

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) {
    const { name, value } = e.target;

    const finalValue =
      ["pan", "gstin", "cin_number", "ifsc_code"].includes(name)
        ? value.toUpperCase()
        : value;

    setForm((prev) => {
      const next = {
        ...prev,
        [name]: finalValue,
      };

      if (name === "msme_registered" && finalValue !== "Yes") {
        next.msme_number = "";
        next.msme_category = "";
      }

      if (name === "contractor_type") {
        if (requiresPanAadhaarProof(finalValue)) {
          next.pan_aadhaar_link_status = "Yes";
        } else {
          next.pan_aadhaar_link_status = "";
        }

        if (!allowsAadhaar(finalValue)) {
          next.aadhaar_number = "";
        }

        if (!isCinContractorType(finalValue)) {
          next.cin_number = "";
        }

        if (isIndividual(finalValue)) {
          next.gstin = "";
        }
      }

      return next;
    });

    if (name === "contractor_type") {
      setFiles((prev) => ({
        ...prev,
        AADHAAR_CIN: null,
        GST_CERTIFICATE: isIndividual(finalValue) ? null : prev.GST_CERTIFICATE,
        PAN_AADHAAR_ATTACHMENT: requiresPanAadhaarProof(finalValue)
          ? prev.PAN_AADHAAR_ATTACHMENT
          : null,
      }));
    }
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;

    setMessage("");

    const validationErrors = collectValidationErrors();
    setErrors(validationErrors);

    if (Object.keys(validationErrors).length > 0) {
      const firstErrorStep = Math.min(...Object.keys(validationErrors).map(getErrorStep));
      if (Number.isFinite(firstErrorStep)) {
        setCurrentStep(firstErrorStep);
      }
      setMessage("Please fix the highlighted errors before saving.");
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

      const documentSizeError = validateVendorDocumentSizes(files);
      if (documentSizeError) {
        throw new Error(documentSizeError);
      }

      const payload = new FormData();

      const vendorPayload = {
        ...form,
        aadhaar_cin: identityValueForContractorType(form),
        gstin: isIndividual(form.contractor_type) ? "" : form.gstin,
        pan_aadhaar_link_status: requiresPanAadhaarProof(form.contractor_type)
          ? "Yes"
          : "",
      };

      payload.append("vendor", JSON.stringify(vendorPayload));
      payload.append("contacts", JSON.stringify(contacts));
      payload.append(
        "bank_accounts",
        JSON.stringify([
          {
            account_holder_name: form.account_holder_name,
            account_number: form.account_number,
            ifsc_code: form.ifsc_code,
            bank_name: form.bank_name,
            branch_name: form.branch_name,
            is_primary: true,
          },
        ])
      );

      for (const [documentType, file] of Object.entries(files) as [
        FileKey,
        File | null
      ][]) {
        if (file) {
          payload.append(`document:${documentType}`, file);
        }
      }

      const response = await fetch("/api/vendors", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: payload,
      });

      const result = await parseVendorSaveResponse(response);

      if (!response.ok) {
        if (response.status === 409 && result.duplicate_vendor_id && linkWorkOrderId) {
          setDuplicateVendor({
            id: result.duplicate_vendor_id,
            name: result.duplicate_vendor_name || "Existing vendor",
          });
          setMessage("This vendor already exists. Link existing vendor as subcontractor?");
          return;
        }
        throw new Error(
          result.error || "Something went wrong while saving vendor."
        );
      }

      if (linkWorkOrderId) {
        await linkVendorToWorkOrder(result.vendor_id);
        return;
      }

      router.push("/vendors");
    } catch (error: any) {
      console.error(error);
      setMessage(error.message || "Something went wrong while saving vendor.");
    } finally {
      setSaving(false);
    }
  }

  async function linkVendorToWorkOrder(vendorId: string) {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error("Your session expired. Please log in again.");
    }

    const response = await fetch("/api/work-orders/vendors", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        work_order_id: linkWorkOrderId,
        vendor_id: vendorId,
        vendor_role: linkVendorRole || "Subcontractor",
      }),
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.error || "Failed to link subcontractor to Work Order.");
    }

    router.push(returnTo);
  }

  async function confirmLinkExistingVendor() {
    if (!duplicateVendor) return;

    try {
      setSaving(true);
      setMessage("");
      await linkVendorToWorkOrder(duplicateVendor.id);
    } catch (error: any) {
      setMessage(error.message || "Failed to link existing vendor.");
    } finally {
      setSaving(false);
    }
  }

  function ErrorText({ name }: { name: string }) {
    if (!errors[name]) return null;
    return <p className="mt-1 text-sm text-red-600">{errors[name]}</p>;
  }

  function goToNextStep() {
    if (!validate(currentStep)) {
      setMessage("Please fix the highlighted errors before continuing.");
      return;
    }
    setCurrentStep((step) => Math.min(step + 1, 5));
    setMessage("");
  }

  function goToPreviousStep() {
    setCurrentStep((step) => Math.max(step - 1, 1));
    setMessage("");
  }

  const steps = [
    {
      number: 1,
      title: "Basic Information",
      description: "Entity core details",
    },
    {
      number: 2,
      title: "Contact Persons",
      description: "Stakeholder network",
    },
    {
      number: 3,
      title: "Tax Details",
      description: "Legal and certificates",
    },
    {
      number: 4,
      title: "MSME & Bank Details",
      description: "Payments and MSME",
    },
    {
      number: 5,
      title: "Documents",
      description: "File uploads",
    },
  ];

  const inputClass =
    "h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100";
  const errorClass = "border-red-500";

  return (
    <form onSubmit={handleSubmit} className="min-h-[calc(100vh-8rem)]">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
            Vendor Onboarding
          </div>
          <h1 className="text-3xl font-bold text-slate-950">Add Vendor</h1>
          <p className="mt-1 text-sm text-slate-500">
            {linkWorkOrderId
              ? "Create Vendor Master record and link it to this Work Order as Subcontractor."
              : "Create contractor, subcontractor, consultant or supplier profile."}
          </p>
        </div>

        <Link
          href="/vendors"
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </Link>
      </div>

      <div className="mb-6">
        {saving && (
          <AlertMessage
            type="info"
            message="Creating vendor folder and uploading documents. Please wait."
          />
        )}
        <AlertMessage
          type="error"
          message={message}
          onClose={() => setMessage("")}
        />
        {duplicateVendor && linkWorkOrderId && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">
              {duplicateVendor.name} already exists in Vendor Master.
            </p>
            <p className="mt-1">
              Link existing vendor as subcontractor to this Work Order?
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={confirmLinkExistingVendor}
                disabled={saving}
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                Link Existing Vendor
              </button>
              <button
                type="button"
                onClick={() => setDuplicateVendor(null)}
                className="rounded-lg border border-amber-300 px-4 py-2 text-sm font-semibold text-amber-900"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:sticky lg:top-24 lg:self-start">
          <div className="mb-6">
            <h2 className="text-base font-semibold text-slate-950">Progress</h2>
            <p className="mt-1 text-xs text-slate-500">
              Step {currentStep} of {steps.length}
            </p>
          </div>

          <div className="space-y-5">
            {steps.map((step, index) => {
              const active = currentStep === step.number;
              const complete = currentStep > step.number;

              return (
                <button
                  key={step.number}
                  type="button"
                  onClick={() => setCurrentStep(step.number)}
                  className="relative flex w-full items-start gap-3 text-left"
                >
                  {index < steps.length - 1 && (
                    <span
                      className={`absolute left-[13px] top-7 h-10 w-px ${
                        complete ? "bg-sky-500" : "bg-slate-200"
                      }`}
                    />
                  )}
                  <span
                    className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      active || complete
                        ? "bg-sky-600 text-white"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {step.number}
                  </span>
                  <span>
                    <span
                      className={`block text-sm font-semibold ${
                        active ? "text-sky-700" : "text-slate-800"
                      }`}
                    >
                      {step.title}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      {step.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-8 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-600">
            Fields marked with * are required before final submission. Your inputs
            stay saved while you move between steps.
          </div>
        </aside>

        <div className="space-y-6">
          {currentStepErrors.length > 0 && (
            <AlertMessage
              type="error"
              message={`Please fix these required fields before continuing: ${currentStepErrors
                .map(([, error]) => error)
                .join(" ")}`}
              onClose={() => setErrors({})}
            />
          )}

          {currentStep === 1 && (
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="mb-5 text-xl font-semibold text-slate-950">
                Basic Information
              </h2>
              <div className="grid gap-5 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Vendor Name *
                  </label>
                  <input
                    name="vendor_name"
                    value={form.vendor_name}
                    onChange={handleChange}
                    className={`${inputClass} ${
                      errors.vendor_name ? errorClass : ""
                    }`}
                    placeholder="Enter vendor name"
                  />
                  <ErrorText name="vendor_name" />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Contractor Type *
                  </label>
                  <select
                    name="contractor_type"
                    value={form.contractor_type}
                    onChange={handleChange}
                    className={`${inputClass} ${
                      errors.contractor_type ? errorClass : ""
                    }`}
                  >
                    <option>Company</option>
                    <option>Proprietorship</option>
                    <option>Partnership</option>
                    <option>LLP</option>
                    <option>Individual</option>
                  </select>
                  <ErrorText name="contractor_type" />
                </div>

              </div>
            </section>
          )}

          {currentStep === 2 && (
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-slate-950">
                    Contact Persons
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Add the people your teams will coordinate with.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={addContact}
                  className="rounded-xl border border-sky-200 px-4 py-2 text-sm font-medium text-sky-700 hover:bg-sky-50"
                >
                  + Add Contact
                </button>
              </div>

              <div className="space-y-4">
                {contacts.map((contact, index) => (
                  <div key={index} className="rounded-xl border border-slate-200 p-4">
                    <div className="mb-4 flex items-center justify-between">
                      <strong className="text-sm text-slate-950">
                        Contact {index + 1}
                      </strong>

                      {contacts.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeContact(index)}
                          className="text-sm font-medium text-red-600"
                        >
                          Remove
                        </button>
                      )}
                    </div>

                    <div className="grid gap-5 md:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-sm font-medium text-slate-700">
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
                        <label className="mb-1 block text-sm font-medium text-slate-700">
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
                        <label className="mb-1 block text-sm font-medium text-slate-700">
                          Email
                        </label>
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
                        <label className="mb-1 block text-sm font-medium text-slate-700">
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
          )}

          {currentStep === 3 && (
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="mb-5 text-xl font-semibold text-slate-950">
                Tax Details
              </h2>
              <div className="grid gap-5 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    PAN *
                  </label>
                  <input
                    name="pan"
                    value={form.pan}
                    onChange={handleChange}
                    className={`${inputClass} uppercase ${
                      errors.pan ? errorClass : ""
                    }`}
                  />
                  <ErrorText name="pan" />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Aadhaar Number{requiresAadhaar(form.contractor_type) ? " *" : ""}
                  </label>
                  <input
                    name="aadhaar_number"
                    value={form.aadhaar_number}
                    onChange={handleChange}
                    disabled={!allowsAadhaar(form.contractor_type)}
                    className={`${inputClass} disabled:bg-slate-100 disabled:text-slate-400 ${
                      errors.aadhaar_number ? errorClass : ""
                    }`}
                  />
                  <ErrorText name="aadhaar_number" />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    CIN Number{isCinContractorType(form.contractor_type) ? " *" : ""}
                  </label>
                  <input
                    name="cin_number"
                    value={form.cin_number}
                    onChange={handleChange}
                    disabled={!isCinContractorType(form.contractor_type)}
                    className={`${inputClass} uppercase disabled:bg-slate-100 disabled:text-slate-400 ${
                      errors.cin_number ? errorClass : ""
                    }`}
                  />
                  <ErrorText name="cin_number" />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    GSTIN{requiresGstin(form.contractor_type) ? " *" : ""}
                  </label>
                  <input
                    name="gstin"
                    value={form.gstin}
                    onChange={handleChange}
                    disabled={isIndividual(form.contractor_type)}
                    className={`${inputClass} uppercase disabled:bg-slate-100 disabled:text-slate-400 ${
                      errors.gstin ? errorClass : ""
                    }`}
                  />
                  <ErrorText name="gstin" />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    PAN-Aadhaar Linked
                  </label>
                  <select
                    name="pan_aadhaar_link_status"
                    value={form.pan_aadhaar_link_status}
                    onChange={handleChange}
                    disabled={requiresPanAadhaarProof(form.contractor_type)}
                    className={`${inputClass} disabled:bg-slate-100 disabled:text-slate-400`}
                  >
                    <option value="">Not applicable</option>
                    <option>Yet to check</option>
                    <option>Yes</option>
                    <option>No</option>
                  </select>
                  {requiresPanAadhaarProof(form.contractor_type) ? (
                    <p className="mt-1 text-xs text-slate-500">
                      Always Yes for Individual and Proprietorship vendors.
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-slate-500">
                      Not required for this contractor type.
                    </p>
                  )}
                </div>
              </div>
            </section>
          )}

          {currentStep === 4 && (
            <div className="space-y-6">
              <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="mb-5 text-xl font-semibold text-slate-950">MSME</h2>
                <div className="grid gap-5 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">
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
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      MSME Number{form.msme_registered === "Yes" ? " *" : ""}
                    </label>
                    <input
                      name="msme_number"
                      value={form.msme_number}
                      onChange={handleChange}
                      disabled={form.msme_registered !== "Yes"}
                      className={`${inputClass} disabled:bg-slate-100 disabled:text-slate-400 ${
                        errors.msme_number ? errorClass : ""
                      }`}
                    />
                    <ErrorText name="msme_number" />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      MSME Category
                    </label>
                    <select
                      name="msme_category"
                      value={form.msme_category}
                      onChange={handleChange}
                      disabled={form.msme_registered !== "Yes"}
                      className={`${inputClass} disabled:bg-slate-100 disabled:text-slate-400`}
                    >
                      <option value="">Select category</option>
                      <option>Micro</option>
                      <option>Small</option>
                      <option>Medium</option>
                    </select>
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="mb-5 text-xl font-semibold text-slate-950">
                  Bank Details
                </h2>
                <div className="grid gap-5 md:grid-cols-2">
                  {[
                    ["account_holder_name", "Account Holder Name *"],
                    ["bank_name", "Bank Name *"],
                    ["account_number", "Account Number *"],
                    ["ifsc_code", "IFSC Code *"],
                    ["branch_name", "Branch Name"],
                  ].map(([name, label]) => (
                    <div
                      key={name}
                      className={name === "branch_name" ? "md:col-span-2" : ""}
                    >
                      <label className="mb-1 block text-sm font-medium text-slate-700">
                        {label}
                      </label>
                      <input
                        name={name}
                        value={(form as any)[name]}
                        onChange={handleChange}
                        className={`${inputClass} ${
                          errors[name] ? errorClass : ""
                        }`}
                      />
                      <ErrorText name={name} />
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}

          {currentStep === 5 && (
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="mb-5 text-xl font-semibold text-slate-950">
                Documents & Attachments
              </h2>

              <div className="grid gap-5 md:grid-cols-2">
                {[
                  ["PAN", "PAN Copy *"],
                  [
                    "AADHAAR_CIN",
                    `${isCinContractorType(form.contractor_type) ? "CIN Attachment" : "Aadhaar Attachment"}${
                      requiresAadhaar(form.contractor_type) ||
                      isCinContractorType(form.contractor_type) ||
                      (isPartnershipOrLlp(form.contractor_type) &&
                        form.aadhaar_number.trim())
                        ? " *"
                        : ""
                    }`,
                  ],
                  [
                    "GST_CERTIFICATE",
                    `GST Certificate${
                      requiresGstin(form.contractor_type) || form.gstin ? " *" : ""
                    }`,
                  ],
                  [
                    "MSME_CERTIFICATE",
                    `MSME Certificate${
                      form.msme_registered === "Yes" ? " *" : ""
                    }`,
                  ],
                  ...(requiresPanAadhaarProof(form.contractor_type)
                    ? ([
                        [
                          "PAN_AADHAAR_ATTACHMENT",
                          "PAN-Aadhaar Linked Proof *",
                        ],
                      ] as [string, string][])
                    : []),
                  ["BANK_PROOF", "Cancelled Cheque / Bank Proof *"],
                  ["ADDITIONAL_DOCUMENT", "Additional Documents"],
                ].map(([key, label]) => (
                  <div
                    key={key}
                    className={key === "ADDITIONAL_DOCUMENT" ? "md:col-span-2" : ""}
                  >
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      {label}
                    </label>
                    <input
                      type="file"
                      onChange={(e) => handleFileChange(e, key as FileKey)}
                      className={`${inputClass} h-auto py-2 ${
                        errors[key] ? errorClass : ""
                      }`}
                    />
                    <ErrorText name={key} />
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-6">
            <button
              type="button"
              disabled
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-400"
            >
              Save as Draft
            </button>

            <div className="flex gap-3">
              {currentStep > 1 && (
                <button
                  type="button"
                  onClick={goToPreviousStep}
                  className="rounded-xl border border-slate-200 bg-white px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Previous
                </button>
              )}

              {currentStep < 5 ? (
                <button
                  type="button"
                  onClick={goToNextStep}
                  className="rounded-xl bg-sky-700 px-5 py-2 text-sm font-semibold text-white hover:bg-sky-800"
                >
                  Next Step
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-sky-700 px-5 py-2 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-60"
                >
                  {saving ? "Saving vendor..." : "Save Vendor"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}
