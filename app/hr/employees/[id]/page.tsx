"use client";

import Link from "next/link";
import { Copy, Pencil } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import AlertMessage from "@/components/AlertMessage";
import { useAccessContext } from "@/components/AccessContext";
import { can } from "@/lib/accessControl";
import type { EmployeeComplianceRecord, EmployeeDocument, EmployeeEmploymentHistory, EmployeeSalaryHistory as EmployeeSalaryHistoryRow, ErpAuditLog, HrEmployee, ReimbursementClaim } from "@/types/hr";
import type { HrEmployeeUserOption } from "@/types/hr";
import StatusBadge from "@/components/hr/StatusBadge";
import ReimbursementTable from "@/components/hr/ReimbursementTable";
import EmployeeComplianceDocuments from "@/components/hr/EmployeeComplianceDocuments";
import EmployeeAuditTrail from "@/components/hr/EmployeeAuditTrail";
import EmployeeEmploymentTimeline from "@/components/hr/EmployeeEmploymentTimeline";
import EmployeeSalaryHistory from "@/components/hr/EmployeeSalaryHistory";
import EmployeeMasterShell, {
  EmployeeCancelLink,
  EmployeeDangerButton,
} from "@/components/hr/EmployeeMasterShell";
import HrSectionNav from "@/components/hr/HrSectionNav";
import { apiFetch, formatDate, labelize } from "@/components/hr/hrClient";
import { useHrLookups } from "@/components/hr/useHrLookups";

