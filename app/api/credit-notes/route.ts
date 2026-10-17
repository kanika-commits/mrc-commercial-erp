import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireDeletePermission } from "@/lib/serverDeleteAudit";
import { requirePermission } from "@/lib/serverPermissions";
import { recordAuditEvent } from "@/lib/auditEvent";
import { optimizeUploadFile } from "@/lib/fileOptimization";
import { loadActorOrganizationScope, isInOrganizationScope } from "@/lib/serverOrganizationScope";
import { uploadCreditNoteFile, creditNoteSupportingFileName, findCreditNoteFileInDebitNotesFolder } from "@/lib/creditNoteDriveFiling.server";

const MODULE = "credit_notes";
const BUCKET = "credit-note-documents";

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

function fail(error: string, status = 400) { return NextResponse.json({ error }, { status }); }
function userName(user: any) { return user.user_metadata?.full_name || user.user_metadata?.name || user.email || "User"; }
function safeFileName(value: string) { return value.replace(/[^a-zA-Z0-9._-]/g, "_"); }

async function fileCreditNoteSupportingDocuments(client: any, note: any, documents: any[]) {
  const folder = await client
    .from("work_order_drive_folders")
    .select("debit_notes_folder_id")
    .eq("work_order_id", note.work_order_id)
    .eq("organization_id", note.organization_id)
    .maybeSingle();
  if (folder.error) throw folder.error;
  if (!folder.data?.debit_notes_folder_id) throw new Error("Work Order Google Drive Debit Notes folder was not found.");
  const storedDocuments = documents || [];
  const filedDocuments: any[] = [];
  for (let index = 0; index < storedDocuments.length; index += 1) {
    const document = storedDocuments[index];
    const storagePath = String(document.file_url || "").replace(/^\/+/, "");
    if (!storagePath || storagePath.startsWith("http")) throw new Error(`Credit Note attachment ${document.file_name || "document"} has no valid Storage key.`);
    const fileName = creditNoteSupportingFileName(note.credit_note_number, index + 1, document.file_name || "document");
    const existing = await findCreditNoteFileInDebitNotesFolder({ debitNotesFolderId: folder.data.debit_notes_folder_id, fileName });
    if (existing) { filedDocuments.push(existing); continue; }
    const downloaded = await client.storage.from(BUCKET).download(storagePath);
    if (downloaded.error || !downloaded.data) throw new Error(`Credit Note supporting document ${document.file_name || "attachment"} could not be read.`);
    const bytes = Buffer.from(await downloaded.data.arrayBuffer());
    await uploadCreditNoteFile({
      debitNotesFolderId: folder.data.debit_notes_folder_id,
      fileName,
      mimeType: downloaded.data.type || "application/octet-stream",
      base64: bytes.toString("base64"),
    });
    const verified = await findCreditNoteFileInDebitNotesFolder({ debitNotesFolderId: folder.data.debit_notes_folder_id, fileName });
    if (!verified) throw new Error(`Credit Note file ${fileName} was uploaded but could not be verified in the destination folder.`);
    filedDocuments.push(verified);
  }
  return { folder_id: folder.data.debit_notes_folder_id, supporting_documents_filed: storedDocuments.length, files: filedDocuments.map((file) => ({ file_name: file.file_name, file_url: file.file_url, file_id: file.file_id })) };
}

async function scopedNote(client: ReturnType<typeof admin>, id: string, auth: any) {
  const { data, error } = await client.from("credit_notes").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return { error: fail("Credit Note was not found.", 404) };
  const scope = await loadActorOrganizationScope(client, auth);
  if (!isInOrganizationScope(scope, data.organization_id)) return { error: fail("You do not have access to this organization.", 403) };
  return { note: data };
}

