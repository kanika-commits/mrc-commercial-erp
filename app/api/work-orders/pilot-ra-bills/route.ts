import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { requirePermission } from "@/lib/serverPermissions";
import { applyOrganizationScope, loadActorOrganizationScope } from "@/lib/serverOrganizationScope";
import { calculatePilotRaBill, validatePilotRaBill } from "@/lib/workOrderPilotRaBill";
import { getPilotOverQuantityPolicy, pilotQuantityLimit, pilotQuantityUsage } from "@/lib/pilotRaBillOverQuantity.server";

const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
function normalizedRaNumber(value: unknown) {
  return String(value || "").trim().toUpperCase();
}
function raNumberPart(value: unknown) {
  const match = normalizedRaNumber(value).match(/^(?:RA-)?(\d{1,})$/);
  return match ? Number(match[1]) : null;
}
function isRejected(status: unknown) {
  return String(status || "").trim().toLowerCase() === "rejected";
}
async function loadDatabaseRaBills(admin: any, organizationId: string, workOrderId: string) {
  const [legacy, pilot] = await Promise.all([
    admin.from("ra_bills").select("ra_number,approval_status").eq("organization_id", organizationId).eq("work_order_id", workOrderId),
    admin.from("work_order_pilot_ra_bills").select("bill_number,status,creation_request_id").eq("organization_id", organizationId).eq("work_order_id", workOrderId).is("deleted_at", null),
  ]);
  if (legacy.error) throw legacy.error;
  if (pilot.error) throw pilot.error;
  return { legacy: legacy.data || [], pilot: pilot.data || [] };
}
function databaseRaNumberParts(bills: { legacy: any[]; pilot: any[] }, creationRequestId?: string) {
  return [
    ...bills.legacy.filter((bill) => !isRejected(bill.approval_status)),
    ...bills.pilot.filter((bill) => !isRejected(bill.status) && (!creationRequestId || bill.creation_request_id !== creationRequestId)),
  ].map((bill) => raNumberPart(bill.ra_number || bill.bill_number)).filter((value): value is number => value !== null);
}
async function pilotAdjustments(admin: any, workOrderId: string, organizationId: string) {
  const [debit, credit] = await Promise.all([
    admin.from("debit_notes").select("total_amount,gross_amount").eq("organization_id", organizationId).eq("work_order_id", workOrderId).ilike("approval_status", "approved").ilike("status", "approved").eq("is_deleted", false),
    admin.from("credit_notes").select("total_amount,gross_amount").eq("organization_id", organizationId).eq("work_order_id", workOrderId).ilike("approval_status", "approved").ilike("status", "approved"),
  ]);
  if (debit.error) throw debit.error;
  if (credit.error) throw credit.error;
  return {
    total_debit_notes: (debit.data || []).reduce((sum: number, row: any) => sum + Number(row.total_amount ?? row.gross_amount ?? 0), 0),
    total_credit_notes: (credit.data || []).reduce((sum: number, row: any) => sum + Number(row.total_amount ?? row.gross_amount ?? 0), 0),
  };
}
async function pilotOrder(admin: any, id: string, scope: string[] | null) {
  let query = admin.from("work_orders").select("id,organization_id,company_id,site_id,wo_number,wo_date,wo_value,gst_percent,approval_status,creation_request_id,standard_terms_snapshot,delivery_snapshot,company:companies(company_name),site:sites(site_name),work_order_vendors(vendor_id,is_primary,vendors(vendor_name)),work_order_items(*)").eq("id", id).eq("approval_status", "approved").not("creation_request_id", "is", null);
  query = applyOrganizationScope(query, scope); if (!query) return null;
  const { data, error } = await query.maybeSingle(); if (error) throw error; if (!data) return null;
  const revision = await admin.from("work_order_pilot_revisions").select("id,revision_number,status,applicable_date,snapshot,snapshot_sha256").eq("work_order_id", id).in("status", ["approved", "issued"]).order("revision_number", { ascending: false }).limit(1).maybeSingle();
  if (revision.error) throw revision.error;
  const effective_revision = revision.data || null;
  const vendorLink = (data.work_order_vendors || []).find((link: any) => link.is_primary) || data.work_order_vendors?.[0];
  return { ...data, vendor_name: vendorLink?.vendors?.vendor_name || null, effective_revision, effective_items: effective_revision?.snapshot?.items || data.work_order_items || [], effective_revision_label: effective_revision ? `Revision ${effective_revision.revision_number} (${effective_revision.status})` : "Original approved Work Order" };
}