export default function EmployeeDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { access } = useAccessContext();
  const permissions = access?.permissions || [];
  const canEdit = can(permissions, "hr_employees", "edit");
  const canDelete = can(permissions, "hr_employees", "delete");
  const canViewUsers = can(permissions, "users", "view");
  const canViewSalary = can(permissions, "hr_salary", "view");
  const canAddSalary = can(permissions, "hr_salary", "add");
  const canEditSalary = can(permissions, "hr_salary", "edit");
  const canDeleteSalary = can(permissions, "hr_salary", "delete");
  const canViewAudit = can(permissions, "hr_audit", "view");
  const lookups = useHrLookups();
  const [employee, setEmployee] = useState<HrEmployee | null>(null);
  const [erpUsers, setErpUsers] = useState<HrEmployeeUserOption[]>([]);
  const [claims, setClaims] = useState<ReimbursementClaim[]>([]);
  const [documents, setDocuments] = useState<EmployeeDocument[]>([]);
  const [complianceRecords, setComplianceRecords] = useState<EmployeeComplianceRecord[]>([]);
  const [employmentHistory, setEmploymentHistory] = useState<EmployeeEmploymentHistory[]>([]);
  const [salaryHistory, setSalaryHistory] = useState<EmployeeSalaryHistoryRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<ErpAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [tabLoading, setTabLoading] = useState<Record<string, boolean>>({});
  const [loadedTabs, setLoadedTabs] = useState<Record<string, boolean>>({});
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState("basic");
  const currentEmployeeIdRef = useRef<string | null>(null);

  async function load() {
    const employeeId = params.id;
    currentEmployeeIdRef.current = employeeId;
    setLoading(true);
    setMessage("");
    setErpUsers([]);
    setClaims([]);
    setDocuments([]);
    setComplianceRecords([]);
    setEmploymentHistory([]);
    setSalaryHistory([]);
    setAuditLogs([]);
    setTabLoading({});
    setLoadedTabs({});
    try {
      const employeeResult = await apiFetch(`/api/hr/employees/${employeeId}`);
      if (currentEmployeeIdRef.current !== employeeId) return;
      setEmployee(employeeResult.employee);
      setLoadedTabs({ basic: true });
    } catch (error: any) {
      if (currentEmployeeIdRef.current !== employeeId) return;
      setMessage(error.message || "Failed to load employee.");
    } finally {
      if (currentEmployeeIdRef.current === employeeId) {
        setLoading(false);
      }
    }
  }

  async function loadTab(tabId: string) {
    if (!params.id || loadedTabs[tabId] || tabLoading[tabId]) return;
    const employeeId = params.id;
    setTabLoading((prev) => ({ ...prev, [tabId]: true }));
    setMessage("");

    try {
      const loadedTabUpdates: Record<string, boolean> = { [tabId]: true };
      if (tabId === "employment") {
        const usersResult = await apiFetch(`/api/hr/employees/users?employee_id=${employeeId}`);
        if (currentEmployeeIdRef.current !== employeeId) return;
        setErpUsers(usersResult.users || []);
      } else if (tabId === "identity") {
        const [documentsResult, complianceResult] = await Promise.all([
          loadedTabs.documents ? Promise.resolve({ documents }) : apiFetch(`/api/hr/employees/${employeeId}/documents`),
          apiFetch(`/api/hr/employees/${employeeId}/compliance`),
        ]);
        if (currentEmployeeIdRef.current !== employeeId) return;
        setDocuments(documentsResult.documents || []);
        setComplianceRecords(complianceResult.complianceRecords || []);
        loadedTabUpdates.documents = true;
      } else if (tabId === "documents") {
        const documentsResult = await apiFetch(`/api/hr/employees/${employeeId}/documents`);
        if (currentEmployeeIdRef.current !== employeeId) return;
        setDocuments(documentsResult.documents || []);
      } else if (tabId === "timeline") {
        const historyResult = await apiFetch(`/api/hr/employees/${employeeId}/employment-history`);
        if (currentEmployeeIdRef.current !== employeeId) return;
        setEmploymentHistory(historyResult.history || []);
      } else if (tabId === "salary" && canViewSalary) {
        const salaryResult = await apiFetch(`/api/hr/employees/${employeeId}/salary-history`);
        if (currentEmployeeIdRef.current !== employeeId) return;
        setSalaryHistory(salaryResult.salaryHistory || []);
      } else if (tabId === "activity" && canViewAudit) {
        const auditResult = await apiFetch(`/api/hr/employees/${employeeId}/audit`);
        if (currentEmployeeIdRef.current !== employeeId) return;
        setAuditLogs(auditResult.auditLogs || []);
      } else if (tabId === "reimbursements") {
        const claimsResult = await apiFetch(`/api/hr/reimbursements?employee_id=${employeeId}`);
        if (currentEmployeeIdRef.current !== employeeId) return;
        setClaims(claimsResult.reimbursements || []);
      }

      if (currentEmployeeIdRef.current !== employeeId) return;
      setLoadedTabs((prev) => ({ ...prev, ...loadedTabUpdates }));
    } catch (error: any) {
      if (currentEmployeeIdRef.current !== employeeId) return;
      setMessage(error.message || "Failed to load employee details.");
    } finally {
      if (currentEmployeeIdRef.current === employeeId) {
        setTabLoading((prev) => ({ ...prev, [tabId]: false }));
      }
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  useEffect(() => {
    if (!employee) return;
    loadTab(activeTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, employee?.id]);

  const labels = useMemo(() => {
    const company = lookups.companies.find((item) => item.id === employee?.company_id)?.label || "-";
    const site = lookups.sites.find((item) => item.id === employee?.site_id)?.label || "-";
    const department = lookups.departments.find((item) => item.id === employee?.department_id)?.department_name || "-";
    const designation = lookups.designations.find((item) => item.id === employee?.designation_id)?.designation_name || "-";
    const manager = lookups.employees.find((item) => item.id === employee?.reporting_manager_id);
    return { company, site, department, designation, manager: manager ? `${manager.employee_name} (${manager.employee_code})` : "-" };
  }, [employee, lookups]);

  const linkedUser = useMemo(() => {
    return erpUsers.find((user) => user.id === employee?.user_id) || null;
  }, [employee?.user_id, erpUsers]);
  const tabs = [
    { id: "basic", label: "Basic Information" },
    { id: "employment", label: "Employment" },
    { id: "identity", label: "Identity & Compliance" },
    { id: "documents", label: "Documents & Compliance" },
    { id: "timeline", label: "Employment Timeline" },
    ...(canViewSalary ? [{ id: "salary", label: "Salary History" }] : []),
    ...(canViewAudit ? [{ id: "activity", label: "Change History" }] : []),
    { id: "reimbursements", label: "Reimbursements" },
  ];

  async function deleteEmployee() {
    if (!employee || !window.confirm(`Delete employee "${employee.employee_name}"?`)) return;
    try {
      await apiFetch(`/api/hr/employees/${employee.id}`, { method: "DELETE" });
      router.push("/hr/employees");
    } catch (error: any) {
      setMessage(error.message || "Failed to delete employee.");
    }
  }

  async function copyEmployeeCode() {
    if (!employee?.employee_code) return;
    try {
      await navigator.clipboard.writeText(employee.employee_code);
      setMessage("");
    } catch {
      setMessage("Could not copy Employee Code.");
    }
  }

  function addUploadedDocuments(nextDocuments: EmployeeDocument[]) {
    const nextTypes = new Set(nextDocuments.map((document) => document.document_type));
    setDocuments((prev) =>
      nextDocuments.concat(
        prev.map((document) =>
          nextTypes.has(document.document_type)
            ? { ...document, is_active: false }
            : document,
        ),
      ),
    );
  }

  async function deleteDocument(document: { id: string; file_name?: string | null; document_name?: string | null }) {
    if (!employee || !window.confirm(`Delete document "${document.file_name || document.document_name || "Document"}"?`)) return;
    try {
      await apiFetch(`/api/hr/employees/${employee.id}/documents/${document.id}`, { method: "DELETE" });
      setDocuments((prev) => prev.filter((item) => item.id !== document.id));
    } catch (error: any) {
      setMessage(error.message || "Failed to delete employee document.");
    }
  }

  return (
    <section className="space-y-6">
      <HrSectionNav />

      <AlertMessage type="error" message={message || lookups.error} onClose={() => setMessage("")} />

      {loading ? (
        <div className="rounded-2xl border bg-white p-8 text-sm text-slate-500 shadow-sm">Loading employee...</div>
      ) : employee ? (
        <EmployeeMasterShell
          title="Employee Master"
          description="View employee profile, assignment and documentation."
          summary={{
            employeeName: employee.employee_name,
            employeeCode: employee.employee_code,
            department: labels.department,
            designation: labels.designation,
            status: employee.status,
            company: labels.company,
            site: labels.site,
            employeeType: employee.employment_type,
            joiningDate: employee.date_of_joining,
            photoUrl: employee.photo_signed_url,
          }}
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          secondaryAction={<EmployeeCancelLink href="/hr/employees" label="Back to Employees" />}
          dangerAction={canDelete ? <EmployeeDangerButton onClick={deleteEmployee}>Delete</EmployeeDangerButton> : null}
          primaryAction={
            canEdit ? (
              <Link
                href={`/hr/employees/${employee.id}/edit`}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                <Pencil className="h-4 w-4" />
                Edit
              </Link>
            ) : null
          }
        >
          {activeTab === "basic" && (
            <SectionCard title="Basic Information" description="Read-only employee identity and contact details.">
              <div className="grid gap-5 md:grid-cols-3">
                <Info
                  label="Employee Code"
                  value={
                    <span className="inline-flex items-center gap-2">
                      {employee.employee_code}
                      <button type="button" onClick={copyEmployeeCode} aria-label="Copy Employee Code" className="rounded-md border p-1 text-slate-500 hover:bg-slate-50">
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  }
                />
                <Info label="Employee Name" value={employee.employee_name} />
                <Info label="Status" value={<StatusBadge status={employee.status} />} />
                <Info label="Official Email" value={employee.email || "-"} />
                <Info label="Primary Mobile" value={employee.phone || "-"} />
                <Info label="Personal Email" value={employee.personal_email || "-"} />
                <Info label="Personal Mobile" value={employee.personal_phone || "-"} />
                <Info label="Remarks" value={employee.remarks || "-"} />
              </div>
            </SectionCard>
          )}

          {activeTab === "employment" && (
            <div className="space-y-5">
              <SectionCard title="Employment" description="Assignment, reporting structure and employee type.">
                <div className="grid gap-5 md:grid-cols-3">
                  <Info label="Company" value={labels.company} />
                  <Info label="Site" value={labels.site} />
                  <Info label="Department" value={labels.department} />
                  <Info label="Designation" value={labels.designation} />
                  <Info label="Employee Type" value={labelize(employee.employment_type)} />
                  <Info label="Shift" value={employee.shift || "-"} />
                  <Info label="Joining Date" value={formatDate(employee.date_of_joining)} />
                  <Info label="Confirmation Date" value={formatDate(employee.confirmation_date)} />
                  <Info label="Notice Period From" value={formatDate(employee.notice_period_from)} />
                  <Info label="Notice Period To" value={formatDate(employee.notice_period_to)} />
                  <Info label="Resignation Date" value={formatDate(employee.resignation_date)} />
                  <Info label="Relieving Date" value={formatDate(employee.date_of_exit)} />
                  <Info label="Reporting Manager" value={labels.manager} />
                  <Info label="Exit Remark" value={employee.exit_remark || "-"} />
                </div>
              </SectionCard>

              <SectionCard title="ERP Login" description="Linked ERP profile, if available.">
                {linkedUser ? (
                  <div className="grid gap-5 md:grid-cols-3">
                    <Info label="Link Status" value="Linked" />
                    <Info label="Profile Name" value={linkedUser.full_name || "-"} />
                    <Info label="Profile Email" value={linkedUser.email || "-"} />
                    <Info label="Profile Status" value={<StatusBadge status={linkedUser.status || "active"} />} />
                    <Info label="Current Roles" value={linkedUser.role_summary || "-"} />
                    {canViewUsers && (
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">User</p>
                        <div className="mt-2">
                          <Link href={`/admin/users/${linkedUser.id}`} className="inline-flex rounded-xl border bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50">
                            Open User
                          </Link>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="grid gap-5 md:grid-cols-3">
                    <Info label="Link Status" value="Not Linked" />
                    <Info label="Profile Email" value="-" />
                    <Info label="Profile Status" value="-" />
                  </div>
                )}
              </SectionCard>
            </div>
          )}

          {activeTab === "documents" && (
            <TabPanelLoading loading={tabLoading.documents}>
              <EmployeeComplianceDocuments
                employeeId={employee.id}
                documents={documents}
                canEdit={canEdit}
                uploading={uploading}
                setUploading={setUploading}
                onUploaded={addUploadedDocuments}
                onDelete={deleteDocument}
                onError={setMessage}
              />
            </TabPanelLoading>
          )}

          {activeTab === "identity" && (
            <div className="space-y-5">
              <SectionCard title="Identity & Compliance" description="Personal identity, emergency contact and statutory details.">
                <div className="grid gap-5 md:grid-cols-3">
                  <Info label="Date of Birth" value={formatDate(employee.date_of_birth)} />
                  <Info label="Gender" value={labelize(employee.gender)} />
                  <Info label="Nationality" value={employee.nationality || "-"} />
                  <Info label="Blood Group" value={employee.blood_group || "-"} />
                  <Info label="Marital Status" value={labelize(employee.marital_status)} />
                  <Info label="Father Name" value={employee.father_name || "-"} />
                  <Info label="Mother Name" value={employee.mother_name || "-"} />
                  <Info label="Spouse Name" value={employee.spouse_name || "-"} />
                  <Info label="Emergency Contact" value={employee.emergency_contact_name || "-"} />
                  <Info label="Emergency Relationship" value={employee.emergency_contact_relationship || "-"} />
                  <Info label="Emergency Number" value={employee.emergency_contact_phone || "-"} />
                </div>
              </SectionCard>

              <SectionCard title="Address" description="Current and permanent residential address.">
                <div className="grid gap-5 lg:grid-cols-2">
                  <AddressBlock
                    title="Current Address"
                    fallback={employee.current_address}
                    values={[
                      employee.current_address_line1,
                      employee.current_address_line2,
                      employee.current_address_city,
                      employee.current_address_state,
                      employee.current_address_country,
                      employee.current_address_pin_code,
                    ]}
                  />
                  <AddressBlock
                    title="Permanent Address"
                    fallback={employee.permanent_address}
                    values={[
                      employee.permanent_address_line1,
                      employee.permanent_address_line2,
                      employee.permanent_address_city,
                      employee.permanent_address_state,
                      employee.permanent_address_country,
                      employee.permanent_address_pin_code,
                    ]}
                  />
                </div>
              </SectionCard>

              <SectionCard title="Statutory & Compliance Records" description="Structured identity and statutory metadata imported or entered for this employee.">
                <TabPanelLoading loading={tabLoading.identity}>
                  <ComplianceRecordsTable records={complianceRecords} documents={documents} />
                </TabPanelLoading>
              </SectionCard>
            </div>
          )}

          {activeTab === "timeline" && (
            <TabPanelLoading loading={tabLoading.timeline}>
              <EmployeeEmploymentTimeline
                employee={employee}
                history={employmentHistory}
                setHistory={setEmploymentHistory}
                canEdit={canEdit}
                lookups={lookups}
                onError={setMessage}
              />
            </TabPanelLoading>
          )}

          {activeTab === "salary" && canViewSalary && (
            <TabPanelLoading loading={tabLoading.salary}>
              <EmployeeSalaryHistory
                employeeId={employee.id}
                history={salaryHistory}
                setHistory={setSalaryHistory}
                canAdd={canAddSalary}
                canEdit={canEditSalary}
                canDelete={canDeleteSalary}
                onError={setMessage}
              />
            </TabPanelLoading>
          )}

          {activeTab === "activity" && (
            <TabPanelLoading loading={tabLoading.activity}>
              <EmployeeAuditTrail logs={auditLogs} />
            </TabPanelLoading>
          )}

          {activeTab === "reimbursements" && (
            <TabPanelLoading loading={tabLoading.reimbursements}>
              <section className="space-y-4">
                <h2 className="text-xl font-semibold text-slate-950">Reimbursement History</h2>
                <ReimbursementTable claims={claims} employees={lookups.employees} companies={lookups.companies} sites={lookups.sites} canEdit={false} canDelete={false} onDelete={() => {}} />
              </section>
            </TabPanelLoading>
          )}
        </EmployeeMasterShell>
      ) : null}
    </section>
  );
}

function ComplianceRecordsTable({
  records,
  documents,
}: {
  records: EmployeeComplianceRecord[];
  documents: EmployeeDocument[];
}) {
  const activeDocuments = documents.filter((document) => document.is_active !== false);

  if (records.length === 0) {
    return <p className="text-sm text-slate-500">No statutory or compliance records found.</p>;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3">Record</th>
            <th className="px-4 py-3">Number</th>
            <th className="px-4 py-3">Dates</th>
            <th className="px-4 py-3">Authority</th>
            <th className="px-4 py-3">Source</th>
            <th className="px-4 py-3">File</th>
            <th className="px-4 py-3">Metadata</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {records.map((record) => {
            const hasFile = activeDocuments.some((document) => documentMatchesRecord(document, record));
            const metadata = Object.entries(record.metadata || {}).filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "");
            return (
              <tr key={record.id}>
                <td className="px-4 py-3 font-semibold text-slate-950">{record.record_type}</td>
                <td className="px-4 py-3 text-slate-600">{maskRecordNumber(record.record_type, record.record_number)}</td>
                <td className="px-4 py-3 text-slate-600">
                  <div>{record.issue_date ? `Issued ${formatDate(record.issue_date)}` : "-"}</div>
                  {record.expiry_date && <div>Expires {formatDate(record.expiry_date)}</div>}
                </td>
                <td className="px-4 py-3 text-slate-600">{record.issuing_authority || "-"}</td>
                <td className="px-4 py-3 text-slate-600">{labelize(record.source)}</td>
                <td className="px-4 py-3 text-slate-600">{hasFile ? "Attached" : "No file"}</td>
                <td className="px-4 py-3 text-slate-600">
                  {metadata.length === 0 ? "-" : (
                    <div className="space-y-1">
                      {metadata.map(([key, value]) => (
                        <div key={`${record.id}-${key}`}>
                          <span className="font-semibold">{labelize(key)}:</span> {String(value)}
                        </div>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TabPanelLoading({
  loading,
  children,
}: {
  loading?: boolean;
  children: React.ReactNode;
}) {
  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
        Loading this section...
      </div>
    );
  }

  return <>{children}</>;
}

function documentMatchesRecord(document: EmployeeDocument, record: EmployeeComplianceRecord) {
  const documentType = String(document.document_type || "").toLowerCase();
  const recordType = String(record.record_type || "").toLowerCase();
  if (!documentType || !recordType) return false;
  return documentType.includes(recordType) || recordType.includes(documentType.replace(/\s+card$/, ""));
}

function maskRecordNumber(recordType: string, value?: string | null) {
  const text = String(value || "").trim();
  if (!text) return "-";
  const sensitive = /aadhaar|bank/i.test(recordType);
  if (!sensitive || text.length <= 4) return text;
  return `${"•".repeat(Math.max(0, text.length - 4))}${text.slice(-4)}`;
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-1 text-base font-semibold text-slate-950">{value}</div>
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

function AddressBlock({
  title,
  values,
  fallback,
}: {
  title: string;
  values: Array<string | null | undefined>;
  fallback?: string | null;
}) {
  const lines = values.map((value) => String(value || "").trim()).filter(Boolean);
  const fallbackText = String(fallback || "").trim();

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <div className="mt-2 space-y-1 text-sm font-semibold text-slate-950">
        {lines.length > 0 ? (
          lines.map((line, index) => <p key={`${title}-${index}`}>{line}</p>)
        ) : (
          <p>{fallbackText || "-"}</p>
        )}
      </div>
    </div>
  );
}
