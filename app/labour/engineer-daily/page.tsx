"use client";

import { AlertTriangle, Camera, CheckCircle2, Info, Plus, Save, Send, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { can, hasGlobalAccess } from "@/lib/accessControl";
import { useAccessContext } from "@/components/AccessContext";
import { clearSelectedLabourContext, labourContextFromLookup, readSelectedLabourContext, resolveSingleLabourSiteId, selectedLabourContextIsValid, selectedLabourSiteIsValid, subscribeLabourWorkspaceSummary, type LabourWorkspaceSummary, writeSelectedLabourContext } from "@/lib/labour/attendanceSystemContext";

const unitOptions = ["Sq Ft", "Sq M", "Nos", "m", "km", "kg", "ton", "bags", "hours", "Cum", "Rmt", "Job"];
type AlertState = { type: "error" | "warning" | "success" | "info"; text: string } | null;
type CameraState = {
  open: boolean;
  group: any | null;
  stream: MediaStream | null;
  capturedUrl: string;
  capturedBlob: Blob | null;
  error: string;
  starting: boolean;
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function formatTime(value?: string | null) {
  if (!value) return "-";
  const [hourText, minuteText] = String(value).split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return value;
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function newGroup(number: number, contractorId = ""): any {
  return {
    client_id: crypto.randomUUID(),
    id: "",
    group_number: number,
    group_name: `Group ${number}`,
    contractor_profile_id: contractorId,
    work_type: "productive",
    work_description: "",
    quantity: "",
    unit: "",
    remarks: "",
    member_worker_ids: [],
    photos: [],
    status: "draft",
  };
}

async function token() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || "";
}

async function readPayload(response: Response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: text || "Request failed." };
  }
}