export async function GET(request: Request) {
  try {
    const auth = await requirePermission(request, "work_orders", "view"); if ("response" in auth) return auth.response;
    const admin = db(); const scope = await loadActorOrganizationScope(admin, auth);
    const view = new URL(request.url).searchParams.get("view");
    if (view === "deletion_pending") {
      if (!auth.roleCodes.some((role) => ["platform_owner", "super_admin"].includes(role))) return NextResponse.json({ error: "Only a Platform Owner or Super Admin can inspect pending Pilot deletions." }, { status: 403 });
      let auditQuery = admin.from("work_order_pilot_ra_bill_deletion_audit").select("id,ra_bill_id,bill_number,work_order_id,organization_id,prior_status,actor,reason,cleanup_status,cleanup_error,cleanup_updated_at,created_at").in("cleanup_status", ["pending", "external_cleanup", "failed", "ready_for_db_delete", "db_deleted_external_pending"]).order("cleanup_updated_at", { ascending: false });
      auditQuery = applyOrganizationScope(auditQuery, scope); if (!auditQuery) return NextResponse.json({ pending_deletions: [] });
      const audits = await auditQuery; if (audits.error) throw audits.error;
      const auditRows = audits.data || []; const ids = auditRows.map((row: any) => row.ra_bill_id).filter(Boolean);
      if (!ids.length) return NextResponse.json({ pending_deletions: auditRows.map((audit: any) => ({ ...audit, bill: null, failure_stage: "External cleanup" })) });
      let billQuery = admin.from("work_order_pilot_ra_bills").select("id,bill_number,status,organization_id,work_order_id,work_order:work_orders!inner(id,organization_id,creation_request_id,wo_number)").in("id", ids).not("work_order.creation_request_id", "is", null);
      billQuery = applyOrganizationScope(billQuery, scope); if (!billQuery) return NextResponse.json({ pending_deletions: [] });
      const bills = await billQuery; if (bills.error) throw bills.error;
      const byId = new Map((bills.data || []).map((bill: any) => [bill.id, bill]));
      return NextResponse.json({ pending_deletions: auditRows.flatMap((audit: any) => { const bill = byId.get(audit.ra_bill_id); if (!bill && audit.cleanup_status !== "db_deleted_external_pending") return []; if (bill && (bill.organization_id !== audit.organization_id || bill.work_order?.organization_id !== bill.organization_id)) return []; const message = String(audit.cleanup_error || ""); const failure_stage = message.includes("Drive") ? "Drive cleanup" : message.includes("Storage") ? "Storage cleanup" : audit.cleanup_status === "failed" ? "External cleanup" : audit.cleanup_status === "db_deleted_external_pending" ? "Drive/Storage cleanup" : "Pending cleanup"; return [{ ...audit, bill: bill || null, failure_stage }]; }) });
    }
    if (new URL(request.url).searchParams.get("lookup") === "number") {
      const workOrderId = new URL(request.url).searchParams.get("work_order_id");
      const order = workOrderId ? await pilotOrder(admin, workOrderId, scope) : null;
      if (!order) return NextResponse.json({ error: "Only an approved Pilot Work Order may be numbered." }, { status: 404 });
      const bills = await loadDatabaseRaBills(admin, order.organization_id, order.id);
      const next = Math.max(0, ...databaseRaNumberParts(bills)) + 1;
      return NextResponse.json({ suggested_bill_number: `RA-${String(next).padStart(3, "0")}` });
    }
    if (new URL(request.url).searchParams.get("lookup") === "sites") {
      let sites = admin.from("sites").select("id,site_name,site_code,company_id,organization_id,status").eq("status", "active").order("site_name");
      sites = applyOrganizationScope(sites, scope); if (!sites) return NextResponse.json({ sites: [] });
      const result = await sites; if (result.error) throw result.error; return NextResponse.json({ sites: result.data || [] });
    }
    if (new URL(request.url).searchParams.get("lookup") === "work_orders") {
      const siteId = new URL(request.url).searchParams.get("site_id");
      if (!siteId) return NextResponse.json({ work_orders: [] });
      let orders = admin.from("work_orders").select("id,organization_id,site_id,wo_number,approval_status,creation_request_id,gst_percent,wo_value,company:companies(company_name),site:sites(site_name),work_order_items(*)").eq("site_id", siteId).eq("approval_status", "approved").not("creation_request_id", "is", null).order("wo_number");
      orders = applyOrganizationScope(orders, scope); if (!orders) return NextResponse.json({ work_orders: [] });
      const result = await orders; if (result.error) throw result.error;
      const workOrders = [];
      for (const order of result.data || []) {
        const revision = await admin.from("work_order_pilot_revisions").select("id,revision_number,status,applicable_date,snapshot,snapshot_sha256").eq("work_order_id", order.id).in("status", ["approved", "issued"]).order("revision_number", { ascending: false }).limit(1).maybeSingle();
        if (revision.error) throw revision.error;
        const effective_revision = revision.data || null;
        const pendingAudits = await admin.from("work_order_pilot_ra_bill_deletion_audit").select("ra_bill_id,cleanup_status,cleanup_error").eq("organization_id", order.organization_id).in("cleanup_status", ["pending", "external_cleanup", "failed", "ready_for_db_delete"]);
        if (pendingAudits.error) throw pendingAudits.error;
        const pendingIds = (pendingAudits.data || []).map((audit: any) => audit.ra_bill_id).filter(Boolean);
        const pendingDeletion = pendingIds.length ? await admin.from("work_order_pilot_ra_bills").select("id,bill_number").eq("work_order_id", order.id).in("id", pendingIds).maybeSingle() : { data: null, error: null };
        if (pendingDeletion.error) throw pendingDeletion.error;
        const pendingBill = pendingDeletion.data;
        if (pendingBill) {
          const pendingAudit = (pendingAudits.data || []).find((audit: any) => audit.ra_bill_id === pendingBill.id);
          workOrders.push({ ...order, effective_revision, effective_items: effective_revision?.snapshot?.items || order.work_order_items || [], prior_approved: null, deletion_pending: true, deletion_pending_message: "Pilot RA Bill " + pendingBill.bill_number + " is pending external cleanup (" + (pendingAudit?.cleanup_error || pendingAudit?.cleanup_status || "pending") + "). New bills are blocked until deletion is finalized." });
          continue;
        }
        const adjustments = await pilotAdjustments(admin, order.id, order.organization_id);
        const policy = await getPilotOverQuantityPolicy(admin, order.organization_id);
        const prior = await admin.from("work_order_pilot_ra_bills").select("calculation_snapshot,work_order_pilot_ra_bill_items(*)").eq("work_order_id", order.id).eq("status", "approved").is("deleted_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (prior.error) throw prior.error;
        workOrders.push({ ...order, effective_revision, effective_items: effective_revision?.snapshot?.items || order.work_order_items || [], effective_revision_label: effective_revision ? `Revision ${effective_revision.revision_number} (${effective_revision.status})` : "Original approved Work Order", prior_approved: prior.data || null, prior_cumulative_security: Number(prior.data?.calculation_snapshot?.cumulative_security || 0), adjustments, over_quantity_policy: policy });
      }
      return NextResponse.json({ work_orders: workOrders });
    }
    let query = admin.from("work_order_pilot_ra_bills").select("*,work_order:work_orders!inner(id,organization_id,approval_status,creation_request_id,wo_number,company_id,site_id,companies(company_name),sites(site_name),work_order_vendors(is_primary,vendor_id,vendors(vendor_name)))").eq("work_order.approval_status", "approved").not("work_order.creation_request_id", "is", null).is("deleted_at", null).neq("status", "rejected").order("created_at", { ascending: false }); query = applyOrganizationScope(query, scope); if (!query) return NextResponse.json({ bills: [] });
    const { data, error } = await query; if (error) throw error;
    const bills = data || [];
    const ids = bills.map((bill: any) => bill.id);
    const audits = ids.length ? await admin.from("work_order_pilot_ra_bill_deletion_audit").select("ra_bill_id,cleanup_status").in("ra_bill_id", ids).in("cleanup_status", ["pending", "external_cleanup", "failed", "ready_for_db_delete"]) : { data: [], error: null };
    if (audits.error) throw audits.error;
    const pendingIds = new Set((audits.data || []).map((audit: any) => audit.ra_bill_id));
    const activeBills = bills.filter((bill: any) => !pendingIds.has(bill.id));
    const activeIds = activeBills.map((bill: any) => bill.id);
    const cycles = activeIds.length ? await admin.from("work_order_pilot_ra_bill_review_cycles").select("id,ra_bill_id,status,decided_by,decided_at").in("ra_bill_id", activeIds).order("cycle_number", { ascending: false }) : { data: [], error: null };
    if (cycles.error) throw cycles.error;
    const profileIds = [...new Set(activeBills.flatMap((bill: any) => [bill.created_by, ...(cycles.data || []).filter((cycle: any) => cycle.ra_bill_id === bill.id).map((cycle: any) => cycle.decided_by)]).filter(Boolean))];
    const profiles = profileIds.length ? await admin.from("profiles").select("id,full_name,email").in("id", profileIds) : { data: [], error: null };
    if (profiles.error) throw profiles.error;
    const byId = new Map((profiles.data || []).map((profile: any) => [profile.id, profile]));
    return NextResponse.json({ bills: activeBills.map((bill: any) => { const cycle = (cycles.data || []).find((entry: any) => entry.ra_bill_id === bill.id && entry.status === bill.status) || (cycles.data || []).find((entry: any) => entry.ra_bill_id === bill.id); const vendorLink = (bill.work_order?.work_order_vendors || []).find((link: any) => link.is_primary) || bill.work_order?.work_order_vendors?.[0]; return { ...bill, vendor_name: vendorLink?.vendors?.vendor_name || null, submitter: byId.get(bill.created_by) || null, approver: cycle?.decided_by ? byId.get(cycle.decided_by) || null : null, approved_at: bill.approved_at || (cycle?.status === "approved" ? cycle.decided_at : null) }; }) });
  } catch (error: any) { return NextResponse.json({ error: error.message || "Could not load Pilot RA Bills." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const auth = await requirePermission(request, "work_orders", "edit"); if ("response" in auth) return auth.response;
    const body = await request.json(); const admin = db(); const scope = await loadActorOrganizationScope(admin, auth); const order = await pilotOrder(admin, String(body.work_order_id || ""), scope);
    if (!order) return NextResponse.json({ error: "Only an approved Pilot Work Order in your authorized scope may be billed." }, { status: 404 });
    const priorQuery = admin.from("work_order_pilot_ra_bills").select("calculation_snapshot,revision_snapshot,work_order_pilot_ra_bill_items(*)").eq("work_order_id", order.id).eq("status", "approved").is("deleted_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle(); const prior = await priorQuery; if (prior.error) throw prior.error;
    const effectiveItems = order.effective_items || [];
    const submittedItems = Array.isArray(body.items) ? body.items : [];
    const serverItems = effectiveItems.map((item: any, index: number) => ({ ...item, serial: String(item.serial || item.parent_serial || index + 1) }));
    const allowed = new Set(serverItems.map((item: any) => item.serial));
    const seen = new Set<string>();
    for (const item of submittedItems) {
      const serial = String(item?.serial || "");
      if (!allowed.has(serial)) return NextResponse.json({ error: "A submitted Pilot RA Bill item is outside the approved Work Order revision." }, { status: 422 });
      if (seen.has(serial)) return NextResponse.json({ error: "Duplicate Pilot RA Bill item." }, { status: 422 });
      seen.add(serial);
    }
    const previousItems = prior.data?.calculation_snapshot?.items || [];
    const previousLines = prior.data?.work_order_pilot_ra_bill_items || [];
    const priorRevisionItems = prior.data?.revision_snapshot?.snapshot?.items || [];
    const calculationItems = serverItems.map((item: any) => {
      const submitted = submittedItems.find((value: any) => String(value.serial) === item.serial);
      const previous = previousItems.find((value: any) => String(value.serial) === item.serial);
      const previousLine = previousLines.find((value: any) => String(value.parent_serial) === item.serial);
      const priorRevisionItem = priorRevisionItems.find((value: any) => String(value.serial || value.parent_serial) === item.serial);
      const billQty = Number(submitted?.bill_qty ?? 0);
      const previousQty = Number(previous?.cumulative_qty ?? 0);
      if (!Number.isFinite(billQty) || billQty < 0 || previousQty + billQty > Number(item.wo_qty ?? item.quantity ?? 0)) throw new Error(`Invalid quantity for Pilot Work Order item ${item.serial}.`);
      const priorBreakdowns = Array.isArray(previousLine?.breakdowns) ? previousLine.breakdowns : Array.isArray(previous?.breakdowns) ? previous.breakdowns : [];
      const priorRate = Number(priorRevisionItem?.rate ?? priorRevisionItem?.unit_rate ?? previousLine?.rate ?? item.rate ?? item.unit_rate ?? 0);
      const priorById = new Map<string, any>(priorBreakdowns.filter((child: any) => child?.id).map((child: any) => [String(child.id), child] as [string, any]));
      const hasUnsafeParentHistory = Boolean((previousLine?.breakdowns?.length === 0 || !previousLine) && previous && Number(previous.cumulative_amount ?? previous.current_amount ?? 0) > 0);
      const breakdowns = Array.isArray(submitted?.breakdowns) ? submitted.breakdowns.map((child: any, childIndex: number) => {
        const id = String(child.id || crypto.randomUUID());
        const priorChild = priorById.get(id);
        if (priorChild && child.current_qty === undefined) throw new Error(`Pilot breakdown ${id} from this draft lacks a current-period quantity; reopen it before editing so historical progress is not guessed.`);
        const currentQty = Number(child.current_qty ?? (priorChild ? 0 : child.cumulative_qty) ?? 0);
        const priorQty = Number(priorChild?.cumulative_qty || 0);
        if (!Number.isFinite(currentQty) || currentQty < 0 || priorQty + currentQty > Number(item.wo_qty ?? item.quantity ?? 0)) throw new Error(`Invalid quantity for Pilot breakdown ${id}.`);
        const previousAmount = priorChild ? Number(priorChild.cumulative_amount ?? priorChild.current_amount ?? priorRate * priorQty * (Number(priorChild.release_percent || 0) > 1 ? Number(priorChild.release_percent) / 100 : Number(priorChild.release_percent || 0))) : 0;
        return { id, serial: String(child.serial || `${item.serial}.${childIndex + 1}`), description: String(child.description || ""), cumulative_qty: priorQty + currentQty, current_qty: currentQty, release_percent: Number(child.release_percent || 0), previous_amount: previousAmount, remarks: child.remarks ? String(child.remarks) : undefined };
      }) : [];
      if (!breakdowns.length && Number(submitted?.cumulative_qty ?? submitted?.bill_qty ?? 0) <= 0 && Number(submitted?.release_percent ?? 0) > 0) throw new Error(`Release percentage for Pilot Work Order item ${item.serial} must be 0 when executed quantity is 0.`);
      if (breakdowns.length && hasUnsafeParentHistory && !priorBreakdowns.some((child: any) => child?.id)) throw new Error(`Prior approved Pilot RA Bill for item ${item.serial} requires breakdown reconciliation before submission.`);
      const childSerials = new Set<string>();
      const childIds = new Set<string>();
      for (const child of breakdowns) { if (!child.description || !Number.isFinite(child.cumulative_qty) || child.cumulative_qty < 0 || !Number.isFinite(child.release_percent) || child.release_percent < 0 || child.release_percent > 100 || (child.cumulative_qty <= 0 && child.release_percent > 0) || childSerials.has(child.serial) || childIds.has(child.id)) throw new Error(`Invalid or duplicate breakdown for Pilot Work Order item ${item.serial}; release percentage must be 0 when executed quantity is 0.`); childSerials.add(child.serial); childIds.add(child.id); }
      return { ...item, description: item.description || item.item_header_snapshot || item.item_name_snapshot || "", wo_qty: Number(item.wo_qty ?? item.quantity ?? 0), unit: item.unit || item.unit_snapshot || "", rate: Number(item.rate ?? item.unit_rate ?? 0), breakdowns, cumulative_qty: breakdowns.length ? undefined : previousQty + billQty, release_percent: breakdowns.length ? undefined : 1, previous_amount: Number(previous?.cumulative_amount || 0), bill_qty: billQty, remarks: submitted?.remarks ? String(submitted.remarks) : undefined };
    });
    const adjustments = await pilotAdjustments(admin, order.id, order.organization_id);
    const policy = await getPilotOverQuantityPolicy(admin, order.organization_id);
    const priorSecurity = Number(prior.data?.calculation_snapshot?.cumulative_security ?? 0);
    const securityCurrent = Number(body.security_current ?? 0);
    const withheld = Number(body.withheld ?? 0); const labourCess = Number(body.labour_cess ?? 0);
    if (![securityCurrent, withheld, labourCess].every((value) => Number.isFinite(value) && value >= 0)) return NextResponse.json({ error: "Withheld and Labour Cess must be finite, non-negative amounts." }, { status: 422 });
    const calculation = calculatePilotRaBill({ items: calculationItems, gst_percent: order.gst_percent || 0, security_current: securityCurrent, withheld, labour_cess: labourCess, ...adjustments, previous_basic: prior.data?.calculation_snapshot?.cumulative_basic || 0, previous_gst: prior.data?.calculation_snapshot?.cumulative_gst || 0, previous_security: priorSecurity });
    const quantityChecks = pilotQuantityUsage(calculation.items).map((usage: any) => ({ ...usage, limit: pilotQuantityLimit(usage.workOrderQuantity, policy.allowance_percent) }));
    const overQuantity = quantityChecks.some((usage: any) => usage.quantity > usage.workOrderQuantity);
    const aboveAllowance = quantityChecks.some((usage: any) => usage.quantity > usage.limit);
    if (aboveAllowance) return NextResponse.json({ error: "Cumulative quantity exceeds the configured Pilot RA Bill allowance.", quantity_checks: quantityChecks }, { status: 422 });
    const warnings = [...validatePilotRaBill(calculation, order.wo_value || 0), ...(overQuantity ? ["Cumulative quantity exceeds the approved Work Order quantity; this bill requires Super Admin exception approval."] : [])];
    if (calculation.adjusted_net_payable < 0) return NextResponse.json({ error: "Adjusted Net Payable cannot be negative." }, { status: 422 });
    const creationRequestId = String(body.creation_request_id || crypto.randomUUID());
    const billNumber = String(body.bill_number || "").trim().toUpperCase();
    if (!/^RA-\d{3,}$/.test(billNumber)) return NextResponse.json({ error: "RA Bill No. must use the format RA-###." }, { status: 422 });
    const bills = await loadDatabaseRaBills(admin, order.organization_id, order.id);
    if (databaseRaNumberParts(bills, creationRequestId).includes(Number(billNumber.slice(3)))) return NextResponse.json({ error: `RA Bill No. ${billNumber} is already used for this Work Order.` }, { status: 409 });
    const existing = await admin.from("work_order_pilot_ra_bills").select("id,status").eq("organization_id", order.organization_id).eq("creation_request_id", creationRequestId).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data && !["draft", "sent_back"].includes(existing.data.status)) return NextResponse.json({ error: "This Pilot RA Bill is already under review or approved." }, { status: 409 });
    const payload = { organization_id: order.organization_id, work_order_id: order.id, bill_number: billNumber, bill_date: String(body.bill_date || new Date().toISOString().slice(0, 10)), bill_period: body.bill_period || null, status: "draft", creation_request_id: creationRequestId, work_order_snapshot: { ...order, work_order_items: undefined, effective_items: undefined }, revision_snapshot: order.effective_revision || { source: "original_approved_work_order", work_order_id: order.id, items: effectiveItems }, calculation_snapshot: { ...calculation, security_input_version: 2, previous_security: priorSecurity, warnings, over_quantity: overQuantity, quantity_checks: quantityChecks, over_quantity_allowance_percent: policy.allowance_percent }, security_cumulative: calculation.cumulative_security, withheld, labour_cess: labourCess, over_quantity_allowance_percent: policy.allowance_percent, over_quantity_exception_status: overQuantity ? "pending" : "not_required", over_quantity_exception_snapshot: overQuantity ? { allowance_percent: policy.allowance_percent, quantity_checks: quantityChecks } : null, created_by: auth.user.id };
    const { data, error } = await admin.from("work_order_pilot_ra_bills").upsert(payload, { onConflict: "organization_id,creation_request_id" }).select("*").single(); if (error) throw error;
    const lineRows = calculation.items.map((item: any) => ({ ra_bill_id: data.id, parent_serial: item.serial, description: item.description, wo_qty: item.wo_qty, unit: item.unit, rate: item.rate, bill_qty: item.bill_qty, cumulative_qty: item.cumulative_qty, current_amount: item.current_amount, breakdowns: item.breakdowns || [], remarks: item.remarks || null }));
    const { error: lineError } = await admin.from("work_order_pilot_ra_bill_items").delete().eq("ra_bill_id", data.id); if (lineError) throw lineError;
    if (lineRows.length) { const { error: insertError } = await admin.from("work_order_pilot_ra_bill_items").insert(lineRows); if (insertError) throw insertError; }
    return NextResponse.json({ bill: data, warnings });
  } catch (error: any) { return NextResponse.json({ error: error.message || "Could not save Pilot RA Bill draft." }, { status: 500 }); }
}
