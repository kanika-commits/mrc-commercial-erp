"use client";

import Link from "next/link";
import { FileUp, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { recordClientAuditEvent } from "@/lib/clientAudit";
import { can, hasGlobalAccess } from "@/lib/accessControl";
import { useAccessContext } from "@/components/AccessContext";
import { formatLabourCode, LABOUR_DOCUMENT_TYPES, labelFromCode, normalizeIdentifier } from "@/lib/labour/constants";

const tabs = ["Overview", "Documents", "Transfer History", "Activity"] as const;

const emptyDeploymentForm = {
  contractor_profile_id: "",
  company_id: "",
  site_id: "",
  work_order_id: "",
  manpower_work_order_id: "",
  commercial_model: "contract_basis",
  labour_trade_id: "",
  skill_level: "",
  wage_type: "",
  wage_rate: "",
  effective_from: "",
  deployment_reason: "",
};

const emptyRateForm = {
  base_rate: "",
  effective_from: "",
  reason: "",
};

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function paymentModelLabel(value?: string | null) {
  return value === "daily_wage" ? "Daily Wage" : value === "contract_basis" ? "Contractual Labour" : labelFromCode(value);
}

function workOrderLabel(workOrder: any) {
  if (!workOrder?.wo_number) return "Not Assigned";
  return `${workOrder.wo_number}${workOrder.wo_type ? ` — ${workOrder.wo_type}` : ""}`;
}

function assignmentLabel(deployment: any) {
  return workOrderLabel(deployment?.work_orders);
}

function formatCurrency(value: unknown) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "Not Set";
  return `₹${amount.toLocaleString("en-IN")}`;
}

function rateEffectiveLabel(deployment: any) {
  if (deployment?.daily_rate_effective_from) return formatDate(deployment.daily_rate_effective_from);
  return deployment?.daily_rate_effective_label || "Not Set";
}

function fullAadhaar(value: string | null | undefined) {
  const normalized = normalizeIdentifier(value);
  return normalized || "-";
}

function changedFieldCount(log: any) {
  const oldValues = log.old_values || {};
  const newValues = log.new_values || {};
  const keys = Array.from(new Set([...Object.keys(oldValues), ...Object.keys(newValues)]));
  const changed = keys.filter((key) => JSON.stringify(oldValues[key]) !== JSON.stringify(newValues[key]));
  return changed.length || (log.description ? 1 : 0);
}

