"use client";

import { useEffect, useState } from "react";
import type { HrDepartment, HrDesignation, HrEmployee, HrEmployeeUserOption, LookupOption } from "@/types/hr";
import EmployeePhoto from "./EmployeePhoto";
import EmployeeMasterShell, { EmployeeCancelLink, EmployeePrimaryButton } from "./EmployeeMasterShell";
import { formatDate } from "./hrClient";

type EmployeeFormValues = {
  employee_code: string;
  employee_name: string;
  email: string;
  phone: string;
  personal_email: string;
  personal_phone: string;
  date_of_birth: string;
  gender: string;
  nationality: string;
  father_name: string;
  mother_name: string;
  spouse_name: string;
  blood_group: string;
  marital_status: string;
  current_address: string;
  permanent_address: string;
  current_address_line1: string;
  current_address_line2: string;
  current_address_city: string;
  current_address_state: string;
  current_address_country: string;
  current_address_pin_code: string;
  permanent_address_line1: string;
  permanent_address_line2: string;
  permanent_address_city: string;
  permanent_address_state: string;
  permanent_address_country: string;
  permanent_address_pin_code: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  emergency_contact_relationship: string;
  remarks: string;
  company_id: string;
  site_id: string;
  department_id: string;
  designation_id: string;
  reporting_manager_id: string;
  user_id: string;
  employment_type: string;
  date_of_joining: string;
  shift: string;
  confirmation_date: string;
  notice_period_from: string;
  notice_period_to: string;
  resignation_date: string;
  date_of_exit: string;
  exit_remark: string;
  status: string;
};

type Props = {
  initialEmployee?: HrEmployee | null;
  mode: "create" | "edit";
  companies: LookupOption[];
  sites: LookupOption[];
  departments: HrDepartment[];
  designations: HrDesignation[];
  managers: HrEmployee[];
  erpUsers?: HrEmployeeUserOption[];
  saving: boolean;
  onSubmit: (values: EmployeeFormValues) => void;
  selectedPhoto?: File | null;
  onPhotoChange?: (file: File | null) => void;
  onRemovePhoto?: () => void;
  removingPhoto?: boolean;
  cancelHref?: string;
};

const emptyValues: EmployeeFormValues = {
  employee_code: "",
  employee_name: "",
  email: "",
  phone: "",
  personal_email: "",
  personal_phone: "",
  date_of_birth: "",
  gender: "",
  nationality: "Indian",
  father_name: "",
  mother_name: "",
  spouse_name: "",
  blood_group: "",
  marital_status: "",
  current_address: "",
  permanent_address: "",
  current_address_line1: "",
  current_address_line2: "",
  current_address_city: "",
  current_address_state: "",
  current_address_country: "India",
  current_address_pin_code: "",
  permanent_address_line1: "",
  permanent_address_line2: "",
  permanent_address_city: "",
  permanent_address_state: "",
  permanent_address_country: "India",
  permanent_address_pin_code: "",
  emergency_contact_name: "",
  emergency_contact_phone: "",
  emergency_contact_relationship: "",
  remarks: "",
  company_id: "",
  site_id: "",
  department_id: "",
  designation_id: "",
  reporting_manager_id: "",
  user_id: "",
  employment_type: "full_time",
  date_of_joining: "",
  shift: "",
  confirmation_date: "",
  notice_period_from: "",
  notice_period_to: "",
  resignation_date: "",
  date_of_exit: "",
  exit_remark: "",
  status: "active",
};

