import { NextResponse } from "next/server";
import { loadPermissionContext } from "@/lib/serverPermissions";
import { adminClient } from "@/app/api/approvals/_shared";
import { insertDeleteAudit } from "@/lib/serverDeleteAudit";

const optional = new Set(["42P01", "42703", "PGRST204", "PGRST205"]);
async function countLinks(admin: any, table: string, id: string) {
  const result = await admin.from(table).select("id", { count: "exact", head: true }).eq("work_order_id", id);
  if (result.error && !optional.has(result.error.code)) throw result.error;
  return result.count || 0;
}
async function loadRows(admin: any, table: string, id: string) {
  const result = await admin.from(table).select("*").eq("work_order_id", id);
  if (result.error && !optional.has(result.error.code)) throw result.error;
  return result.data || [];
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (process.env.VERCEL_ENV !== "production") return NextResponse.json({ error: "Work Order deletion is available only in the Production deployment." }, { status: 403 });
    const auth = await loadPermissionContext(request);
    if ("response" in auth) return auth.response;
    if (!auth.roleCodes.includes("platform_owner")) return NextResponse.json({ error: "Only a Platform Owner can permanently delete a Work Order." }, { status: 403 });
    const id = String((await params).id || "").trim();
    if (!id) return NextResponse.json({ error: "Work Order id is required." }, { status: 400 });
    const admin = adminClient();
    const { data: workOrder, error: workOrderError } = await admin.from("work_orders").select("*").eq("id", id).maybeSingle();
    if (workOrderError) throw workOrderError;
    if (!workOrder) return NextResponse.json({ error: "Work Order was not found." }, { status: 404 });
    const financialTables = ["ra_bills", "invoices", "payments", "debit_notes", "ledger_entries", "ledger_transactions", "account_ledger", "accounts_direct_requisitions", "labour_wage_rates", "payment_requisition_lines"];
    const financialCounts = await Promise.all(financialTables.map((table) => countLinks(admin, table, id)));
    if (financialCounts.some(Boolean)) return NextResponse.json({ error: "Cannot delete a Work Order with linked financial records." }, { status: 409 });
    const [items, documents, vendors, changes, driveFolders] = await Promise.all(["work_order_items", "work_order_documents", "work_order_vendors", "work_order_changes", "work_order_drive_folders"].map((table) => loadRows(admin, table, id)));
    const { data: deleted, error: deleteError } = await admin.rpc("delete_work_order_atomic", { p_work_order_id: id });
    if (deleteError) throw deleteError;
    await insertDeleteAudit(admin, auth.user, { organizationId: workOrder.organization_id, moduleCode: "work_orders", documentType: "Work Order", documentId: id, documentNumber: workOrder.wo_number, deletionReason: "Platform Owner deleted from Work Order Management register.", recordSnapshot: deleted || workOrder, relatedSnapshot: { items, documents, vendors, changes, drive_folders: driveFolders }, fileSnapshot: { storageFilesPreserved: true, driveFilesPreserved: true } });
    return NextResponse.json({ deleted: true, id });
  } catch (error: any) { return NextResponse.json({ error: error.message || "Failed to delete Work Order." }, { status: 500 }); }
}
