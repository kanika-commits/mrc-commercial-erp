import { NextResponse } from "next/server";
import { loadPermissionContext } from "@/lib/serverPermissions";
import { adminClient } from "@/app/api/approvals/_shared";
import { insertDeleteAudit } from "@/lib/serverDeleteAudit";

const text = (value: unknown) => String(value ?? "").trim();

async function loadRows(admin: any, table: string, workOrderId: string) {
  const { data, error } = await admin
    .from(table)
    .select("*")
    .eq("work_order_id", workOrderId);
  if (error && !["42P01", "42703", "PGRST204", "PGRST205"].includes(error.code)) {
    throw error;
  }
  return data || [];
}

async function countLinks(admin: any, table: string, workOrderId: string) {
  const { count, error } = await admin
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("work_order_id", workOrderId);
  if (error && !["42P01", "42703", "PGRST204", "PGRST205"].includes(error.code)) {
    throw error;
  }
  return count || 0;
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    if (process.env.VERCEL_ENV !== "production") {
      return NextResponse.json(
        { error: "Work Order deletion is available only in the Production deployment." },
        { status: 403 },
      );
    }

    const auth = await loadPermissionContext(request);
    if ("response" in auth) return auth.response;
    if (!auth.roleCodes.includes("platform_owner")) {
      return NextResponse.json(
        { error: "Only a Platform Owner can permanently delete a Work Order." },
        { status: 403 },
      );
    }

    const id = text((await params).id);
    if (!id) return NextResponse.json({ error: "Work Order id is required." }, { status: 400 });

    const admin = adminClient();
    const { data: workOrder, error: workOrderError } = await admin
      .from("work_orders")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (workOrderError) throw workOrderError;
    if (!workOrder) return NextResponse.json({ error: "Work Order was not found." }, { status: 404 });

    if (String(workOrder.approval_status || "").toLowerCase() === "approved") {
      return NextResponse.json(
        { error: "Approved Work Orders cannot be deleted from the approval queue." },
        { status: 409 },
      );
    }

    const [raBills, invoices, payments, debitNotes, ledgerEntries, ledgerTransactions, accountLedger, directRequisitions, wageRates, paymentRequisitionLines] = await Promise.all([
      countLinks(admin, "ra_bills", id),
      countLinks(admin, "invoices", id),
      countLinks(admin, "payments", id),
      countLinks(admin, "debit_notes", id),
      countLinks(admin, "ledger_entries", id),
      countLinks(admin, "ledger_transactions", id),
      countLinks(admin, "account_ledger", id),
      countLinks(admin, "accounts_direct_requisitions", id),
      countLinks(admin, "labour_wage_rates", id),
      countLinks(admin, "payment_requisition_lines", id),
    ]);
    if (raBills || invoices || payments || debitNotes || ledgerEntries || ledgerTransactions || accountLedger || directRequisitions || wageRates || paymentRequisitionLines) {
      return NextResponse.json(
        {
          error: "Cannot delete a Work Order with linked financial records.",
          dependencies: { ra_bills: raBills, invoices, payments, debit_notes: debitNotes, ledger_rows: ledgerEntries + ledgerTransactions + accountLedger, direct_requisitions: directRequisitions, wage_rates: wageRates, payment_requisition_lines: paymentRequisitionLines },
        },
        { status: 409 },
      );
    }

    const [items, documents, vendors, changes, driveFolders] = await Promise.all([
      loadRows(admin, "work_order_items", id),
      loadRows(admin, "work_order_documents", id),
      loadRows(admin, "work_order_vendors", id),
      loadRows(admin, "work_order_changes", id),
      loadRows(admin, "work_order_drive_folders", id),
    ]);

    const { data: deleted, error: deleteError } = await admin.rpc("delete_work_order_atomic", {
      p_work_order_id: id,
    });
    if (deleteError) throw deleteError;

    await insertDeleteAudit(admin, auth.user, {
      organizationId: workOrder.organization_id,
      moduleCode: "work_orders",
      documentType: "Work Order",
      documentId: id,
      documentNumber: workOrder.wo_number,
      deletionReason: "Platform Owner deleted from Work Order Approval.",
      recordSnapshot: deleted || workOrder,
      relatedSnapshot: { items, documents, vendors, changes, drive_folders: driveFolders },
      fileSnapshot: { storageFilesPreserved: true, driveFilesPreserved: true },
    });

    return NextResponse.json({ deleted: true, id });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to delete Work Order." }, { status: 500 });
  }
}
