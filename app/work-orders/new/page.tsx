"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  FileText,
  Info,
  Upload,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

type Vendor = {
  id: string;
  vendor_name: string;
  pan: string | null;
};

type Company = {
  id: string;
  company_name: string;
  company_code: string;
};

type Site = {
  id: string;
  site_name: string;
  site_code: string;
};

type FormState = {
  company_id: string;
  site_id: string;
  wo_number: string;
  wo_date: string;
  wo_type: string;
  description: string;
  primary_vendor_id: string;
  primary_vendor_role: string;
};

const steps = [
  {
    id: 1,
    title: "Project Information",
    shortTitle: "Project Info",
    description: "Company, site and scope",
  },
  {
    id: 2,
    title: "Work Order Details",
    shortTitle: "WO Details",
    description: "Commercials and file",
  },
  {
    id: 3,
    title: "Vendor Assignment",
    shortTitle: "Vendor",
    description: "Primary vendor role",
  },
  {
    id: 4,
    title: "Review & Submit",
    shortTitle: "Review",
    description: "Verify and create",
  },
];

export default function NewWorkOrderPage() {
  const router = useRouter();

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [workOrderFile, setWorkOrderFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [currentStep, setCurrentStep] = useState(1);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [form, setForm] = useState<FormState>({
    company_id: "",
    site_id: "",
    wo_number: "",
    wo_date: "",
    wo_type: "Civil",
    description: "",
    primary_vendor_id: "",
    primary_vendor_role: "Main Contractor",
  });

  useEffect(() => {
    loadData();
  }, []);

  const selectedCompany = useMemo(
    () => companies.find((item) => item.id === form.company_id),
    [companies, form.company_id]
  );

  const selectedSite = useMemo(
    () => sites.find((item) => item.id === form.site_id),
    [sites, form.site_id]
  );

  const selectedVendor = useMemo(
    () => vendors.find((item) => item.id === form.primary_vendor_id),
    [vendors, form.primary_vendor_id]
  );

  async function loadData() {
    const { data: vendorData, error: vendorError } = await supabase
      .from("vendors")
      .select("id, vendor_name, pan")
      .eq("status", "active")
      .order("vendor_name");

    if (vendorError) {
      setMessage(vendorError.message);
      return;
    }

    const { data: companyData, error: companyError } = await supabase
      .from("companies")
      .select("id, company_name, company_code")
      .eq("status", "active")
      .order("company_name");

    if (companyError) {
      setMessage(companyError.message);
      return;
    }

    const { data: siteData, error: siteError } = await supabase
      .from("sites")
      .select("id, site_name, site_code")
      .eq("status", "active")
      .order("site_name");

    if (siteError) {
      setMessage(siteError.message);
      return;
    }

    setVendors(vendorData || []);
    setCompanies(companyData || []);
    setSites(siteData || []);
  }

  function clearFieldError(name: string) {
    setFieldErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) {
    const { name, value } = e.target;
    clearFieldError(name);
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function generateWorkOrderNumber() {
    const company = companies.find((item) => item.id === form.company_id);
    const site = sites.find((item) => item.id === form.site_id);

    if (!company?.company_code) {
      throw new Error("Selected company does not have company code.");
    }

    if (!site?.site_code) {
      throw new Error("Selected site does not have site code.");
    }

    const prefix = `${site.site_code}/${company.company_code}/`;

    const { data, error } = await supabase
      .from("work_orders")
      .select("wo_number")
      .like("wo_number", `${prefix}%`);

    if (error) throw error;

    let nextNumber = 101;

    if (data && data.length > 0) {
      const numbers = data
        .map((row) => {
          const parts = String(row.wo_number || "").split("/");
          return Number(parts[parts.length - 1]);
        })
        .filter((value) => Number.isFinite(value) && value > 0);

      if (numbers.length > 0) {
        nextNumber = Math.max(...numbers) + 1;
      }
    }

    return `${prefix}${nextNumber}`;
  }

  async function ensureWorkOrderNumber() {
    const existing = form.wo_number.trim();
    if (existing) return existing;
    if (!form.company_id || !form.site_id) return "";

    const generated = await generateWorkOrderNumber();
    setForm((prev) => ({ ...prev, wo_number: generated }));
    return generated;
  }

  async function validateStep(step: number) {
    const errors: Record<string, string> = {};

    if (step === 1) {
      if (!form.company_id) errors.company_id = "Company is required.";
      if (!form.site_id) errors.site_id = "Site is required.";

      if (form.company_id && form.site_id && !form.wo_number.trim()) {
        try {
          const generated = await ensureWorkOrderNumber();
          if (!generated) errors.wo_number = "Work Order number is required.";
        } catch (error: any) {
          errors.wo_number =
            error.message || "Work Order number could not be generated.";
        }
      }

      if (!form.wo_number.trim() && (!form.company_id || !form.site_id)) {
        errors.wo_number = "Select company and site to generate a Work Order number.";
      }
    }

    if (step === 2) {
      if (!form.wo_date) errors.wo_date = "WO Date is required.";
      if (!form.wo_type) errors.wo_type = "WO Type is required.";
      if (!workOrderFile) errors.work_order_file = "Work Order file is required.";
    }

    if (step === 3) {
      if (!form.primary_vendor_id) {
        errors.primary_vendor_id = "Primary vendor is required.";
      }
      if (!form.primary_vendor_role) {
        errors.primary_vendor_role = "Vendor role is required.";
      }
    }

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setMessage("Please fix the highlighted fields before continuing.");
      return false;
    }

    setMessage("");
    return true;
  }

  async function goNext() {
    const isValid = await validateStep(currentStep);
    if (isValid) setCurrentStep((step) => Math.min(step + 1, steps.length));
  }

  function goPrevious() {
    setMessage("");
    setFieldErrors({});
    setCurrentStep((step) => Math.max(step - 1, 1));
  }

  async function findFirstInvalidStep() {
    for (const step of [1, 2, 3]) {
      const isValid = await validateStep(step);
      if (!isValid) return step;
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");

    const firstInvalidStep = await findFirstInvalidStep();
    if (firstInvalidStep) {
      setCurrentStep(firstInvalidStep);
      return;
    }

    if (!workOrderFile) {
      setFieldErrors({ work_order_file: "Work Order file is required." });
      setCurrentStep(2);
      setMessage("Please attach the Work Order file before saving.");
      return;
    }

    try {
      setSaving(true);

      const generatedWONumber = await generateWorkOrderNumber();
      setForm((prev) => ({ ...prev, wo_number: generatedWONumber }));

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Please log in again before creating a work order.");
      }

      const payload = new FormData();
      payload.append("company_id", form.company_id);
      payload.append("site_id", form.site_id);
      payload.append("wo_date", form.wo_date);
      payload.append("wo_type", form.wo_type);
      payload.append("description", form.description);
      payload.append("primary_vendor_id", form.primary_vendor_id);
      payload.append("primary_vendor_role", form.primary_vendor_role);
      payload.append("work_order_file", workOrderFile);

      const response = await fetch("/api/work-orders", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: payload,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to create work order.");
      }

      router.push(`/work-orders/${result.workOrder.id}`);
    } catch (error: any) {
      setMessage(error.message || "Failed to create work order.");
    } finally {
      setSaving(false);
    }
  }

  const currentErrors = Object.values(fieldErrors);
  const inputClass =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 shadow-sm outline-none transition focus:border-sky-700 focus:ring-2 focus:ring-sky-100";

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-7xl space-y-8">
      <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <nav className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <span>Procurement</span>
            <ChevronRight className="h-3.5 w-3.5" />
            <span>Work Orders</span>
            <ChevronRight className="h-3.5 w-3.5" />
            <span className="text-sky-800">New Work Order</span>
          </nav>
          <h1 className="text-3xl font-bold text-slate-950">Create Work Order</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Connect one company, one independent site, and a primary vendor for
            commercial tracking.
          </p>
        </div>

        <Link
          href="/work-orders"
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Work Orders
        </Link>
      </header>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <aside className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-slate-950">
              Wizard Progress
            </h2>
            <div className="space-y-3">
              {steps.map((step) => {
                const active = step.id === currentStep;
                const complete = step.id < currentStep;
                return (
                  <button
                    key={step.id}
                    type="button"
                    onClick={() => {
                      setMessage("");
                      setFieldErrors({});
                      setCurrentStep(step.id);
                    }}
                    className={`w-full rounded-r-xl border-l-4 p-4 text-left transition ${
                      active
                        ? "border-l-orange-500 bg-white shadow-sm ring-1 ring-slate-200"
                        : "border-l-transparent bg-slate-50 hover:bg-white"
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                          complete
                            ? "bg-emerald-600 text-white"
                            : active
                              ? "bg-sky-700 text-white"
                              : "bg-slate-200 text-slate-600"
                        }`}
                      >
                        {complete ? <Check className="h-4 w-4" /> : step.id}
                      </span>
                      <span>
                        <span
                          className={`block text-sm font-semibold ${
                            active ? "text-slate-950" : "text-slate-600"
                          }`}
                        >
                          {step.shortTitle}
                        </span>
                        <span className="text-xs text-slate-500">
                          {step.description}
                        </span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-sky-200 bg-sky-50 p-5 text-sm text-sky-950">
            <div className="mb-2 flex items-center gap-2 font-semibold">
              <Info className="h-4 w-4" />
              Site Selection Rule
            </div>
            <p className="leading-6">
              Sites are independent project locations. Selecting a company does
              not filter the site list.
            </p>
          </div>
        </aside>

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="h-1 rounded-t-xl bg-gradient-to-r from-sky-200 to-sky-700" />
          <div className="p-6 lg:p-8">
            {message && (
              <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                {message}
              </div>
            )}

            {currentErrors.length > 0 && (
              <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-semibold text-amber-900">
                  Please resolve these fields:
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-800">
                  {currentErrors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </div>
            )}

            {currentStep === 1 && (
              <StepPanel
                title="Project Information"
                description="Select the corporate entity and independent project site for this work order."
              >
                <div className="grid gap-5 md:grid-cols-2">
                  <FieldShell label="Company" required error={fieldErrors.company_id}>
                    <select
                      name="company_id"
                      value={form.company_id}
                      onChange={handleChange}
                      className={inputClass}
                    >
                      <option value="">Select Company</option>
                      {companies.map((company) => (
                        <option key={company.id} value={company.id}>
                          {company.company_name} - {company.company_code}
                        </option>
                      ))}
                    </select>
                  </FieldShell>

                  <FieldShell label="Site" required error={fieldErrors.site_id}>
                    <select
                      name="site_id"
                      value={form.site_id}
                      onChange={handleChange}
                      className={inputClass}
                    >
                      <option value="">Select Site</option>
                      {sites.map((site) => (
                        <option key={site.id} value={site.id}>
                          {site.site_name} - {site.site_code}
                        </option>
                      ))}
                    </select>
                  </FieldShell>

                  <FieldShell
                    label="Work Order Number"
                    required
                    error={fieldErrors.wo_number}
                  >
                    <input
                      name="wo_number"
                      value={form.wo_number}
                      readOnly
                      placeholder="Auto-generated after company and site are selected"
                      className={`${inputClass} bg-slate-50 text-slate-600`}
                    />
                  </FieldShell>
                </div>

                <FieldShell label="Description">
                  <textarea
                    name="description"
                    value={form.description}
                    onChange={handleChange}
                    rows={5}
                    maxLength={1500}
                    placeholder="Scope of work, expected outcomes, and technical specifications"
                    className={`${inputClass} min-h-32 resize-y`}
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Maximum 1500 characters.
                  </p>
                </FieldShell>
              </StepPanel>
            )}

            {currentStep === 2 && (
              <StepPanel
                title="Work Order Details"
                description="Set the work order date, type and upload the signed work order file."
              >
                <div className="grid gap-5 md:grid-cols-2">
                  <FieldShell label="WO Date" required error={fieldErrors.wo_date}>
                    <input
                      name="wo_date"
                      value={form.wo_date}
                      onChange={handleChange}
                      type="date"
                      className={inputClass}
                    />
                  </FieldShell>

                  <FieldShell label="WO Type" required error={fieldErrors.wo_type}>
                    <select
                      name="wo_type"
                      value={form.wo_type}
                      onChange={handleChange}
                      className={inputClass}
                    >
                      <option>Civil</option>
                      <option>Interior</option>
                      <option>Electrical</option>
                      <option>Plumbing</option>
                      <option>HVAC</option>
                      <option>Supply</option>
                      <option>Service</option>
                      <option>Other</option>
                    </select>
                  </FieldShell>
                </div>

                <FieldShell
                  label="Work Order File"
                  required
                  error={fieldErrors.work_order_file}
                >
                  <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-8 text-center transition hover:border-sky-600 hover:bg-sky-50">
                    <Upload className="mb-3 h-9 w-9 text-slate-500" />
                    <span className="text-sm font-semibold text-slate-950">
                      {workOrderFile ? workOrderFile.name : "Upload work order file"}
                    </span>
                    <span className="mt-1 text-xs text-slate-500">
                      PDF, DOCX or supporting file
                    </span>
                    <input
                      type="file"
                      className="sr-only"
                      onChange={(e) => {
                        setWorkOrderFile(e.target.files?.[0] || null);
                        clearFieldError("work_order_file");
                      }}
                    />
                  </label>
                </FieldShell>
              </StepPanel>
            )}

            {currentStep === 3 && (
              <StepPanel
                title="Vendor Assignment"
                description="Assign the primary vendor and define their responsibility on this work order."
              >
                <div className="grid gap-5 md:grid-cols-2">
                  <FieldShell
                    label="Vendor"
                    required
                    error={fieldErrors.primary_vendor_id}
                  >
                    <select
                      name="primary_vendor_id"
                      value={form.primary_vendor_id}
                      onChange={handleChange}
                      className={inputClass}
                    >
                      <option value="">Select Vendor</option>
                      {vendors.map((vendor) => (
                        <option key={vendor.id} value={vendor.id}>
                          {vendor.vendor_name} {vendor.pan ? `(${vendor.pan})` : ""}
                        </option>
                      ))}
                    </select>
                  </FieldShell>

                  <FieldShell
                    label="Role in Work Order"
                    required
                    error={fieldErrors.primary_vendor_role}
                  >
                    <select
                      name="primary_vendor_role"
                      value={form.primary_vendor_role}
                      onChange={handleChange}
                      className={inputClass}
                    >
                      <option>Main Contractor</option>
                      <option>Subcontractor</option>
                      <option>Supplier</option>
                      <option>Consultant</option>
                      <option>Labour Contractor</option>
                      <option>Equipment Rental</option>
                    </select>
                  </FieldShell>
                </div>

                {selectedVendor && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
                    <div className="flex items-start gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-100 text-sm font-bold text-emerald-700">
                        {initials(selectedVendor.vendor_name)}
                      </div>
                      <div>
                        <p className="font-semibold text-slate-950">
                          {selectedVendor.vendor_name}
                        </p>
                        <p className="mt-1 text-sm text-slate-600">
                          This vendor will be saved as the primary vendor for the
                          work order.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </StepPanel>
            )}

            {currentStep === 4 && (
              <StepPanel
                title="Review & Submit"
                description="Confirm the selected company, independent site, vendor and uploaded file before saving."
              >
                <ReviewSection title="Project Details" onEdit={() => setCurrentStep(1)}>
                  <ReviewItem label="Company" value={selectedCompany?.company_name} />
                  <ReviewItem label="Site" value={selectedSite?.site_name} />
                  <ReviewItem label="WO Number" value={form.wo_number} />
                  <ReviewItem
                    label="Description"
                    value={form.description || "-"}
                    wide
                  />
                </ReviewSection>

                <ReviewSection title="Work Order Details" onEdit={() => setCurrentStep(2)}>
                  <ReviewItem label="WO Date" value={form.wo_date} />
                  <ReviewItem label="WO Type" value={form.wo_type} />
                  <ReviewItem
                    label="Uploaded File"
                    value={workOrderFile?.name || "-"}
                    wide
                  />
                </ReviewSection>

                <ReviewSection title="Vendor Details" onEdit={() => setCurrentStep(3)}>
                  <ReviewItem label="Vendor" value={selectedVendor?.vendor_name} />
                  <ReviewItem label="Role" value={form.primary_vendor_role} />
                </ReviewSection>
              </StepPanel>
            )}

            <footer className="mt-10 flex flex-col gap-3 border-t border-slate-200 pt-6 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={goPrevious}
                disabled={currentStep === 1 || saving}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ArrowLeft className="h-4 w-4" />
                Previous Step
              </button>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/work-orders"
                  className="inline-flex items-center justify-center rounded-lg px-5 py-2.5 text-sm font-semibold text-slate-600 hover:text-slate-950"
                >
                  Cancel
                </Link>

                {currentStep < steps.length ? (
                  <button
                    type="button"
                    onClick={goNext}
                    disabled={saving}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-sky-700 px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-sky-800 disabled:opacity-60"
                  >
                    Next Step
                    <ArrowRight className="h-4 w-4" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-sky-700 px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-sky-800 disabled:opacity-60"
                  >
                    <FileText className="h-4 w-4" />
                    {saving ? "Saving..." : "Submit Work Order"}
                  </button>
                )}
              </div>
            </footer>
          </div>
        </section>
      </div>
    </form>
  );
}

function StepPanel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-bold text-slate-950">{title}</h2>
        <p className="mt-2 text-sm text-slate-600">{description}</p>
      </header>
      <div className="space-y-6">{children}</div>
    </div>
  );
}

function FieldShell({
  label,
  required = false,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
        {label}
        {required && <span className="text-red-600"> *</span>}
      </label>
      {children}
      {error && <p className="mt-1.5 text-sm text-red-600">{error}</p>}
    </div>
  );
}

function ReviewSection({
  title,
  onEdit,
  children,
}: {
  title: string;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold uppercase tracking-wide text-sky-800">
          {title}
        </h3>
        <button
          type="button"
          onClick={onEdit}
          className="text-xs font-bold uppercase tracking-wide text-sky-700 hover:text-sky-900"
        >
          Edit
        </button>
      </div>
      <div className="grid gap-4 md:grid-cols-2">{children}</div>
    </section>
  );
}

function ReviewItem({
  label,
  value,
  wide = false,
}: {
  label: string;
  value?: string | null;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "md:col-span-2" : undefined}>
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-sm font-medium text-slate-950">{value || "-"}</p>
    </div>
  );
}

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}