export async function GET(request: Request) {
  const auth = await requirePermission(request, MODULE, "view");
  if ("response" in auth) return auth.response;
  const client = admin();
  const id = new URL(request.url).searchParams.get("credit_note_id")?.trim();
  const nextNumber = new URL(request.url).searchParams.get("next_number") === "1";
  if (nextNumber) {
    const scope = await loadActorOrganizationScope(client, auth);
    let query = client.from("credit_notes").select("credit_note_number,organization_id,approval_status");
    if (scope !== null) query = scope.length ? query.in("organization_id", scope) : query.eq("organization_id", "00000000-0000-0000-0000-000000000000");
    const { data, error } = await query;
    if (error) return fail(error.message, 500);
    const maximum = (data || []).filter((note: any) => String(note.approval_status || "").toLowerCase() !== "rejected").reduce((max: number, note: any) => {
      if (String(note.credit_note_number || "").trim() && String(note.credit_note_number).trim().match(/^\d+$/)) return Math.max(max, Number(note.credit_note_number));
      return max;
    }, 0);
    return NextResponse.json({ next_number: String(maximum + 1) });
  }
  if (id) {
    const found = await scopedNote(client, id, auth);
    if (found.error) return found.error;
    const { data: workOrder } = await client.from("work_orders").select("id, organization_id, wo_number, wo_value, wo_date, company_id, site_id").eq("id", found.note.work_order_id).eq("organization_id", found.note.organization_id).maybeSingle();
    const [{ data: company }, { data: site }, { data: vendor }] = await Promise.all([
      workOrder?.company_id ? client.from("companies").select("id, company_name").eq("id", workOrder.company_id).maybeSingle() : Promise.resolve({ data: null }),
      workOrder?.site_id ? client.from("sites").select("id, site_name").eq("id", workOrder.site_id).maybeSingle() : Promise.resolve({ data: null }),
      found.note.vendor_id ? client.from("vendors").select("id, vendor_name").eq("id", found.note.vendor_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const [{ data: documents }, { data: rejections }] = await Promise.all([
      client.from("credit_note_documents").select("*").eq("credit_note_id", id),
      client.from("credit_note_rejections").select("*").eq("credit_note_id", id).order("rejected_at", { ascending: false }),
    ]);
    const latestRejection = rejections?.[0] || null;
    return NextResponse.json({ note: { ...found.note, rejection_reason: latestRejection?.rejection_reason || null, work_order: workOrder ? { ...workOrder, company, site } : null, vendor }, documents: documents || [], rejections: rejections || [] });
  }
  const scope = await loadActorOrganizationScope(client, auth);
  let listQuery = client.from("credit_notes").select("*").order("created_at", { ascending: false });
  if (scope !== null) listQuery = scope.length ? listQuery.in("organization_id", scope) : listQuery.eq("organization_id", "00000000-0000-0000-0000-000000000000");
  const { data, error } = await listQuery;
  if (error) return fail(error.message, 500);
  const notes = data || [];
  const workOrderIds = Array.from(new Set(notes.map((note: any) => note.work_order_id).filter(Boolean)));
  const { data: workOrders, error: workOrderError } = workOrderIds.length
    ? await client.from("work_orders").select("id, organization_id, wo_number, company_id, site_id").in("id", workOrderIds)
    : { data: [], error: null };
  if (workOrderError) return fail(workOrderError.message, 500);
  const workOrderMap = new Map((workOrders || []).filter((workOrder: any) => notes.some((note: any) => note.work_order_id === workOrder.id && note.organization_id === workOrder.organization_id)).map((workOrder: any) => [workOrder.id, workOrder]));
  return NextResponse.json({ notes: notes.map((note: any) => ({ ...note, work_order: workOrderMap.get(note.work_order_id) || null })) });
}

export async function POST(request: Request) {
  const auth = await requirePermission(request, MODULE, "add");
  if ("response" in auth) return auth.response;
  const form = await request.formData();
  const workOrderId = String(form.get("work_order_id") || "").trim();
  const raBillId = String(form.get("ra_bill_id") || "").trim() || null;
  const number = String(form.get("credit_note_number") || "").trim();
  const date = String(form.get("credit_note_date") || "").trim() || null;
  const type = String(form.get("credit_note_type") || "").trim();
  const reason = String(form.get("reason") || "").trim();
  const amount = Number(form.get("gross_amount") || 0);
  if (!workOrderId || !number || !date || !type || !reason || !Number.isFinite(amount) || amount <= 0) return fail("Work Order, number, date, type, reason, and a positive amount are required.");
  const client = admin();
  const { data: wo, error: woError } = await client.from("work_orders").select("id, organization_id, company_id, site_id, wo_number, status, approval_status").eq("id", workOrderId).maybeSingle();
  if (woError) return fail(woError.message, 500);
  if (!wo) return fail("Selected Work Order was not found.", 404);
  const scope = await loadActorOrganizationScope(client, auth);
  if (!isInOrganizationScope(scope, wo.organization_id)) return fail("You do not have access to this organization.", 403);
  const { data: links, error: linkError } = await client.from("work_order_vendors").select("vendor_id, is_primary").eq("work_order_id", workOrderId).order("is_primary", { ascending: false });
  if (linkError) return fail(linkError.message, 500);
  const vendorId = String(form.get("vendor_id") || links?.[0]?.vendor_id || "").trim();
  if (!vendorId || !links?.some((link: any) => link.vendor_id === vendorId)) return fail("Vendor is not linked to this Work Order.");
  if (raBillId) {
    const { data: bill } = await client.from("ra_bills").select("id, organization_id, work_order_id").eq("id", raBillId).maybeSingle();
    if (!bill || bill.organization_id !== wo.organization_id || bill.work_order_id !== workOrderId) return fail("Selected RA Bill is not available for this Work Order.", 403);
  }
  const { data: duplicate } = await client.from("credit_notes").select("id").eq("organization_id", wo.organization_id).ilike("credit_note_number", number).neq("approval_status", "Rejected").maybeSingle();
  if (duplicate) return fail("Credit Note number already exists.", 409);
  const { data: note, error } = await client.from("credit_notes").insert({ organization_id: wo.organization_id, work_order_id: workOrderId, ra_bill_id: raBillId, vendor_id: vendorId, credit_note_number: number, credit_note_date: date, credit_note_type: type, reason, gross_amount: Math.round(amount), gst_amount: 0, total_amount: Math.round(amount), status: "Draft", approval_status: "Pending", created_by_name: userName(auth.user), created_by_email: auth.user.email }).select("id").single();
  if (error) return fail(error.message, error.code === "23505" ? 409 : 500);
  for (const item of form.getAll("attachments")) {
    if (!(item instanceof File) || item.size === 0) continue;
    const optimized = await optimizeUploadFile(Buffer.from(await item.arrayBuffer()), item.type || "application/octet-stream", item.name);
    const path = `${wo.organization_id}/pending/${note.id}/${Date.now()}-${safeFileName(item.name)}`;
    const { error: uploadError } = await client.storage.from(BUCKET).upload(path, optimized.buffer, { contentType: optimized.mimeType || item.type || "application/octet-stream", upsert: false });
    if (uploadError) return fail(uploadError.message, 500);
    const { error: documentError } = await client.from("credit_note_documents").insert({ organization_id: wo.organization_id, credit_note_id: note.id, file_name: item.name, file_url: path });
    if (documentError) return fail(documentError.message, 500);
  }
  await recordAuditEvent(client, auth.user, { organizationId: wo.organization_id, companyId: wo.company_id, siteId: wo.site_id, moduleCode: MODULE, entityType: "credit_note", recordId: note.id, recordNumber: number, parentEntityType: "work_order", parentRecordId: workOrderId, action: "create", actionCategory: "create", activityLabel: "Created Credit Note", description: `Created Credit Note ${number}.`, workflowStage: "Pending Approval", reason }, request).catch(() => undefined);
  return NextResponse.json({ id: note.id });
}

export async function PATCH(request: Request) {
  const id = new URL(request.url).searchParams.get("credit_note_id")?.trim();
  if (!id) return fail("credit_note_id is required.");
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "").trim().toLowerCase();
  const reason = String(body.rejection_reason || body.reason || "").trim();
  if (!["approved", "rejected", "retry_filing"].includes(action)) return fail("Approval action must be Approved, Rejected, or Retry filing.");
  if (action === "rejected" && reason.length < 10) return fail("Reason must be at least 10 characters for Reject.");
  const auth = await requirePermission(request, "credit_notes", action === "rejected" ? "reject" : "approve");
  if ("response" in auth) return auth.response;
  const client = admin();
  const found = await scopedNote(client, id, auth);
  if (found.error) return found.error;
  const note = found.note;
  if (action === "retry_filing") {
    if (String(note.approval_status || "").toLowerCase() !== "approved") return fail("Only approved Credit Notes can retry Drive filing.", 409);
    await client.from("credit_notes").update({ drive_filing_status: "in_progress", drive_filing_error: null }).eq("id", id).eq("organization_id", note.organization_id);
    try {
      const { data: documents, error: documentsError } = await client.from("credit_note_documents").select("id,file_name,file_url,uploaded_at").eq("credit_note_id", id).eq("organization_id", note.organization_id).order("uploaded_at", { ascending: true });
      if (documentsError) throw documentsError;
      const filing = await fileCreditNoteSupportingDocuments(client, note, documents || []);
      await client.from("credit_notes").update({ drive_filing_status: "filed", drive_filing_error: null }).eq("id", id).eq("organization_id", note.organization_id);
      return NextResponse.json({ approved: true, retried: true, filing });
    } catch (filingError: any) {
      const filingMessage = filingError.message || "Credit Note approved, but Drive filing failed; retry filing.";
      await client.from("credit_notes").update({ drive_filing_status: "failed", drive_filing_error: filingMessage }).eq("id", id).eq("organization_id", note.organization_id);
      return NextResponse.json({ approved: true, retried: true, filing_failed: true, error: filingMessage });
    }
  }
  if (String(note.approval_status || "").toLowerCase() !== "pending") return fail("Only pending Credit Notes can be reviewed.", 409);
  const { data: linkedWorkOrder, error: linkedWorkOrderError } = await client.from("work_orders").select("id, organization_id").eq("id", note.work_order_id).maybeSingle();
  if (linkedWorkOrderError) return fail(linkedWorkOrderError.message, 500);
  if (!linkedWorkOrder || linkedWorkOrder.organization_id !== note.organization_id) return fail("Credit Note Work Order is not available in this organization.", 403);
  const now = new Date().toISOString();
  const actor = userName(auth.user);
  if (action === "rejected") {
    const { error: rejectionError } = await client.from("credit_note_rejections").insert({ organization_id: note.organization_id, credit_note_id: id, rejected_by_name: actor, rejected_by_email: auth.user.email, rejection_reason: reason, rejected_at: now });
    if (rejectionError) return fail(rejectionError.message, 500);
  }
  const update = action === "approved" ? { status: "Approved", approval_status: "Approved", approved_by_name: actor, approved_by_email: auth.user.email, approved_at: now, drive_filing_status: "in_progress", drive_filing_error: null } : { status: "Rejected", approval_status: "Rejected", rejected_by_name: actor, rejected_by_email: auth.user.email, rejected_at: now };
  const { error } = await client.from("credit_notes").update(update).eq("id", id);
  if (error) return fail(error.message, 500);
  await client.from("credit_note_audit").insert({ organization_id: note.organization_id, credit_note_id: id, credit_note_number: note.credit_note_number, action, reason: action === "rejected" ? reason : null, actor_id: auth.user.id, actor_email: auth.user.email, prior_status: note.approval_status, new_status: update.approval_status });
  if (action === "approved") {
    return NextResponse.json({ approved: true, filing_status: "pending" });
  }
  if (action === "rejected") {
    const { data: documents } = await client.from("credit_note_documents").select("id,file_url,file_name").eq("credit_note_id", id).eq("organization_id", note.organization_id);
    const paths = (documents || []).map((document: any) => String(document.file_url || "").replace(/^\/+/, "")).filter((path: string) => path && !path.startsWith("http"));
    if (paths.length) {
      const { error: cleanupError } = await client.storage.from(BUCKET).remove(paths);
      if (cleanupError) {
        await client.from("credit_notes").update({ drive_filing_status: "cleanup_failed", drive_filing_error: cleanupError.message }).eq("id", id).eq("organization_id", note.organization_id);
        return NextResponse.json({ rejected: true, cleanup_failed: true, error: cleanupError.message });
      }
      await client.from("credit_notes").update({ drive_filing_status: "not_started", drive_filing_error: null }).eq("id", id).eq("organization_id", note.organization_id);
    }
  }
  return NextResponse.json({ rejected: true });
}

export async function PUT(request: Request) {
  const auth = await requirePermission(request, MODULE, "edit");
  if ("response" in auth) return auth.response;
  const id = new URL(request.url).searchParams.get("credit_note_id")?.trim();
  const body = await request.json().catch(() => ({}));
  if (!id) return fail("credit_note_id is required.");
  const client = admin();
  const found = await scopedNote(client, id, auth);
  if (found.error) return found.error;
  if (String(found.note.approval_status).toLowerCase() !== "pending") return fail("Only pending Credit Notes can be edited.", 409);
  const amount = Number(body.gross_amount || 0);
  const update = { credit_note_number: String(body.credit_note_number || "").trim(), credit_note_date: String(body.credit_note_date || "").trim(), credit_note_type: String(body.credit_note_type || "").trim(), reason: String(body.reason || "").trim(), gross_amount: amount, total_amount: amount };
  if (!update.credit_note_number || !update.credit_note_date || !update.credit_note_type || !update.reason || !Number.isFinite(amount) || amount <= 0) return fail("Credit Note number, date, type, reason, and a positive amount are required.");
  const { error } = await client.from("credit_notes").update(update).eq("id", id);
  if (error) return fail(error.message, 500);
  return NextResponse.json({ id, updated: true });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("credit_note_id")?.trim();
  const body = await request.json().catch(() => ({}));
  const reason = String(body.deletion_reason || body.reason || "").trim();
  if (!id || reason.length < 10) return fail("Credit Note ID and a deletion reason of at least 10 characters are required.");
  const userAuth = await requirePermission(request, MODULE, "delete");
  if ("response" in userAuth) return userAuth.response;
  const client = admin();
  const permission = await requireDeletePermission(client, userAuth.user, MODULE).catch((error) => ({ error }));
  if ("error" in permission) return fail("You are not authorized to delete this Credit Note.", 403);
  const found = await scopedNote(client, id, userAuth);
  if (found.error) return found.error;
  const note = found.note;
  const { data: documents } = await client.from("credit_note_documents").select("*").eq("credit_note_id", id);
  const { error: deleteError } = await client.from("credit_notes").delete().eq("id", id);
  if (deleteError) return fail(deleteError.message, 500);
  await client.from("credit_note_audit").insert({ organization_id: note.organization_id, credit_note_id: id, credit_note_number: note.credit_note_number, action: "delete", reason, actor_id: userAuth.user.id, actor_email: userAuth.user.email, prior_status: note.approval_status, new_status: "Deleted" });
  return NextResponse.json({ deleted: true, documents: documents || [], audited: true });
}