export default function EngineerDailyLabourPage() {
  const { access } = useAccessContext();
  const permissions = access?.permissions || [];
  const global = hasGlobalAccess(access);
  const canSave = global || can(permissions, "labour_engineer_daily", "add") || can(permissions, "labour_engineer_daily", "edit");
  const canSubmit = global || can(permissions, "labour_engineer_daily", "submit");
  const [lookups, setLookups] = useState<any>({ companies: [], sites: [], engineers: [], contractors: [] });
  const [labourWorkspace, setLabourWorkspace] = useState<LabourWorkspaceSummary>({ pairs: [], attendance_systems: [] });
  const [filters, setFilters] = useState({ company_id: "", site_id: "", work_date: today(), engineer_employee_id: "", contractor_profile_id: "", search: "" });
  const [rows, setRows] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<string[]>([]);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [addLabourGroupId, setAddLabourGroupId] = useState("");
  const [draftGroupName, setDraftGroupName] = useState("");
  const [deletedGroupIds, setDeletedGroupIds] = useState<string[]>([]);
  const [currentEngineer, setCurrentEngineer] = useState<any>(null);
  const [adminMode, setAdminMode] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [sendBackFeedback, setSendBackFeedback] = useState<any>(null);
  const [alert, setAlert] = useState<AlertState>(null);
  const [invalidKey, setInvalidKey] = useState("");
  const [hasLoaded, setHasLoaded] = useState(false);
  const [restoringContext, setRestoringContext] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cameraState, setCameraState] = useState<CameraState>({ open: false, group: null, stream: null, capturedUrl: "", capturedBlob: null, error: "", starting: false });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const sites = useMemo(() => lookups.sites || [], [lookups.sites]);
  const siteOptions = useMemo(() => sites, [sites]);
  const contractors = useMemo(() => lookups.contractors || [], [lookups.contractors]);
  const workflowBlocked = alert?.text === "Attendance system is not configured for this site."
    || alert?.text === "This site uses Standard Labour Attendance. Engineer Daily Labour is not required.";
  const filteredRows = useMemo(() => {
    const query = filters.search.trim().toUpperCase();
    if (!query) return rows;
    return rows.filter((row) => [row.labour_code, row.worker_name, row.contractor_name, row.category_name].some((value) => String(value || "").toUpperCase().includes(query)));
  }, [rows, filters.search]);

  function resetLoadedState(patch: Partial<typeof filters>) {
    closeCamera();
    if ("company_id" in patch || "site_id" in patch) clearSelectedLabourContext();
    setFilters((current) => ({ ...current, ...patch }));
    setRows([]);
    setGroups([]);
    setSelectedWorkerIds([]);
    setShowCreateGroup(false);
    setAddLabourGroupId("");
    setDraftGroupName("");
    setDeletedGroupIds([]);
    setCurrentEngineer(null);
    setReadOnly(false);
    setSendBackFeedback(null);
    setAlert(null);
    setInvalidKey("");
    setHasLoaded(false);
  }

  function showAlert(type: NonNullable<AlertState>["type"], textValue: string) {
    setAlert({ type, text: textValue });
  }

  async function loadDaily(options: { contextOnly?: boolean } = {}) {
    if (loading) return;
    if (!options.contextOnly && (!filters.company_id || !filters.site_id || !filters.work_date)) {
      setHasLoaded(false);
      return showAlert("info", "Select Company, Site, Date and Engineer, then click Load Daily Labour.");
    }
    if (!options.contextOnly && adminMode && !filters.engineer_employee_id) {
      setHasLoaded(false);
      return showAlert("info", "Select Company, Site, Date and Engineer, then click Load Daily Labour.");
    }
    setAlert(null);
    setInvalidKey("");
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.company_id) params.set("company_id", filters.company_id);
      if (filters.site_id) params.set("site_id", filters.site_id);
      if (filters.work_date) params.set("work_date", filters.work_date);
      if (filters.engineer_employee_id) params.set("engineer_employee_id", filters.engineer_employee_id);
      if (filters.contractor_profile_id) params.set("contractor_profile_id", filters.contractor_profile_id);
      if (options.contextOnly) params.set("context_only", "1");
      const response = await fetch(`/api/labour/engineer-daily?${params.toString()}`, { headers: { Authorization: `Bearer ${await token()}` } });
      const payload = await readPayload(response);
      if (!response.ok) {
        setRows([]);
        setGroups([]);
        if (filters.company_id && filters.site_id) {
          const attendanceSystem = payload.error === "This site uses Standard Labour Attendance. Engineer Daily Labour is not required."
            ? { value: "standard" }
            : payload.error === "Attendance system is not configured for this site."
              ? { value: "unconfigured" }
              : null;
          if (attendanceSystem) {
            writeSelectedLabourContext(labourContextFromLookup({
              companyId: filters.company_id,
              siteId: filters.site_id,
              companies: payload.companies || lookups.companies,
              attendanceSystem,
            }));
          }
        }
        return showAlert("error", payload.error || "Could not load Engineer Daily Labour.");
      }
      if (filters.company_id && filters.site_id) {
        writeSelectedLabourContext(labourContextFromLookup({
          companyId: filters.company_id,
          siteId: filters.site_id,
          companies: payload.companies || lookups.companies,
          attendanceSystem: { value: "site_in_engineer" },
        }));
      }
      setLookups({
        companies: payload.companies || [],
        sites: payload.sites || [],
        engineers: payload.engineers || [],
        contractors: payload.contractors || [],
      });
      setRows(payload.rows || []);
      setGroups((payload.groups || []).map((group: any) => ({ ...group, client_id: group.client_id || group.id || crypto.randomUUID(), member_worker_ids: group.member_worker_ids || [], photos: group.photos || [] })));
      setSelectedWorkerIds([]);
      setShowCreateGroup(false);
      setAddLabourGroupId("");
      setDraftGroupName("");
      setDeletedGroupIds([]);
      setCurrentEngineer(payload.current_engineer || null);
      setAdminMode(Boolean(payload.admin_mode));
      setReadOnly(Boolean(payload.read_only));
      setSendBackFeedback(payload.send_back_feedback || null);
      if (!payload.admin_mode && payload.current_engineer?.id) setFilters((current) => ({ ...current, engineer_employee_id: payload.current_engineer.id }));
      setHasLoaded(!options.contextOnly);
      if (!options.contextOnly && payload.read_only) showAlert("info", "Daily Labour has been submitted and is read-only.");
      else if (!options.contextOnly && !(payload.rows || []).length) showAlert("info", "No assigned Site-In labour for this engineer/date.");
    } catch (error: any) {
      setHasLoaded(!options.contextOnly);
      showAlert("error", error.message || "Could not load Engineer Daily Labour.");
    } finally {
      setLoading(false);
    }
  }

  function updateRow(workerId: string, patch: any) {
    setRows((current) => current.map((row) => row.labour_worker_id === workerId ? { ...row, ...patch, status: "draft" } : row));
  }

  function patchGroup(clientId: string, patch: any) {
    setGroups((current) => current.map((group) => group.client_id === clientId ? { ...group, ...patch } : group));
  }

  function groupedWorkerIds() {
    return new Set(groups.flatMap((group) => group.member_worker_ids || []));
  }

  function unassignedRows() {
    const groupedIds = groupedWorkerIds();
    return filteredRows.filter((row) => !groupedIds.has(row.labour_worker_id));
  }

  function groupMembers(group: any) {
    return filteredRows.filter((row) => (group.member_worker_ids || []).includes(row.labour_worker_id));
  }

  function toggleSelectedWorker(workerId: string) {
    setSelectedWorkerIds((current) => current.includes(workerId) ? current.filter((id) => id !== workerId) : [...current, workerId]);
  }

  function openCreateGroup() {
    if (!unassignedRows().length) return;
    setSelectedWorkerIds([]);
    setDraftGroupName("");
    setAddLabourGroupId("");
    setShowCreateGroup(true);
  }

  function addGroup() {
    const available = new Set(unassignedRows().map((row) => row.labour_worker_id));
    const members = selectedWorkerIds.filter((workerId) => available.has(workerId));
    if (!members.length) return showAlert("error", "Select unassigned labourers before creating a group.");
    const groupNumber = groups.length + 1;
    const firstMember = rows.find((row) => row.labour_worker_id === members[0]);
    const group = newGroup(groupNumber, firstMember?.contractor_profile_id || contractors[0]?.id || "");
    group.group_name = draftGroupName.trim() || `Group ${groupNumber}`;
    group.member_worker_ids = members;
    setGroups((current) => [...current, group]);
    setSelectedWorkerIds([]);
    setDraftGroupName("");
    setShowCreateGroup(false);
  }

  function cancelCreateGroup() {
    setSelectedWorkerIds([]);
    setDraftGroupName("");
    setShowCreateGroup(false);
    setAddLabourGroupId("");
  }

  function openAddLabour(group: any) {
    if (!unassignedRows().length) return;
    setSelectedWorkerIds([]);
    setShowCreateGroup(false);
    setAddLabourGroupId(group.client_id);
  }

  function addLabourToGroup(group: any) {
    const available = new Set(unassignedRows().map((row) => row.labour_worker_id));
    const members = selectedWorkerIds.filter((workerId) => available.has(workerId));
    if (!members.length) return showAlert("error", "Select unassigned labourers before adding to the group.");
    patchGroup(group.client_id, { member_worker_ids: Array.from(new Set([...(group.member_worker_ids || []), ...members])) });
    setSelectedWorkerIds([]);
    setAddLabourGroupId("");
  }

  function removeWorkerFromGroup(group: any, workerId: string) {
    if (readOnly || saving) return;
    patchGroup(group.client_id, { member_worker_ids: (group.member_worker_ids || []).filter((id: string) => id !== workerId) });
    setSelectedWorkerIds((current) => current.filter((id) => id !== workerId));
    showAlert("success", "Labourer removed from group.");
  }

  function markFirstInvalid(errorText: string) {
    const lower = errorText.toLowerCase();
    const worker = rows.find((row) => lower.includes(String(row.worker_name || row.labour_code || "").toLowerCase()));
    if (worker) {
      if (lower.includes("first shift") || lower.includes("first half")) setInvalidKey(`${worker.labour_worker_id}:first`);
      else if (lower.includes("second shift") || lower.includes("second half")) setInvalidKey(`${worker.labour_worker_id}:second`);
      else setInvalidKey(`${worker.labour_worker_id}:row`);
    }
    const group = groups.find((item) => lower.includes(`group ${item.group_number}`.toLowerCase()) || lower.includes(String(item.group_name || "").toLowerCase()));
    if (group) setInvalidKey(`${group.client_id}:group`);
    requestAnimationFrame(() => document.querySelector("[data-invalid='true']")?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  function deleteGroup(group: any) {
    if (readOnly || group.status !== "draft") return showAlert("error", "Only draft groups can be deleted.");
    if (!window.confirm("Delete this group?\n\nLabourers will return to Unassigned.\nDraft work details and photos will be removed.")) return;
    if (group.id) setDeletedGroupIds((current) => [...current, group.id]);
    (group.photos || []).forEach((photo: any) => revokeCapturedUrl(photo.preview_url));
    setGroups((current) => current.filter((item) => item.client_id !== group.client_id));
    showAlert("success", "Group deleted.");
  }

  async function uploadGroupPhotoToSavedGroup(groupId: string, file: File, captureSource: string) {
    const accessToken = await token();
    const formData = new FormData();
    formData.set("file", file);
    formData.set("reference_type", "work_group");
    formData.set("reference_id", groupId);
    formData.set("photo_type", "normal_work");
    formData.set("capture_source", captureSource);
    const response = await fetch("/api/labour/photo-evidence", { method: "POST", headers: { Authorization: `Bearer ${accessToken}` }, body: formData });
    const payload = await readPayload(response);
    if (!response.ok) throw new Error(payload.error || "Could not upload group photo.");
    return payload;
  }

  async function uploadGroupPhoto(group: any, file: File, captureSource: string) {
    if (!group.id) {
      const previewUrl = URL.createObjectURL(file);
      const pendingPhoto = {
        id: `pending-${crypto.randomUUID()}`,
        original_file_name: file.name,
        server_received_at: null,
        uploaded_by_name: "Pending upload",
        pending: true,
        file,
        capture_source: captureSource,
        preview_url: previewUrl,
      };
      patchGroup(group.client_id, { photos: [...(group.photos || []), pendingPhoto] });
      return showAlert("success", "Photo captured. It will upload when you save the draft.");
    }
    await uploadGroupPhotoToSavedGroup(group.id, file, captureSource);
    showAlert("success", "Photo uploaded with ERP timestamp.");
    await loadDaily();
  }

  function removePendingPhoto(group: any, photoId: string) {
    const photo = (group.photos || []).find((item: any) => item.id === photoId);
    revokeCapturedUrl(photo?.preview_url);
    patchGroup(group.client_id, { photos: (group.photos || []).filter((item: any) => item.id !== photoId) });
  }

  async function uploadPendingPhotos(savedGroups: any[]) {
    const savedByClient = new Map((savedGroups || []).map((group: any) => [group.client_id || group.id, group]));
    const pending: { group: any; savedGroup: any; photo: any }[] = [];
    for (const group of groups) {
      const savedGroup = savedByClient.get(group.client_id) || savedByClient.get(group.id);
      for (const photo of group.photos || []) {
        if (photo.pending && photo.file && savedGroup?.id) pending.push({ group, savedGroup, photo });
      }
    }
    if (!pending.length) return { uploaded: 0, failed: 0 };
    let uploaded = 0;
    let failed = 0;
    for (const item of pending) {
      try {
        await uploadGroupPhotoToSavedGroup(item.savedGroup.id, item.photo.file, item.photo.capture_source || "constructiq_camera_v1");
        uploaded += 1;
        revokeCapturedUrl(item.photo.preview_url);
      } catch {
        failed += 1;
      }
    }
    return { uploaded, failed };
  }

  function stopCameraStream(stream?: MediaStream | null) {
    stream?.getTracks().forEach((track) => track.stop());
  }

  function revokeCapturedUrl(url?: string) {
    if (url) URL.revokeObjectURL(url);
  }

  function closeCamera() {
    setCameraState((current) => {
      stopCameraStream(current.stream);
      revokeCapturedUrl(current.capturedUrl);
      if (videoRef.current) videoRef.current.srcObject = null;
      return { open: false, group: null, stream: null, capturedUrl: "", capturedBlob: null, error: "", starting: false };
    });
  }

  async function openCamera(group: any) {
    if (readOnly || saving) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState({ open: true, group, stream: null, capturedUrl: "", capturedBlob: null, error: "Live camera capture is not supported in this browser.", starting: false });
      return;
    }
    closeCamera();
    setCameraState({ open: true, group, stream: null, capturedUrl: "", capturedBlob: null, error: "", starting: true });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      setCameraState({ open: true, group, stream, capturedUrl: "", capturedBlob: null, error: "", starting: false });
    } catch (error: any) {
      const name = String(error?.name || "");
      const message = name === "NotAllowedError" || name === "PermissionDeniedError"
        ? "Camera access was denied. Please allow camera permission in your browser settings."
        : name === "NotFoundError" || name === "DevicesNotFoundError"
          ? "No camera is available on this device."
          : "Could not open the camera. Please retry.";
      setCameraState({ open: true, group, stream: null, capturedUrl: "", capturedBlob: null, error: message, starting: false });
    }
  }

  function retakePhoto() {
    setCameraState((current) => {
      revokeCapturedUrl(current.capturedUrl);
      return { ...current, capturedUrl: "", capturedBlob: null, error: "" };
    });
  }

  async function capturePhoto() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return showAlert("error", "Camera preview is not ready.");
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return showAlert("error", "Camera capture is not supported in this browser.");
    context.drawImage(video, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) return showAlert("error", "Could not capture photo.");
    setCameraState((current) => {
      revokeCapturedUrl(current.capturedUrl);
      return { ...current, capturedBlob: blob, capturedUrl: URL.createObjectURL(blob), error: "" };
    });
  }

  async function useCapturedPhoto() {
    if (!cameraState.group || !cameraState.capturedBlob) return;
    const file = new File([cameraState.capturedBlob], `engineer-daily-${Date.now()}.jpg`, { type: "image/jpeg" });
    const group = cameraState.group;
    closeCamera();
    await uploadGroupPhoto(group, file, "constructiq_camera_v1");
  }

  async function save(action: "save_draft" | "submit") {
    if (saving) return;
    if (!filters.company_id || !filters.site_id || !filters.work_date) return showAlert("error", "Company, site and date are required.");
    if (!rows.length) return showAlert("error", "Load assigned Site-In labour before saving.");
    setInvalidKey("");
    setSaving(true);
    setAlert(null);
    try {
      const response = await fetch("/api/labour/engineer-daily", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({
          action,
          company_id: filters.company_id,
          site_id: filters.site_id,
          work_date: filters.work_date,
          engineer_employee_id: adminMode ? filters.engineer_employee_id : undefined,
          rows,
          groups,
          deleted_group_ids: deletedGroupIds,
        }),
      });
      const payload = await readPayload(response);
      if (!response.ok) {
        const errorText = payload.error || "Could not save Engineer Daily Labour.";
        markFirstInvalid(errorText);
        return showAlert("error", errorText);
      }
      const successText = action === "submit"
        ? `Submitted Daily Labour (${payload.submitted || 0} contractor package${payload.submitted === 1 ? "" : "s"}).`
        : `Saved draft (${payload.saved || 0} attendance row${payload.saved === 1 ? "" : "s"}, ${payload.groups || 0} group${payload.groups === 1 ? "" : "s"}).`;
      const photoResult = await uploadPendingPhotos(payload.saved_groups || []);
      await loadDaily();
      if (photoResult.failed) showAlert("warning", `${successText} ${photoResult.uploaded} pending photo${photoResult.uploaded === 1 ? "" : "s"} uploaded. ${photoResult.failed} pending photo${photoResult.failed === 1 ? "" : "s"} could not be uploaded.`);
      else if (photoResult.uploaded) showAlert("success", `${successText} ${photoResult.uploaded} pending photo${photoResult.uploaded === 1 ? "" : "s"} uploaded.`);
      else showAlert("success", successText);
    } catch (error: any) {
      showAlert("error", error.message || "Could not save Engineer Daily Labour.");
    } finally {
      setSaving(false);
    }
  }

  function renderLabourTable(tableRows: any[], options: { selectable?: boolean; group?: any } = {}) {
    const canModifyGroup = options.group && !readOnly && options.group.status === "draft";
    return (
      <div className="overflow-x-auto">
        <table className="min-w-[980px] w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              {options.selectable && <th className="w-12 px-3 py-3">Select</th>}
              {canModifyGroup && <th className="w-12 px-3 py-3">Remove</th>}
              {["Contractor", "Labour Name", "Category / Trade", "Daily Rate", "Site In Time", "First Half", "Second Half", "OT Hours", "Bonus Hours"].map((heading) => <th key={heading} className="px-3 py-3">{heading}</th>)}
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row) => (
              <tr key={row.labour_worker_id} className="border-t">
                {options.selectable && (
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={selectedWorkerIds.includes(row.labour_worker_id)}
                      disabled={readOnly || saving}
                      onChange={() => toggleSelectedWorker(row.labour_worker_id)}
                      aria-label={`Select ${row.worker_name || "labourer"}`}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                  </td>
                )}
                {canModifyGroup && (
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      onClick={() => removeWorkerFromGroup(options.group, row.labour_worker_id)}
                      disabled={saving}
                      aria-label={`Remove ${row.worker_name || "labourer"} from group`}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-red-200 bg-white text-red-700 disabled:opacity-60"
                    >
                      ×
                    </button>
                  </td>
                )}
                <td className="px-3 py-3">{row.contractor_name || "-"}</td>
                <td className="px-3 py-3">
                  <div className="font-semibold">{row.worker_name || "-"}</div>
                  <div className="font-mono text-xs text-slate-500">{row.labour_code || "-"}</div>
                </td>
                <td className="px-3 py-3">{row.category_name || "-"}</td>
                <td className="px-3 py-3">{row.daily_rate_label || "Not Set"}</td>
                <td className="px-3 py-3">{formatTime(row.site_in_time)}</td>
                <td className="px-3 py-3">
                  {attendanceToggle(row, "first_shift_status", "First Half")}
                </td>
                <td className="px-3 py-3">
                  {attendanceToggle(row, "second_shift_status", "Second Half")}
                </td>
                <td className="px-3 py-3">
                  <input disabled={readOnly || saving} value={row.ot_hours ?? ""} onChange={(event) => updateRow(row.labour_worker_id, { ot_hours: event.target.value })} className="h-10 w-24 rounded-lg border px-2" inputMode="numeric" />
                </td>
                <td className="px-3 py-3">
                  <input disabled={readOnly || saving} value={row.bonus_hours ?? ""} onChange={(event) => updateRow(row.labour_worker_id, { bonus_hours: event.target.value })} className="h-10 w-24 rounded-lg border px-2" inputMode="numeric" />
                </td>
              </tr>
            ))}
            {!tableRows.length && (
              <tr>
                <td colSpan={(options.selectable ? 1 : 0) + (canModifyGroup ? 1 : 0) + 9} className="px-3 py-6 text-center text-slate-500">No labourers in this section.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  }

  function setAttendance(workerId: string, field: "first_shift_status" | "second_shift_status", value: "present" | "absent") {
    const row = rows.find((item) => item.labour_worker_id === workerId);
    updateRow(workerId, { [field]: row?.[field] === value ? "" : value });
    setInvalidKey((current) => current === `${workerId}:${field === "first_shift_status" ? "first" : "second"}` ? "" : current);
  }

  function attendanceToggle(row: any, field: "first_shift_status" | "second_shift_status", label: "First Half" | "Second Half") {
    const invalid = invalidKey === `${row.labour_worker_id}:${field === "first_shift_status" ? "first" : "second"}`;
    return (
      <div className={`inline-flex rounded-lg border bg-white p-1 ${invalid ? "border-red-500 ring-2 ring-red-100" : "border-slate-200"}`} data-invalid={invalid ? "true" : undefined}>
        {(["present", "absent"] as const).map((value) => {
          const active = row[field] === value;
          const activeClass = value === "present" ? "bg-emerald-600 text-white" : "bg-red-600 text-white";
          return (
            <button
              key={value}
              type="button"
              disabled={readOnly || saving}
              aria-pressed={active}
              aria-label={`${label}: ${value === "present" ? "Present" : "Absent"}`}
              onClick={() => setAttendance(row.labour_worker_id, field, value)}
              className={`h-8 rounded-md px-3 text-xs font-semibold disabled:opacity-60 ${active ? activeClass : "bg-white text-slate-700 hover:bg-slate-50"}`}
            >
              {value === "present" ? "Present" : "Absent"}
            </button>
          );
        })}
      </div>
    );
  }

  function alertStyles(type: NonNullable<AlertState>["type"]) {
    if (type === "error") return { box: "border-red-200 bg-red-50 text-red-900", icon: <AlertTriangle className="h-5 w-5 text-red-600" />, title: "Error" };
    if (type === "warning") return { box: "border-amber-200 bg-amber-50 text-amber-900", icon: <AlertTriangle className="h-5 w-5 text-amber-600" />, title: "Warning" };
    if (type === "success") return { box: "border-emerald-200 bg-emerald-50 text-emerald-900", icon: <CheckCircle2 className="h-5 w-5 text-emerald-600" />, title: "Success" };
    return { box: "border-sky-200 bg-sky-50 text-sky-900", icon: <Info className="h-5 w-5 text-sky-600" />, title: "Info" };
  }

  function renderAlert() {
    if (!alert) return null;
    const styles = alertStyles(alert.type);
    return (
      <div className={`flex items-start gap-3 rounded-lg border p-3 text-sm ${styles.box}`} role={alert.type === "error" ? "alert" : "status"}>
        {styles.icon}
        <div className="min-w-0 flex-1">
          <p className="font-bold">{styles.title}</p>
          <p className="font-semibold">{alert.text}</p>
        </div>
        <button type="button" onClick={() => setAlert(null)} aria-label="Dismiss alert" className="inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-white/70">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  function renderCameraModal() {
    if (!cameraState.open) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4" role="dialog" aria-modal="true" aria-label="Capture site photo">
        <div className="w-full max-w-3xl rounded-lg bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div>
              <h3 className="text-lg font-semibold">Capture Site Photo</h3>
              <p className="text-xs text-slate-500">Use the live camera preview. The ERP will attach server receipt details after upload.</p>
            </div>
            <button type="button" onClick={closeCamera} aria-label="Close camera" className="inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-slate-100">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-3 p-4">
            {cameraState.error ? (
              <div className="flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-900" role="alert">
                <span>{cameraState.error}</span>
                <button type="button" onClick={() => setCameraState((current) => ({ ...current, error: "" }))} aria-label="Dismiss camera error" className="inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-white/70">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : null}
            <div className="overflow-hidden rounded-lg bg-slate-950">
              {cameraState.capturedUrl ? (
                <img src={cameraState.capturedUrl} alt="Captured site photo preview" className="max-h-[60vh] w-full object-contain" />
              ) : (
                <video ref={videoRef} autoPlay playsInline muted className="max-h-[60vh] w-full bg-slate-950 object-contain" />
              )}
            </div>
            {cameraState.starting ? <p className="text-sm font-semibold text-slate-600">Starting camera...</p> : null}
            <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={closeCamera} className="h-10 rounded-lg border bg-white px-4 text-sm font-semibold">Close</button>
              {cameraState.capturedBlob ? (
                <>
                  <button type="button" onClick={retakePhoto} className="h-10 rounded-lg border bg-white px-4 text-sm font-semibold">Retake</button>
                  <button type="button" onClick={useCapturedPhoto} disabled={saving} className="h-10 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white disabled:opacity-60">Use Photo</button>
                </>
              ) : (
                <button type="button" onClick={capturePhoto} disabled={!cameraState.stream || Boolean(cameraState.error) || cameraState.starting} className="h-10 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-60">Capture Photo</button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  useEffect(() => {
    const savedContext = readSelectedLabourContext();
    if (savedContext) {
      setFilters((current) => ({
        ...current,
        company_id: savedContext.company_id,
        site_id: savedContext.site_id,
        engineer_employee_id: "",
        contractor_profile_id: "",
      }));
    }
    setRestoringContext(false);
  }, []);
  useEffect(() => subscribeLabourWorkspaceSummary(setLabourWorkspace), []);
  useEffect(() => {
    if (restoringContext) return;
    const savedContext = readSelectedLabourContext();
    if (selectedLabourContextIsValid(savedContext, labourWorkspace)) return;
    const singleSiteId = resolveSingleLabourSiteId(labourWorkspace);
    if (singleSiteId && !selectedLabourSiteIsValid(filters.site_id, labourWorkspace)) {
      setFilters((current) => ({
        ...current,
        site_id: singleSiteId,
        engineer_employee_id: "",
        contractor_profile_id: "",
      }));
      return;
    }
    if (savedContext && labourWorkspace.pairs.length > 0) clearSelectedLabourContext();
  }, [filters.company_id, filters.site_id, labourWorkspace, restoringContext]);

  useEffect(() => {
    if (videoRef.current && cameraState.stream && !cameraState.capturedUrl) {
      videoRef.current.srcObject = cameraState.stream;
    }
  }, [cameraState.stream, cameraState.capturedUrl]);

  useEffect(() => () => closeCamera(), []);

  useEffect(() => {
    if (restoringContext) return;
    if (!filters.company_id || !filters.site_id || !filters.work_date) return;
    loadDaily({ contextOnly: true });
  }, [filters.company_id, filters.site_id, filters.work_date, restoringContext]);

  return (
    <section className="min-h-screen bg-[#f6f3f5] px-6 py-7 text-slate-950 md:px-10">
      <div className="mx-auto max-w-[1600px] space-y-5">
        <header>
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-sky-600">Labour Operations</p>
          <h1 className="text-3xl font-semibold">Engineer Daily Labour</h1>
          <p className="text-sm text-slate-600">Mark assigned Site-In labour attendance and daily work from one engineer page.</p>
        </header>
        {renderAlert()}
        {sendBackFeedback && (
          <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 shadow-sm">
            <p className="text-base font-bold">Attendance Sent Back</p>
            <div className="mt-2 grid gap-1 md:grid-cols-2">
              <p><span className="font-semibold">Reason:</span> {sendBackFeedback.reason || "No reason recorded."}</p>
              <p><span className="font-semibold">Sent Back By:</span> {sendBackFeedback.sent_back_by_name || sendBackFeedback.sent_back_by_email || "-"}</p>
              <p><span className="font-semibold">Sent Back On:</span> {sendBackFeedback.sent_back_at ? new Date(sendBackFeedback.sent_back_at).toLocaleString("en-IN") : "-"}</p>
              <p><span className="font-semibold">Previous Submitted On:</span> {sendBackFeedback.submitted_at ? new Date(sendBackFeedback.submitted_at).toLocaleString("en-IN") : "-"}</p>
            </div>
            <p className="mt-2 font-semibold">Please correct the attendance and resubmit.</p>
          </section>
        )}
        <div className="grid gap-3 rounded-lg border bg-white p-4 shadow-sm md:grid-cols-7">
          <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Company
            <select disabled={loading || saving} value={filters.company_id} onChange={(event) => resetLoadedState({ company_id: event.target.value, engineer_employee_id: "", contractor_profile_id: "" })} className="mt-1 h-11 w-full rounded-lg border px-3 text-sm font-normal normal-case tracking-normal text-slate-950">
              <option value="">Company</option>
              {lookups.companies.map((company: any) => <option key={company.id} value={company.id}>{company.company_name}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Site
            <select disabled={loading || saving} value={filters.site_id} onChange={(event) => resetLoadedState({ site_id: event.target.value, engineer_employee_id: "", contractor_profile_id: "" })} className="mt-1 h-11 w-full rounded-lg border px-3 text-sm font-normal normal-case tracking-normal text-slate-950">
              <option value="">Site</option>
              {siteOptions.map((site: any) => <option key={site.id} value={site.id}>{site.site_name}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Date
            <input disabled={loading || saving} type="date" value={filters.work_date} onChange={(event) => resetLoadedState({ work_date: event.target.value, engineer_employee_id: "", contractor_profile_id: "" })} className="mt-1 h-11 w-full rounded-lg border px-3 text-sm font-normal normal-case tracking-normal text-slate-950" />
          </label>
          {adminMode ? (
            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Engineer
              <select disabled={loading || saving} value={filters.engineer_employee_id} onChange={(event) => resetLoadedState({ engineer_employee_id: event.target.value, contractor_profile_id: "" })} className="mt-1 h-11 w-full rounded-lg border px-3 text-sm font-normal normal-case tracking-normal text-slate-950">
                <option value="">Engineer</option>
                {lookups.engineers.map((engineer: any) => <option key={engineer.id} value={engineer.id}>{engineer.label}</option>)}
              </select>
            </label>
          ) : (
            <div className="rounded-lg bg-slate-50 p-3 text-sm">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Engineer</p>
              <p className="mt-1 font-semibold">{currentEngineer?.label || "Resolved after load"}</p>
            </div>
          )}
          <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Contractor
            <select disabled={loading || saving} value={filters.contractor_profile_id} onChange={(event) => resetLoadedState({ contractor_profile_id: event.target.value })} className="mt-1 h-11 w-full rounded-lg border px-3 text-sm font-normal normal-case tracking-normal text-slate-950">
              <option value="">All Contractors</option>
              {contractors.map((contractor: any) => <option key={contractor.id} value={contractor.id}>{contractor.contractor_name}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Search
            <div className="mt-1 flex h-11 items-center gap-2 rounded-lg border bg-white px-3">
              <Search className="h-4 w-4 text-slate-400" />
              <input disabled={loading || saving} value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="Code or name" className="min-w-0 flex-1 text-sm font-normal normal-case tracking-normal outline-none" />
            </div>
          </label>
          <button type="button" onClick={() => loadDaily()} disabled={loading || saving || workflowBlocked} className="h-11 self-end rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-60">{loading ? "Loading..." : "Load Daily Labour"}</button>
        </div>

        <div className="rounded-lg border bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-white p-4">
            <div>
              <h2 className="text-lg font-semibold">Daily Labour Register</h2>
              <p className="text-sm text-slate-600">One grouped register for labour attendance, group work and photo evidence.</p>
            </div>
          </div>
          {!filteredRows.length ? (
            <div className="px-3 py-8 text-center text-sm text-slate-500">{hasLoaded ? "No assigned Site-In labour for this engineer/date." : "Select Company, Site, Date and Engineer, then click Load Daily Labour."}</div>
          ) : (
            <div className="space-y-4 p-4">
              <section className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{rows.length} assigned Site-In labourer{rows.length === 1 ? "" : "s"} available.</p>
                    {groups.length ? (
                      <p className="mt-1 text-sm text-slate-600">
                        {unassignedRows().length
                          ? `${unassignedRows().length} labourer${unassignedRows().length === 1 ? "" : "s"} still unassigned.`
                          : "All assigned labourers have been grouped."}
                      </p>
                    ) : (
                      <p className="mt-1 text-sm text-slate-600">No groups created for this engineer/date.</p>
                    )}
                  </div>
                  <button type="button" onClick={openCreateGroup} disabled={readOnly || saving || !unassignedRows().length} className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-60">
                    <Plus className="h-4 w-4" />
                    Create Group
                  </button>
                </div>
              </section>

              {showCreateGroup && (
                <section className="rounded-lg border border-amber-200 bg-amber-50/40">
                  <div className="border-b border-amber-200 px-4 py-3">
                    <h3 className="text-base font-semibold text-amber-900">Create Group</h3>
                    <p className="text-xs text-amber-800">Select unassigned labourers for this group. Group number is generated automatically.</p>
                  </div>
                  <div className="space-y-4 p-4">
                    <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
                      Group Name
                      <input disabled={readOnly || saving} value={draftGroupName} onChange={(event) => setDraftGroupName(event.target.value)} placeholder="Optional name" className="mt-1 h-10 w-80 max-w-full rounded-lg border bg-white px-3 text-sm font-normal normal-case tracking-normal text-slate-950" />
                    </label>
                    <div>
                      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Select Labour</p>
                      {renderLabourTable(unassignedRows(), { selectable: true })}
                    </div>
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={cancelCreateGroup} disabled={saving} className="h-10 rounded-lg border bg-white px-4 text-sm font-semibold disabled:opacity-60">Cancel</button>
                      <button type="button" onClick={addGroup} disabled={readOnly || saving || !selectedWorkerIds.length} className="h-10 rounded-lg bg-amber-700 px-4 text-sm font-semibold text-white disabled:opacity-60">Create Group</button>
                    </div>
                  </div>
                </section>
              )}

              {groups.map((group) => {
                const members = groupMembers(group);
                return (
                  <section key={group.client_id} className="rounded-lg border bg-white">
                    <div className="border-b bg-sky-50 px-4 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-black uppercase tracking-wide text-sky-700">Group {group.group_number}</p>
                          <input disabled={readOnly || saving} value={group.group_name || ""} onChange={(event) => patchGroup(group.client_id, { group_name: event.target.value })} className="mt-1 h-10 w-80 max-w-full rounded-lg border border-sky-200 bg-white px-3 font-semibold" />
                        </div>
                        {!readOnly && group.status === "draft" && (
                          <div className="flex flex-wrap gap-2">
                            <button type="button" onClick={() => openAddLabour(group)} disabled={saving || !unassignedRows().length} className="inline-flex h-9 items-center gap-2 rounded-lg border bg-white px-3 text-xs font-bold text-slate-700 disabled:opacity-60">
                              <Plus className="h-4 w-4" />
                              Add Labour
                            </button>
                            <button type="button" onClick={() => deleteGroup(group)} disabled={saving} className="inline-flex h-9 items-center gap-2 rounded-lg border border-red-200 bg-white px-3 text-xs font-bold text-red-700 disabled:opacity-60">
                              <Trash2 className="h-4 w-4" />
                              Delete Group
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="mt-4 grid gap-3 md:grid-cols-6">
                        <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
                          Work Type
                          <select disabled={readOnly || saving} value={group.work_type} onChange={(event) => patchGroup(group.client_id, { work_type: event.target.value })} className="mt-1 h-10 w-full rounded-lg border bg-white px-2 text-sm font-normal normal-case tracking-normal text-slate-950">
                            <option value="productive">Productive</option>
                            <option value="non_productive">Non Productive</option>
                          </select>
                        </label>
                        <label className="text-xs font-bold uppercase tracking-wide text-slate-500 md:col-span-2">
                          Activity / Description
                          <input disabled={readOnly || saving} value={group.work_description || ""} onChange={(event) => patchGroup(group.client_id, { work_description: event.target.value })} className="mt-1 h-10 w-full rounded-lg border bg-white px-2 text-sm font-normal normal-case tracking-normal text-slate-950" />
                        </label>
                        <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
                          Quantity
                          <input disabled={readOnly || saving} value={group.quantity || ""} onChange={(event) => patchGroup(group.client_id, { quantity: event.target.value })} className="mt-1 h-10 w-full rounded-lg border bg-white px-2 text-sm font-normal normal-case tracking-normal text-slate-950" inputMode="decimal" />
                        </label>
                        <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
                          Unit
                          <select disabled={readOnly || saving} value={group.unit || ""} onChange={(event) => patchGroup(group.client_id, { unit: event.target.value })} className="mt-1 h-10 w-full rounded-lg border bg-white px-2 text-sm font-normal normal-case tracking-normal text-slate-950">
                            <option value="">Unit</option>
                            {unitOptions.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                          </select>
                        </label>
                        <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
                          Remarks
                          <input disabled={readOnly || saving} value={group.remarks || ""} onChange={(event) => patchGroup(group.client_id, { remarks: event.target.value })} className="mt-1 h-10 w-full rounded-lg border bg-white px-2 text-sm font-normal normal-case tracking-normal text-slate-950" />
                        </label>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button type="button" onClick={() => openCamera(group)} disabled={readOnly || saving || group.status !== "draft"} className="inline-flex h-9 items-center gap-2 rounded-lg border bg-white px-3 text-xs font-semibold disabled:opacity-60">
                          <Camera className="h-4 w-4" />
                          Open Camera
                        </button>
                        {(group.photos || []).map((photo: any) => (
                          <div key={photo.id} className="rounded border bg-white px-2 py-1 text-xs">
                            <span className="font-semibold">{photo.original_file_name}</span>
                            <span className="ml-2 text-slate-500">{photo.pending ? "Pending Save Draft" : photo.server_received_at ? new Date(photo.server_received_at).toLocaleString("en-IN") : "ERP timestamp pending"}</span>
                            {photo.uploaded_by_name ? <span className="ml-2 text-slate-500">Captured by {photo.uploaded_by_name}</span> : null}
                            {photo.pending ? (
                              <button type="button" onClick={() => removePendingPhoto(group, photo.id)} disabled={saving} className="ml-2 font-bold text-red-700 disabled:opacity-60">Remove</button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                    {addLabourGroupId === group.client_id && group.status === "draft" && (
                      <div className="border-b border-amber-200 bg-amber-50/40 p-4">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <h4 className="text-sm font-semibold text-amber-900">Add Labour</h4>
                            <p className="text-xs text-amber-800">Only currently unassigned labourers are available.</p>
                          </div>
                          <div className="flex gap-2">
                            <button type="button" onClick={cancelCreateGroup} disabled={saving} className="h-9 rounded-lg border bg-white px-3 text-xs font-semibold disabled:opacity-60">Cancel</button>
                            <button type="button" onClick={() => addLabourToGroup(group)} disabled={saving || !selectedWorkerIds.length} className="h-9 rounded-lg bg-amber-700 px-3 text-xs font-semibold text-white disabled:opacity-60">Add Labour</button>
                          </div>
                        </div>
                        {renderLabourTable(unassignedRows(), { selectable: true })}
                      </div>
                    )}
                    {!members.length && (
                      <div className="border-b bg-white px-4 py-3 text-sm font-semibold text-amber-700">This group has no labourers. Add labourers or delete the group.</div>
                    )}
                    {renderLabourTable(members, { group })}
                  </section>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-3">
          <button type="button" onClick={() => save("save_draft")} disabled={!canSave || readOnly || saving || loading} className="inline-flex h-11 items-center gap-2 rounded-lg border bg-white px-4 text-sm font-semibold disabled:opacity-60">
            <Save className="h-4 w-4" />
            {saving ? "Saving..." : "Save Draft"}
          </button>
          <button type="button" onClick={() => save("submit")} disabled={!canSubmit || readOnly || saving || loading} className="inline-flex h-11 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white disabled:opacity-60">
            <Send className="h-4 w-4" />
            {sendBackFeedback ? "Resubmit Attendance" : "Submit Daily Labour"}
          </button>
        </div>
        {renderCameraModal()}
      </div>
    </section>
  );
}