export default function LabourWorkerDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { access } = useAccessContext();
  const permissions = access?.permissions || [];
  const global = hasGlobalAccess(access);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>("Overview");
  const [activityLimit, setActivityLimit] = useState(10);
  const [expandedActivity, setExpandedActivity] = useState<Record<string, boolean>>({});
  const [uploading, setUploading] = useState(false);
  const [documentType, setDocumentType] = useState("Aadhaar Card");
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [photoUrl, setPhotoUrl] = useState("");
  const [lookups, setLookups] = useState<any>({ companies: [], sites: [], work_orders: [], contractors: [], trades: [] });
  const [deploymentForm, setDeploymentForm] = useState(emptyDeploymentForm);
  const [deploymentOperation, setDeploymentOperation] = useState<"deployment" | "rate">("deployment");
  const [rateForm, setRateForm] = useState(emptyRateForm);
  const [showDeploymentForm, setShowDeploymentForm] = useState(false);
  const [deploymentError, setDeploymentError] = useState("");
  const [commercialWorkOrders, setCommercialWorkOrders] = useState<any[]>([]);
  const [commercialWorkOrdersLoading, setCommercialWorkOrdersLoading] = useState(false);
  const [commercialWorkOrdersError, setCommercialWorkOrdersError] = useState("");
  const canEdit = global || can(permissions, "labour_workers", "edit");
  const canChangeDeployment = global || can(permissions, "labour_workers", "change_deployment");
  const canChangeRate = global || can(permissions, "labour_workers", "change_rate");
  const canDeploy = canChangeDeployment || canChangeRate;
  const canUpload = global || can(permissions, "labour_documents", "upload");
  const canDeleteDocs = global || can(permissions, "labour_documents", "delete");
  const canDelete = global || can(permissions, "labour_workers", "delete");

  async function token() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || "";
  }

  async function parsePayload(response: Response): Promise<any> {
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { error: text };
    }
  }

  async function load() {
    const accessToken = await token();
    const [response, lookupResponse] = await Promise.all([
      fetch(`/api/labour/workers/${params.id}`, { headers: { Authorization: `Bearer ${accessToken}` } }),
      fetch("/api/labour/lookups?purpose=labour_deployment", { headers: { Authorization: `Bearer ${accessToken}` } }),
    ]);
    const payload = await parsePayload(response);
    if (response.ok) {
      setData(payload);
      const photo = (payload.documents || []).find((doc: any) => doc.document_type === "Photo" && doc.is_active);
      if (photo) {
        const photoResponse = await fetch(`/api/labour/workers/${params.id}/documents?document_id=${photo.id}`, { headers: { Authorization: `Bearer ${accessToken}` } });
        const photoPayload = await parsePayload(photoResponse);
        setPhotoUrl(photoResponse.ok && photoPayload.url ? photoPayload.url : "");
      } else {
        setPhotoUrl("");
      }
    } else {
      setError(payload.error || "Failed to load labourer.");
    }
    if (lookupResponse.ok) setLookups(await lookupResponse.json());
  }

  useEffect(() => { load(); }, [params.id]);

  async function loadCommercialWorkOrders(form = deploymentForm) {
    const contractorProfileId = form.contractor_profile_id || worker?.current_contractor_profile_id || "";
    if (form.commercial_model !== "contract_basis") return;
    if (!contractorProfileId || !form.company_id || !form.site_id) {
      setCommercialWorkOrders([]);
      setCommercialWorkOrdersError("");
      return;
    }
    setCommercialWorkOrdersLoading(true);
    setCommercialWorkOrdersError("");
    const lookupParams = new URLSearchParams({
      purpose: "labour_deployment",
      contractor_profile_id: contractorProfileId,
      company_id: form.company_id,
      site_id: form.site_id,
    });
    if (form.effective_from) lookupParams.set("effective_from", form.effective_from);
    const response = await fetch(`/api/labour/lookups?${lookupParams.toString()}`, { headers: { Authorization: `Bearer ${await token()}` } });
    const payload = await parsePayload(response);
    setCommercialWorkOrdersLoading(false);
    if (!response.ok) {
      setCommercialWorkOrders([]);
      setCommercialWorkOrdersError(payload.error || "Could not load Commercial Work Orders.");
      return;
    }
    setCommercialWorkOrders(payload.work_orders || []);
  }

  useEffect(() => {
    if (!showDeploymentForm) return;
    if (deploymentForm.commercial_model !== "contract_basis") return;
    loadCommercialWorkOrders();
  }, [showDeploymentForm, deploymentForm.commercial_model, deploymentForm.contractor_profile_id, deploymentForm.company_id, deploymentForm.site_id, deploymentForm.effective_from]);

  async function openDoc(documentId: string) {
    recordClientAuditEvent({ eventType: "view_document", entityType: "labour_worker", recordId: params.id, documentId, source: "labour_worker_detail" });
    setError("");
    const response = await fetch(`/api/labour/workers/${params.id}/documents?document_id=${documentId}`, { headers: { Authorization: `Bearer ${await token()}` } });
    const payload = await parsePayload(response);
    if (!response.ok) return setError(payload.error || "Could not open document.");
    if (payload.url) window.open(payload.url, "_blank");
  }

  async function uploadDoc() {
    if (!documentType) return setError("Select a document type.");
    if (!file) return setError("Choose a document file before uploading.");
    setError("");
    setSuccess("");
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("document_type", documentType);
      const response = await fetch(`/api/labour/workers/${params.id}/documents`, { method: "POST", headers: { Authorization: `Bearer ${await token()}` }, body: form });
      const payload = await parsePayload(response);
      if (!response.ok) return setError(payload.error || "Upload failed.");
      setFile(null);
      setFileInputKey((key) => key + 1);
      setSuccess(documentType === "Photo" ? "Profile photo uploaded successfully." : "Document uploaded successfully.");
      await load();
    } catch (uploadError: any) {
      setError(uploadError?.message || "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function deleteDoc(documentId: string) {
    if (!window.confirm("Delete this document?")) return;
    setError("");
    setSuccess("");
    const response = await fetch(`/api/labour/workers/${params.id}/documents?document_id=${documentId}`, { method: "DELETE", headers: { Authorization: `Bearer ${await token()}` } });
    const payload = await parsePayload(response);
    if (!response.ok) return setError(payload.error || "Could not delete document.");
    setSuccess("Document deleted successfully.");
    await load();
  }

  async function deleteWorker(currentWorker: any) {
    if (!window.confirm(`Delete labourer ${currentWorker.worker_name}?`)) return;
    setError("");
    setSuccess("");
    const response = await fetch(`/api/labour/workers/${params.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${await token()}` } });
    const payload = await parsePayload(response);
    if (!response.ok) return setError(payload.error || "Could not delete labourer.");
    setSuccess("Labourer deleted successfully.");
    router.push("/labour/workers");
  }

  async function saveDeployment() {
    setDeploymentError("");
    setSuccess("");
    if (currentDeployment && deploymentForm.effective_from && deploymentForm.effective_from <= currentDeployment.effective_from) {
      return setDeploymentError(`Transfer date must be after ${formatDate(currentDeployment.effective_from)}.`);
    }
    if (currentDeployment && deploymentForm.deployment_reason.trim().length < 10) {
      return setDeploymentError("Enter a transfer reason of at least 10 characters.");
    }
    const response = await fetch(`/api/labour/workers/${params.id}/deployments`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${await token()}` },
      body: JSON.stringify(deploymentForm),
    });
    const payload = await parsePayload(response);
    if (!response.ok) return setDeploymentError(payload.error || "Failed to save deployment.");
    setDeploymentForm(emptyDeploymentForm);
    setShowDeploymentForm(false);
    setDeploymentError("");
    setCommercialWorkOrders([]);
    setCommercialWorkOrdersError("");
    setSuccess(currentDeployment ? "Worker transferred successfully." : "Initial deployment created.");
    await load();
  }

  async function saveRateChange() {
    setDeploymentError("");
    setSuccess("");
    if (!rateForm.effective_from) return setDeploymentError("Effective From is required.");
    if (!/^\d+$/.test(rateForm.base_rate) || Number(rateForm.base_rate) <= 0) return setDeploymentError("New Daily Rate must be a positive whole rupee amount.");
    const reason = rateForm.reason.trim();
    if (!reason) return setDeploymentError("Reason is required.");
    if (reason.length < 10) return setDeploymentError("Reason must be at least 10 characters.");
    const response = await fetch(`/api/labour/workers/${params.id}/wage-rates`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${await token()}` },
      body: JSON.stringify({
        wage_type: "daily",
        base_rate: rateForm.base_rate,
        effective_from: rateForm.effective_from,
        reason,
        deployment_id: currentDeployment?.id || null,
        trade_id: currentDeployment?.labour_trade_id || worker.labour_trade_id || null,
        work_order_id: currentDeployment?.work_order_id || worker.current_work_order_id || null,
      }),
    });
    const payload = await parsePayload(response);
    if (!response.ok) return setDeploymentError(payload.error || "Failed to update daily rate.");
    setRateForm(emptyRateForm);
    setShowDeploymentForm(false);
    setDeploymentError("");
    setSuccess("Daily rate updated successfully.");
    await load();
  }

  const worker = data?.worker;
  if (!worker) return <section className="p-8 text-sm text-slate-500">{error || "Loading labourer..."}</section>;
  const deployments = data.deployments || [];
  const documents = data.documents || [];
  const wageRates = data.wage_rates || [];
  const currentDeployment = deployments.find((deployment: any) => deployment.status === "active" && !deployment.effective_to);
  const inactiveLog = (data.activity || []).find((log: any) => {
    const values = log.new_values || {};
    return values.status === "inactive" || values.new_status === "inactive";
  });
  const inactiveValues = inactiveLog?.new_values || {};
  const contractorName = worker.labour_contractor_profiles?.vendors?.vendor_name || null;
  const deploymentContractorId = deploymentForm.contractor_profile_id || worker.current_contractor_profile_id || "";
  const deploymentSites = lookups.sites || [];
  const deploymentWorkOrders = commercialWorkOrders;
  const deploymentManpowerWorkOrders = (lookups.manpower_work_orders || []).filter((mwo: any) => {
    if (mwo.status !== "approved") return false;
    if (deploymentForm.company_id && mwo.company_id !== deploymentForm.company_id) return false;
    if (deploymentForm.site_id && mwo.site_id !== deploymentForm.site_id) return false;
    if (deploymentContractorId && mwo.contractor_profile_id !== deploymentContractorId) return false;
    if (deploymentForm.effective_from && mwo.effective_from > deploymentForm.effective_from) return false;
    if (deploymentForm.effective_from && mwo.effective_to && mwo.effective_to < deploymentForm.effective_from) return false;
    return true;
  });
  const hasDailyWageFilters = Boolean(deploymentForm.company_id && deploymentForm.site_id && deploymentForm.effective_from);
  const noApprovedMwoAvailable = deploymentForm.commercial_model === "daily_wage" && hasDailyWageFilters && deploymentManpowerWorkOrders.length === 0;

  function openDeploymentForm() {
    setError("");
    setSuccess("");
    setDeploymentError("");
    setCommercialWorkOrders([]);
    setCommercialWorkOrdersError("");
    setDeploymentOperation(canChangeDeployment ? "deployment" : "rate");
    setRateForm(emptyRateForm);
    setDeploymentForm({
      ...emptyDeploymentForm,
      contractor_profile_id: worker.current_contractor_profile_id || "",
      company_id: currentDeployment?.company_id || "",
      site_id: currentDeployment?.site_id || "",
      labour_trade_id: currentDeployment?.labour_trade_id || worker.labour_trade_id || "",
      skill_level: currentDeployment?.skill_level || worker.skill_level || "",
      commercial_model: currentDeployment?.commercial_model || "contract_basis",
      effective_from: "",
      deployment_reason: "",
    });
    setShowDeploymentForm(true);
  }

  return (
    <section className="min-h-screen bg-[#f6f3f5] px-6 py-7 md:px-10">
      <div className="mx-auto max-w-[1400px] space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white p-5 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border bg-slate-100 text-2xl font-semibold">
              {photoUrl ? <img src={photoUrl} alt={worker.worker_name} className="h-full w-full object-cover" /> : worker.worker_name?.charAt(0) || "L"}
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.28em] text-sky-600">Labour Master</p>
              <h1 className="text-3xl font-semibold">{worker.worker_name}</h1>
              <p className="text-sm text-slate-600">{formatLabourCode(worker.labour_code)} · {worker.father_or_husband_name || "No father/husband name"}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {worker.current_contractor_profile_id && <Link href={`/labour/contractors/${worker.current_contractor_profile_id}`} className="inline-flex h-11 items-center rounded-lg border bg-white px-4 text-sm font-semibold">Open Contractor</Link>}
            {canDeploy && <button onClick={openDeploymentForm} className="inline-flex h-11 items-center gap-2 rounded-lg border bg-white px-4 text-sm font-semibold"><Plus className="h-4 w-4" /> {currentDeployment ? "Transfer / Update Deployment" : "Create Deployment"}</button>}
            {canEdit && <Link href={`/labour/workers/${worker.id}/edit`} className="inline-flex h-11 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white"><Pencil className="h-4 w-4" /> Edit</Link>}
            {canDelete && <button type="button" onClick={() => deleteWorker(worker)} className="inline-flex h-11 items-center gap-2 rounded-lg border border-red-200 bg-white px-4 text-sm font-semibold text-red-600"><Trash2 className="h-4 w-4" /> Delete</button>}
          </div>
        </header>
        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}
        {success && <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm font-semibold text-green-700">{success}</div>}

        <div className="rounded-lg border bg-white shadow-sm">
          <div className="flex flex-wrap border-b px-4">
            {tabs.map((tab) => <button key={tab} onClick={() => setActiveTab(tab)} className={`px-4 py-3 text-sm font-semibold ${activeTab === tab ? "border-b-2 border-slate-950 text-slate-950" : "text-slate-500"}`}>{tab}</button>)}
          </div>

          {activeTab === "Overview" && (
            <div className="grid gap-5 p-5 lg:grid-cols-[1fr_360px]">
              <Card title="Overview">
                <Info label="Labour Code" value={formatLabourCode(worker.labour_code)} />
                <Info label="Name" value={worker.worker_name} />
                <Info label="Father/Husband Name" value={worker.father_or_husband_name} />
                <Info label="Gender" value={worker.gender} />
                <Info label="Date of Birth" value={formatDate(worker.date_of_birth)} />
                <Info label="Contractor" value={contractorName || "Not Assigned"} />
                <Info label="Category" value={worker.labour_trades?.trade_name || worker.trade} />
                <Info label="Mobile" value={worker.mobile_number} />
                <Info label="Alternate Mobile" value={worker.alternate_mobile_number} />
                <Info label="Aadhaar" value={fullAadhaar(worker.aadhaar_number)} />
                <Info label="UAN" value={worker.uan_number} />
                <Info label="ESI" value={worker.esi_number} />
                <Info label="Bank Name" value={worker.bank_name} />
                <Info label="Joining Date" value={formatDate(worker.date_of_joining)} />
                <Info label="Status" value={labelFromCode(worker.status)} />
                {worker.status === "inactive" && <Info label="Inactive Effective Date" value={formatDate(inactiveValues.effective_date)} />}
                {worker.status === "inactive" && <Info label="Inactive Reason" value={inactiveValues.reason || inactiveLog?.description || "Recorded in activity history"} />}
                {worker.status === "inactive" && <Info label="Marked Inactive By" value={inactiveLog?.created_by_name || inactiveLog?.created_by_email || "-"} />}
                {worker.status === "inactive" && <Info label="Marked Inactive At" value={formatDateTime(inactiveLog?.created_at)} />}
              </Card>
              <Card title="Current Assignment">
                {currentDeployment ? (
                  <>
                    <Info label="Company" value={currentDeployment.companies?.company_name} />
                    <Info label="Site" value={currentDeployment.sites?.site_name} />
                    <Info label="Contractor" value={currentDeployment.labour_contractor_profiles?.vendors?.vendor_name || contractorName || "Not Assigned"} />
                    <Info label="Payment Model" value={paymentModelLabel(currentDeployment.commercial_model)} />
                    <Info label="Work Order" value={workOrderLabel(currentDeployment.work_orders || worker.current_work_orders)} />
                    <Info label="Daily Rate" value={currentDeployment.commercial_model === "daily_wage" ? formatCurrency(currentDeployment.daily_rate) : "Not Applicable"} />
                    <Info label="Category" value={currentDeployment.labour_trades?.trade_name || currentDeployment.trade} />
                    <Info label="Effective From" value={formatDate(currentDeployment.effective_from)} />
                  </>
                ) : (
                  <p className="text-sm font-semibold text-slate-600">Not Deployed</p>
                )}
              </Card>
            </div>
          )}

          {activeTab === "Documents" && (
            <div className="p-5">
              {canUpload && <div className="mb-4 grid gap-3 rounded-lg border bg-slate-50 p-3 md:grid-cols-[220px_1fr_auto]">
                <select value={documentType} onChange={(event) => setDocumentType(event.target.value)} className="h-10 rounded-lg border px-3 text-sm">{LABOUR_DOCUMENT_TYPES.map((type) => <option key={type}>{type}</option>)}</select>
                <label className="flex h-10 cursor-pointer items-center rounded-lg border bg-white px-3 text-sm font-semibold">
                  Choose File
                  <input key={fileInputKey} type="file" onChange={(event) => setFile(event.target.files?.[0] || null)} className="hidden" />
                  {file && <span className="ml-3 font-normal text-slate-500">Selected: {file.name}</span>}
                </label>
                <button type="button" onClick={uploadDoc} disabled={!documentType || !file || uploading} className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-3 text-sm font-semibold text-white disabled:opacity-60"><FileUp className="h-4 w-4" /> {uploading ? "Uploading..." : "Upload"}</button>
              </div>}
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>{["Type", "File Name", "Uploaded At", "Uploaded By", "Open", "Delete"].map((heading) => <th key={heading} className="px-3 py-3">{heading}</th>)}</tr></thead>
                  <tbody className="divide-y">
                    {documents.map((doc: any) => <tr key={doc.id}><td className="px-3 py-3 font-semibold">{doc.document_type} v{doc.version}{doc.is_active ? "" : " (inactive)"}</td><td className="px-3 py-3">{doc.original_file_name || doc.document_name || "-"}</td><td className="px-3 py-3">{formatDateTime(doc.uploaded_at)}</td><td className="px-3 py-3">{doc.uploaded_by_name || "-"}</td><td className="px-3 py-3"><button type="button" onClick={() => openDoc(doc.id)} className="rounded-md border px-3 py-1">Open</button></td><td className="px-3 py-3">{canDeleteDocs && <button type="button" onClick={() => deleteDoc(doc.id)} className="rounded-md border border-red-200 px-3 py-1 text-red-600">Delete</button>}</td></tr>)}
                    {!documents.length && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">No documents uploaded.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === "Transfer History" && (
            <div className="space-y-5 p-5">
              <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>{["Company", "Site", "Model", "Work Order", "Category", "From", "To", "Status", "Reason"].map((heading) => <th key={heading} className="px-3 py-3">{heading}</th>)}</tr></thead>
                <tbody className="divide-y">
                  {deployments.map((deployment: any) => <tr key={deployment.id}><td className="px-3 py-3">{deployment.companies?.company_name || "-"}</td><td className="px-3 py-3">{deployment.sites?.site_name || "-"}</td><td className="px-3 py-3">{paymentModelLabel(deployment.commercial_model)}</td><td className="px-3 py-3">{assignmentLabel(deployment)}</td><td className="px-3 py-3">{deployment.labour_trades?.trade_name || deployment.trade || "-"}</td><td className="px-3 py-3">{formatDate(deployment.effective_from)}</td><td className="px-3 py-3">{deployment.effective_to ? formatDate(deployment.effective_to) : "Current"}</td><td className="px-3 py-3">{labelFromCode(deployment.status)}</td><td className="px-3 py-3">{deployment.deployment_reason || deployment.transfer_reason || "-"}</td></tr>)}
                  {!deployments.length && <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-500">No deployments recorded.</td></tr>}
                </tbody>
              </table>
              </div>
              <section className="rounded-lg border">
                <div className="border-b bg-slate-50 px-3 py-3 text-sm font-semibold">Rate History</div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>{["Rate", "Effective From", "Effective To", "Status", "Reason", "Changed By", "Changed At", "Company", "Site", "Work Order", "Category"].map((heading) => <th key={heading} className="px-3 py-3">{heading}</th>)}</tr></thead>
                    <tbody className="divide-y">
                      {wageRates.map((rate: any) => <tr key={rate.id}><td className="px-3 py-3">{formatCurrency(rate.base_rate)}</td><td className="px-3 py-3">{formatDate(rate.effective_from)}</td><td className="px-3 py-3">{rate.effective_to ? formatDate(rate.effective_to) : "Current"}</td><td className="px-3 py-3">{labelFromCode(rate.status)}</td><td className="px-3 py-3">{rate.reason || "-"}</td><td className="px-3 py-3">{rate.created_by_name || rate.created_by_email || "-"}</td><td className="px-3 py-3">{formatDateTime(rate.created_at)}</td><td className="px-3 py-3">{rate.companies?.company_name || "-"}</td><td className="px-3 py-3">{rate.sites?.site_name || "-"}</td><td className="px-3 py-3">{workOrderLabel(rate.work_orders)}</td><td className="px-3 py-3">{rate.labour_trades?.trade_name || "-"}</td></tr>)}
                      {!wageRates.length && <tr><td colSpan={11} className="px-3 py-8 text-center text-slate-500">No rate changes recorded.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )}

          {activeTab === "Activity" && (
            <div className="overflow-x-auto p-5">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>{["Date", "User", "Action", "Changed", "Reason", "Details"].map((heading) => <th key={heading} className="px-3 py-3">{heading}</th>)}</tr></thead>
                <tbody className="divide-y">
                  {(data.activity || []).slice(0, activityLimit).map((log: any) => <tr key={log.id}><td className="px-3 py-3">{formatDateTime(log.created_at)}</td><td className="px-3 py-3">{log.created_by_name || log.created_by_email || "-"}</td><td className="px-3 py-3">{labelFromCode(log.action)}</td><td className="px-3 py-3">{changedFieldCount(log)} fields changed</td><td className="px-3 py-3">{log.description || "-"}</td><td className="px-3 py-3"><button onClick={() => setExpandedActivity((current) => ({ ...current, [log.id]: !current[log.id] }))} className="rounded-md border px-3 py-1">{expandedActivity[log.id] ? "Hide Details" : "View Details"}</button>{expandedActivity[log.id] && <pre className="mt-2 max-w-md whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs">{activityDetails(log)}</pre>}</td></tr>)}
                  {!data.activity?.length && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">No activity recorded.</td></tr>}
                </tbody>
              </table>
              {(data.activity || []).length > activityLimit && <button onClick={() => setActivityLimit((limit) => limit + 10)} className="mt-3 rounded-lg border px-4 py-2 text-sm font-semibold">Load More</button>}
            </div>
          )}
        </div>
      </div>

      {showDeploymentForm && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">{currentDeployment ? "Transfer / Change Deployment" : "Create Initial Deployment"}</h2>
              {currentDeployment && <p className="mt-1 text-sm text-slate-500">Current deployment started on {formatDate(currentDeployment.effective_from)}. New deployment must start after {formatDate(currentDeployment.effective_from)}.</p>}
            </div>
            <button onClick={() => { setShowDeploymentForm(false); setDeploymentError(""); }} className="rounded-lg border px-3 py-2 text-sm font-semibold">Close</button>
          </div>
          {(deploymentError || commercialWorkOrdersError) && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{deploymentError || commercialWorkOrdersError}</div>}
          {canChangeDeployment && canChangeRate && <label className="mb-4 block text-sm font-semibold text-slate-700">Change Type<select value={deploymentOperation} onChange={(event) => { setDeploymentError(""); setDeploymentOperation(event.target.value as "deployment" | "rate"); }} className="mt-1 h-11 w-full rounded-lg border px-3"><option value="deployment">Transfer / Change Deployment</option><option value="rate">Update Daily Rate</option></select></label>}
          {canChangeDeployment && !canChangeRate && <p className="mb-4 rounded-lg border bg-slate-50 p-3 text-sm font-semibold text-slate-700">Change Type: Transfer / Change Deployment</p>}
          {canChangeRate && !canChangeDeployment && <p className="mb-4 rounded-lg border bg-slate-50 p-3 text-sm font-semibold text-slate-700">Change Type: Update Daily Rate</p>}
          {deploymentOperation === "deployment" && canChangeDeployment && <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm font-semibold text-slate-700">Contractor<input value={lookups.contractors.find((contractor: any) => contractor.id === deploymentContractorId)?.vendors?.vendor_name || lookups.contractors.find((contractor: any) => contractor.id === deploymentContractorId)?.contractor_code || "-"} disabled className="mt-1 h-11 w-full rounded-lg border bg-slate-100 px-3" /></label>
            <label className="text-sm font-semibold text-slate-700">Payment Model<select value={deploymentForm.commercial_model} onChange={(event) => { setDeploymentError(""); setCommercialWorkOrdersError(""); setCommercialWorkOrders([]); setDeploymentForm({ ...deploymentForm, commercial_model: event.target.value, work_order_id: "", manpower_work_order_id: "" }); }} className="mt-1 h-11 w-full rounded-lg border px-3"><option value="daily_wage">Daily Wage</option><option value="contract_basis">Contractual Labour</option></select></label>
            <label className="text-sm font-semibold text-slate-700">Company<select value={deploymentForm.company_id} onChange={(event) => { setDeploymentError(""); setCommercialWorkOrdersError(""); setDeploymentForm({ ...deploymentForm, company_id: event.target.value, work_order_id: "", manpower_work_order_id: "" }); }} className="mt-1 h-11 w-full rounded-lg border px-3"><option value="">Select Company</option>{lookups.companies.map((company: any) => <option key={company.id} value={company.id}>{company.company_name}</option>)}</select></label>
            <label className="text-sm font-semibold text-slate-700">Site<select value={deploymentForm.site_id} onChange={(event) => { setDeploymentError(""); setCommercialWorkOrdersError(""); setDeploymentForm({ ...deploymentForm, site_id: event.target.value, work_order_id: "", manpower_work_order_id: "" }); }} className="mt-1 h-11 w-full rounded-lg border px-3"><option value="">Select Site</option>{deploymentSites.map((site: any) => <option key={site.id} value={site.id}>{site.site_name}</option>)}</select></label>
            <label className="text-sm font-semibold text-slate-700">Labour Category<select value={deploymentForm.labour_trade_id} onChange={(event) => setDeploymentForm({ ...deploymentForm, labour_trade_id: event.target.value })} className="mt-1 h-11 w-full rounded-lg border px-3"><option value="">Select Labour Category</option>{lookups.trades.map((trade: any) => <option key={trade.id} value={trade.id}>{trade.trade_name}</option>)}</select></label>
            <label className="text-sm font-semibold text-slate-700">Effective From<input type="date" value={deploymentForm.effective_from} onChange={(event) => { setDeploymentError(""); setCommercialWorkOrdersError(""); setDeploymentForm({ ...deploymentForm, effective_from: event.target.value, manpower_work_order_id: "" }); }} className="mt-1 h-11 w-full rounded-lg border px-3" /></label>
            {deploymentForm.commercial_model === "daily_wage" && <label className="text-sm font-semibold text-slate-700 md:col-span-2">Approved Manpower Work Order<select value={deploymentForm.manpower_work_order_id} disabled={noApprovedMwoAvailable} onChange={(event) => setDeploymentForm({ ...deploymentForm, manpower_work_order_id: event.target.value })} className="mt-1 h-11 w-full rounded-lg border px-3 disabled:bg-slate-100 disabled:text-slate-500"><option value="">{noApprovedMwoAvailable ? "No approved MWO available" : "Select Approved MWO"}</option>{deploymentManpowerWorkOrders.map((mwo: any) => <option key={mwo.id} value={mwo.id}>{mwo.manpower_wo_number} · {mwo.title}</option>)}</select>{noApprovedMwoAvailable && <span className="mt-1 block text-xs font-medium text-slate-500">Create & approve an MWO for the selected site.</span>}</label>}
            {deploymentForm.commercial_model === "contract_basis" && <label className="text-sm font-semibold text-slate-700 md:col-span-2">Commercial Work Order<select value={deploymentForm.work_order_id} disabled={commercialWorkOrdersLoading || Boolean(deploymentForm.company_id && deploymentForm.site_id && !commercialWorkOrdersLoading && !deploymentWorkOrders.length)} onChange={(event) => { setDeploymentError(""); setCommercialWorkOrdersError(""); setDeploymentForm({ ...deploymentForm, work_order_id: event.target.value }); }} className="mt-1 h-11 w-full rounded-lg border px-3 disabled:bg-slate-100 disabled:text-slate-500"><option value="">{commercialWorkOrdersLoading ? "Loading approved Commercial Work Orders..." : deploymentForm.company_id && deploymentForm.site_id && !deploymentWorkOrders.length ? "No approved Commercial Work Order available" : "Select Commercial Work Order"}</option>{deploymentWorkOrders.map((wo: any) => <option key={wo.id} value={wo.id}>{wo.wo_number}{wo.wo_type ? ` — ${wo.wo_type}` : ""}</option>)}</select>{deploymentForm.company_id && deploymentForm.site_id && !commercialWorkOrdersLoading && !deploymentWorkOrders.length && !commercialWorkOrdersError && <span className="mt-1 block text-xs font-medium text-slate-500">No approved Commercial Work Order is linked to this contractor for the selected company and site.</span>}</label>}
            <label className="text-sm font-semibold text-slate-700 md:col-span-2">{currentDeployment ? "Transfer Reason *" : "Reason (Optional)"}<input value={deploymentForm.deployment_reason} onChange={(event) => setDeploymentForm({ ...deploymentForm, deployment_reason: event.target.value })} className="mt-1 h-11 w-full rounded-lg border px-3" /></label>
          </div>}
          {deploymentOperation === "rate" && canChangeRate && <div className="grid gap-3 md:grid-cols-2">
            <Info label="Current Daily Rate" value={formatCurrency(currentDeployment?.daily_rate)} />
            <Info label="Effective From" value={rateEffectiveLabel(currentDeployment)} />
            <Info label="Company" value={currentDeployment?.companies?.company_name || "-"} />
            <Info label="Site" value={currentDeployment?.sites?.site_name || "-"} />
            <Info label="Contractor" value={currentDeployment?.labour_contractor_profiles?.vendors?.vendor_name || contractorName || "Not Assigned"} />
            <Info label="Work Order" value={workOrderLabel(currentDeployment?.work_orders || worker.current_work_orders)} />
            <Info label="Category" value={currentDeployment?.labour_trades?.trade_name || currentDeployment?.trade || worker.labour_trades?.trade_name || "-"} />
            <label className="text-sm font-semibold text-slate-700">New Daily Rate<input type="number" min="1" step="1" value={rateForm.base_rate} onChange={(event) => setRateForm({ ...rateForm, base_rate: event.target.value.replace(/\D/g, "") })} className="mt-1 h-11 w-full rounded-lg border px-3" /></label>
            <label className="text-sm font-semibold text-slate-700">Effective From<input type="date" value={rateForm.effective_from} onChange={(event) => setRateForm({ ...rateForm, effective_from: event.target.value })} className="mt-1 h-11 w-full rounded-lg border px-3" /></label>
            <label className="text-sm font-semibold text-slate-700 md:col-span-2">Reason *<input value={rateForm.reason} onChange={(event) => setRateForm({ ...rateForm, reason: event.target.value })} className="mt-1 h-11 w-full rounded-lg border px-3" /></label>
          </div>}
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={() => { setShowDeploymentForm(false); setDeploymentError(""); }} className="rounded-lg border px-4 py-2 text-sm font-semibold">Cancel</button>
            {deploymentOperation === "deployment" && canChangeDeployment && <button onClick={saveDeployment} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white">{currentDeployment ? "Save Transfer" : "Create Deployment"}</button>}
            {deploymentOperation === "rate" && canChangeRate && <button onClick={saveRateChange} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Update Daily Rate</button>}
          </div>
        </div>
      </div>}
    </section>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-lg border bg-white p-5"><h2 className="mb-4 text-lg font-semibold">{title}</h2><div className="grid gap-3 md:grid-cols-2">{children}</div></section>;
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return <div><p className="text-xs font-bold uppercase text-slate-500">{label}</p><p className="font-semibold">{value || "-"}</p></div>;
}

function activityDetails(log: any) {
  const oldValues = log.old_values || {};
  const newValues = log.new_values || {};
  const keys = Array.from(new Set([...Object.keys(oldValues), ...Object.keys(newValues)]))
    .filter((key) => !key.endsWith("_id") && !["id", "organization_id", "company_id", "site_id"].includes(key))
    .filter((key) => JSON.stringify(oldValues[key]) !== JSON.stringify(newValues[key]));
  if (!keys.length) return log.description || "No field-level changes recorded.";
  return keys.slice(0, 12).map((key) => `${labelFromCode(key)}: ${oldValues[key] ?? "Not set"} → ${newValues[key] ?? "Not set"}`).join("\n");
}