export default function EmployeeForm({
  initialEmployee,
  mode,
  companies,
  sites,
  departments,
  designations,
  managers,
  erpUsers,
  saving,
  onSubmit,
  selectedPhoto,
  onPhotoChange,
  onRemovePhoto,
  removingPhoto = false,
  cancelHref = "/hr/employees",
}: Props) {
  const [form, setForm] = useState<EmployeeFormValues>(emptyValues);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("basic");

  useEffect(() => {
    if (!initialEmployee) return;
    setForm({
      employee_code: initialEmployee.employee_code || "",
      employee_name: initialEmployee.employee_name || "",
      email: initialEmployee.email || "",
      phone: initialEmployee.phone || "",
      personal_email: initialEmployee.personal_email || "",
      personal_phone: initialEmployee.personal_phone || "",
      date_of_birth: initialEmployee.date_of_birth || "",
      gender: initialEmployee.gender || "",
      nationality: initialEmployee.nationality || "Indian",
      father_name: initialEmployee.father_name || "",
      mother_name: initialEmployee.mother_name || "",
      spouse_name: initialEmployee.spouse_name || "",
      blood_group: initialEmployee.blood_group || "",
      marital_status: initialEmployee.marital_status || "",
      current_address: initialEmployee.current_address || "",
      permanent_address: initialEmployee.permanent_address || "",
      current_address_line1: initialEmployee.current_address_line1 || "",
      current_address_line2: initialEmployee.current_address_line2 || "",
      current_address_city: initialEmployee.current_address_city || "",
      current_address_state: initialEmployee.current_address_state || "",
      current_address_country: initialEmployee.current_address_country || "India",
      current_address_pin_code: initialEmployee.current_address_pin_code || "",
      permanent_address_line1: initialEmployee.permanent_address_line1 || "",
      permanent_address_line2: initialEmployee.permanent_address_line2 || "",
      permanent_address_city: initialEmployee.permanent_address_city || "",
      permanent_address_state: initialEmployee.permanent_address_state || "",
      permanent_address_country: initialEmployee.permanent_address_country || "India",
      permanent_address_pin_code: initialEmployee.permanent_address_pin_code || "",
      emergency_contact_name: initialEmployee.emergency_contact_name || "",
      emergency_contact_phone: initialEmployee.emergency_contact_phone || "",
      emergency_contact_relationship: initialEmployee.emergency_contact_relationship || "",
      remarks: initialEmployee.remarks || "",
      company_id: initialEmployee.company_id || "",
      site_id: initialEmployee.site_id || "",
      department_id: initialEmployee.department_id || "",
      designation_id: initialEmployee.designation_id || "",
      reporting_manager_id: initialEmployee.reporting_manager_id || "",
      user_id: initialEmployee.user_id || "",
      employment_type: initialEmployee.employment_type || "full_time",
      date_of_joining: initialEmployee.date_of_joining || "",
      shift: initialEmployee.shift || "",
      confirmation_date: initialEmployee.confirmation_date || "",
      notice_period_from: initialEmployee.notice_period_from || "",
      notice_period_to: initialEmployee.notice_period_to || "",
      resignation_date: initialEmployee.resignation_date || "",
      date_of_exit: initialEmployee.date_of_exit || "",
      exit_remark: initialEmployee.exit_remark || "",
      status: initialEmployee.status || "active",
    });
  }, [initialEmployee]);

  useEffect(() => {
    if (!selectedPhoto) {
      setPhotoPreview(null);
      return;
    }

    const previewUrl = URL.createObjectURL(selectedPhoto);
    setPhotoPreview(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [selectedPhoto]);

  function handleChange(event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
    const { name, value } = event.target;
    setForm((prev) => ({
      ...prev,
      [name]: value,
      ...(name === "company_id" ? { site_id: "" } : {}),
    }));
  }

  function copyCurrentAddressToPermanent(checked: boolean) {
    if (!checked) return;
    setForm((prev) => ({
      ...prev,
      permanent_address_line1: prev.current_address_line1,
      permanent_address_line2: prev.current_address_line2,
      permanent_address_city: prev.current_address_city,
      permanent_address_state: prev.current_address_state,
      permanent_address_country: prev.current_address_country,
      permanent_address_pin_code: prev.current_address_pin_code,
      permanent_address: prev.current_address,
    }));
  }

  const visibleSites = form.company_id
    ? sites.filter((site) => !site.meta || site.meta === form.company_id)
    : sites;
  const selectedCompany = companies.find((company) => company.id === form.company_id)?.label || null;
  const selectedSite = visibleSites.find((site) => site.id === form.site_id)?.label || null;
  const selectedDepartment = departments.find((department) => department.id === form.department_id)?.department_name || null;
  const selectedDesignation = designations.find((designation) => designation.id === form.designation_id)?.designation_name || null;
  const selectedManager = managers.find((manager) => manager.id === form.reporting_manager_id);
  const tabs = [
    { id: "basic", label: "Basic Information" },
    { id: "employment", label: "Employment" },
    { id: "identity", label: "Identity & Compliance" },
    ...(mode === "edit"
      ? [
          { id: "timeline", label: "Employment Timeline" },
          { id: "salary", label: "Salary History" },
          { id: "activity", label: "Change History" },
        ]
      : []),
  ];
  const title = mode === "create" ? "New Employee" : "Edit Employee";
  const description =
    mode === "create"
      ? "Create an employee profile and assign workforce details."
      : "Update employee profile, assignment and access details.";

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(form);
      }}
      className="space-y-6"
    >
      <EmployeeMasterShell
        title={title}
        description={description}
        summary={{
          employeeName: form.employee_name,
          employeeCode: form.employee_code,
          department: selectedDepartment,
          designation: selectedDesignation,
          status: form.status,
          company: selectedCompany,
          site: selectedSite,
          employeeType: form.employment_type,
          joiningDate: form.date_of_joining,
          photoUrl: initialEmployee?.photo_signed_url,
          photoPreviewUrl: photoPreview,
        }}
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        secondaryAction={<EmployeeCancelLink href={cancelHref} />}
        primaryAction={<EmployeePrimaryButton disabled={saving}>{saving ? "Saving..." : mode === "create" ? "Save Employee" : "Save Changes"}</EmployeePrimaryButton>}
      >
        {activeTab === "basic" && (
          <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
            <PhotoPanel
              name={form.employee_name}
              photoUrl={photoPreview || initialEmployee?.photo_signed_url || null}
              hasPhoto={Boolean(initialEmployee?.photo_storage_path || selectedPhoto)}
              selectedPhoto={selectedPhoto}
              onPhotoChange={onPhotoChange}
              onRemovePhoto={onRemovePhoto}
              removingPhoto={removingPhoto}
            />
            <SectionCard title="Basic Information" description="Employee core identity and contact details.">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Employee Code *">
                  <input name="employee_code" value={form.employee_code} onChange={handleChange} className={inputClass} />
                </Field>
                <Field label="Employee Name *">
                  <input name="employee_name" value={form.employee_name} onChange={handleChange} className={inputClass} />
                </Field>
                <Field label="Official Email">
                  <input name="email" value={form.email} onChange={handleChange} className={inputClass} />
                </Field>
                <Field label="Primary Mobile">
                  <input name="phone" value={form.phone} onChange={handleChange} className={inputClass} />
                </Field>
                <Field label="Personal Email">
                  <input name="personal_email" value={form.personal_email} onChange={handleChange} className={inputClass} />
                </Field>
                <Field label="Personal Mobile">
                  <input name="personal_phone" value={form.personal_phone} onChange={handleChange} className={inputClass} />
                </Field>
              </div>
              <div className="mt-4">
                <Field label="Remarks">
                  <textarea name="remarks" value={form.remarks} onChange={handleChange} className={textareaClass} />
                </Field>
              </div>
            </SectionCard>
          </div>
        )}

        {activeTab === "employment" && (
          <SectionCard title="Employment" description="Assignment, reporting and ERP user linkage.">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Company *">
                <select name="company_id" value={form.company_id} onChange={handleChange} className={inputClass}>
                  <option value="">Select company</option>
                  {companies.map((company) => (
                    <option key={company.id} value={company.id}>{company.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Site *">
                <select name="site_id" value={form.site_id} onChange={handleChange} className={inputClass}>
                  <option value="">Select site</option>
                  {visibleSites.map((site) => (
                    <option key={site.id} value={site.id}>{site.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Department *">
                <select name="department_id" value={form.department_id} onChange={handleChange} className={inputClass}>
                  <option value="">Select department</option>
                  {departments.map((department) => (
                    <option key={department.id} value={department.id}>{department.department_name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Designation *">
                <select name="designation_id" value={form.designation_id} onChange={handleChange} className={inputClass}>
                  <option value="">Select designation</option>
                  {designations.map((designation) => (
                    <option key={designation.id} value={designation.id}>{designation.designation_name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Employee Type">
                <select name="employment_type" value={form.employment_type} onChange={handleChange} className={inputClass}>
                  <option value="full_time">Full Time</option>
                  <option value="contract">Contract</option>
                  <option value="consultant">Consultant</option>
                  <option value="intern">Intern</option>
                </select>
              </Field>
              <Field label="Shift">
                <input name="shift" value={form.shift} onChange={handleChange} className={inputClass} />
              </Field>
              <Field label="Joining Date *">
                <input name="date_of_joining" type="date" value={form.date_of_joining} onChange={handleChange} className={inputClass} />
              </Field>
              <Field label="Confirmation Date">
                <input name="confirmation_date" type="date" value={form.confirmation_date} onChange={handleChange} className={inputClass} />
              </Field>
              <Field label="Employment Status">
                <select name="status" value={form.status} onChange={handleChange} className={inputClass}>
                  <option value="active">Active</option>
                  <option value="probation">Probation</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="notice_period">Notice Period</option>
                  <option value="resigned">Resigned</option>
                  <option value="relieved">Relieved</option>
                  <option value="inactive">Inactive</option>
                </select>
              </Field>
              <Field label="Notice Period From">
                <input name="notice_period_from" type="date" value={form.notice_period_from} onChange={handleChange} className={inputClass} />
              </Field>
              <Field label="Notice Period To">
                <input name="notice_period_to" type="date" value={form.notice_period_to} onChange={handleChange} className={inputClass} />
              </Field>
              <Field label="Resignation Date">
                <input name="resignation_date" type="date" value={form.resignation_date} onChange={handleChange} className={inputClass} />
              </Field>
              <Field label="Relieving Date">
                <input name="date_of_exit" type="date" value={form.date_of_exit} onChange={handleChange} className={inputClass} />
              </Field>
              <Field label="Reporting Manager">
                <select name="reporting_manager_id" value={form.reporting_manager_id} onChange={handleChange} className={inputClass}>
                  <option value="">No reporting manager</option>
                  {managers
                    .filter((manager) => manager.id !== initialEmployee?.id)
                    .map((manager) => (
                      <option key={manager.id} value={manager.id}>
                        {manager.employee_name} ({manager.employee_code})
                      </option>
                    ))}
                </select>
              </Field>
              {erpUsers && (
                <Field label="Link ERP User">
                  <select name="user_id" value={form.user_id} onChange={handleChange} className={inputClass}>
                    <option value="">No ERP user linked</option>
                    {erpUsers.map((user) => {
                      const isLinkedElsewhere = Boolean(
                        user.linked_employee_id && user.linked_employee_id !== initialEmployee?.id,
                      );

                      return (
                        <option key={user.id} value={user.id} disabled={isLinkedElsewhere}>
                          {user.email || user.full_name || user.id}
                          {user.full_name ? ` - ${user.full_name}` : ""}
                          {isLinkedElsewhere ? " (already linked)" : ""}
                        </option>
                      );
                    })}
                  </select>
                </Field>
              )}
            </div>
            <div className="mt-4">
              <Field label="Exit Remark">
                <textarea name="exit_remark" value={form.exit_remark} onChange={handleChange} className={textareaClass} />
              </Field>
            </div>
            {selectedManager && (
              <p className="mt-4 text-sm text-slate-500">
                Reporting to {selectedManager.employee_name} ({selectedManager.employee_code}).
              </p>
            )}
            {mode === "create" && (
              <div className="mt-5 rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm text-sky-800">
                Save the employee profile first. Documents can be uploaded from the employee detail page after this record is created.
              </div>
            )}
          </SectionCard>
        )}

        {activeTab === "identity" && (
          <div className="space-y-5">
            <SectionCard title="Identity Information" description="Import-ready personal identity and emergency contact information.">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Date of Birth">
                  <input name="date_of_birth" type="date" value={form.date_of_birth} onChange={handleChange} className={inputClass} />
                </Field>
                <Field label="Gender">
                  <select name="gender" value={form.gender} onChange={handleChange} className={inputClass}>
                    <option value="">Select gender</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                    <option value="prefer_not_to_say">Prefer not to say</option>
                  </select>
                </Field>
                <Field label="Nationality">
                  <input list="nationality-options" name="nationality" value={form.nationality} onChange={handleChange} className={inputClass} />
                  <datalist id="nationality-options">
                    <option value="Indian" />
                    <option value="Nepalese" />
                    <option value="Bhutanese" />
                    <option value="Other" />
                  </datalist>
                </Field>
                <Field label="Blood Group">
                  <select name="blood_group" value={form.blood_group} onChange={handleChange} className={inputClass}>
                    <option value="">Select blood group</option>
                    {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((group) => (
                      <option key={group} value={group}>{group}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Marital Status">
                  <select name="marital_status" value={form.marital_status} onChange={handleChange} className={inputClass}>
                    <option value="">Select marital status</option>
                    <option value="single">Single</option>
                    <option value="married">Married</option>
                    <option value="divorced">Divorced</option>
                    <option value="widowed">Widowed</option>
                    <option value="other">Other</option>
                  </select>
                </Field>
                <Field label="Father Name">
                  <input name="father_name" value={form.father_name} onChange={handleChange} className={inputClass} />
                </Field>
                <Field label="Mother Name">
                  <input name="mother_name" value={form.mother_name} onChange={handleChange} className={inputClass} />
                </Field>
                <Field label="Spouse Name">
                  <input name="spouse_name" value={form.spouse_name} onChange={handleChange} className={inputClass} />
                </Field>
                <Field label="Emergency Contact Name">
                  <input name="emergency_contact_name" value={form.emergency_contact_name} onChange={handleChange} className={inputClass} />
                </Field>
                <Field label="Emergency Relationship">
                  <input name="emergency_contact_relationship" value={form.emergency_contact_relationship} onChange={handleChange} className={inputClass} />
                </Field>
                <Field label="Emergency Contact Number">
                  <input name="emergency_contact_phone" value={form.emergency_contact_phone} onChange={handleChange} className={inputClass} />
                </Field>
              </div>
            </SectionCard>

            <SectionCard title="Address" description="Structured current and permanent address details.">
              <AddressFields prefix="current" title="Current Address" form={form} onChange={handleChange} />
              <label className="my-5 flex items-center gap-2 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  onChange={(event) => copyCurrentAddressToPermanent(event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Same as Current Address
              </label>
              <AddressFields prefix="permanent" title="Permanent Address" form={form} onChange={handleChange} />
            </SectionCard>
          </div>
        )}

        {activeTab === "timeline" && mode === "edit" && (
          <PlaceholderCard
            title="Employment Timeline"
            description="Employment movement history will be added in a later phase without changing the current employee create/edit workflow."
          />
        )}

        {activeTab === "salary" && mode === "edit" && (
          <PlaceholderCard
            title="Salary History"
            description="Salary revisions are managed from the employee detail page."
          />
        )}

        {activeTab === "activity" && mode === "edit" && (
          <SectionCard title="Activity" description="Record timestamps currently available for this employee.">
            <div className="grid gap-4 md:grid-cols-2">
              <ReadOnlyItem label="Created At" value={formatDate(initialEmployee?.created_at)} />
              <ReadOnlyItem label="Updated At" value={formatDate(initialEmployee?.updated_at)} />
            </div>
          </SectionCard>
        )}
      </EmployeeMasterShell>
    </form>
  );
}

const inputClass = "h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100";
const textareaClass = "min-h-24 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function AddressFields({
  prefix,
  title,
  form,
  onChange,
}: {
  prefix: "current" | "permanent";
  title: string;
  form: EmployeeFormValues;
  onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => void;
}) {
  const field = (name: string) => `${prefix}_${name}` as keyof EmployeeFormValues;

  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold text-slate-950">{title}</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Address Line 1">
          <input name={field("address_line1")} value={String(form[field("address_line1")] || "")} onChange={onChange} className={inputClass} />
        </Field>
        <Field label="Address Line 2">
          <input name={field("address_line2")} value={String(form[field("address_line2")] || "")} onChange={onChange} className={inputClass} />
        </Field>
        <Field label="City">
          <input name={field("city")} value={String(form[field("city")] || "")} onChange={onChange} className={inputClass} />
        </Field>
        <Field label="State">
          <input name={field("state")} value={String(form[field("state")] || "")} onChange={onChange} className={inputClass} />
        </Field>
        <Field label="Country">
          <input name={field("country")} value={String(form[field("country")] || "")} onChange={onChange} className={inputClass} />
        </Field>
        <Field label="PIN Code">
          <input name={field("pin_code")} value={String(form[field("pin_code")] || "")} onChange={onChange} className={inputClass} />
        </Field>
      </div>
    </div>
  );
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function PlaceholderCard({ title, description }: { title: string; description: string }) {
  return (
    <section className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
      <p className="mt-2 text-sm text-slate-500">{description}</p>
    </section>
  );
}

function PhotoPanel({
  name,
  photoUrl,
  hasPhoto,
  selectedPhoto,
  onPhotoChange,
  onRemovePhoto,
  removingPhoto,
}: {
  name: string;
  photoUrl?: string | null;
  hasPhoto: boolean;
  selectedPhoto?: File | null;
  onPhotoChange?: (file: File | null) => void;
  onRemovePhoto?: () => void;
  removingPhoto: boolean;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm">
      <div className="flex justify-center">
        <EmployeePhoto name={name} photoUrl={photoUrl} size="lg" />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-slate-950">Profile Photo</h2>
      <p className="mt-1 text-sm text-slate-500">JPG, PNG or WEBP only. Maximum 3MB.</p>
      <div className="mt-5 flex flex-col gap-2">
        <label className="inline-flex cursor-pointer justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50">
          {hasPhoto ? "Replace Photo" : "Upload Photo"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(event) => onPhotoChange?.(event.target.files?.[0] || null)}
          />
        </label>
        {hasPhoto && (
          <button
            type="button"
            onClick={() => {
              onPhotoChange?.(null);
              if (!selectedPhoto) onRemovePhoto?.();
            }}
            disabled={removingPhoto}
            className="rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {removingPhoto ? "Removing..." : "Remove Photo"}
          </button>
        )}
      </div>
    </section>
  );
}

function ReadOnlyItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-1 text-sm font-semibold text-slate-950">{value || "-"}</div>
    </div>
  );
}
