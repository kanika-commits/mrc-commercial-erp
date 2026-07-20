import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission } from "@/lib/serverPermissions";

const ACTIVE_MRC_ORGANIZATION_ID = "3b65abde-9f9f-4f1b-bd40-fa261a76920b";

function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const permission = await requirePermission(request, "organizations", "edit");

    if ("response" in permission) {
      return permission.response;
    }

    const { id } = await params;
    const payload = await request.json().catch(() => ({}));
    const name = String(payload.name || "").trim();
    const code = String(payload.code || "").trim();
    const status = String(payload.status || "active").trim() || "active";

    if (!name) {
      return NextResponse.json(
        { error: "Organization name is required." },
        { status: 400 }
      );
    }

    if (!code) {
      return NextResponse.json(
        { error: "Organization code is required." },
        { status: 400 }
      );
    }

    const admin = adminClient();
    const { error } = await admin
      .from("organizations")
      .update({ name, code, status })
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ organization_id: id });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to update organization." },
      { status: 500 }
    );
  }
}

async function getLinkedCount(
  admin: ReturnType<typeof adminClient>,
  table: string,
  organizationId: string
) {
  const { count, error } = await admin
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId);

  if (error) throw error;

  return count || 0;
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const permission = await requirePermission(request, "organizations", "delete");

    if ("response" in permission) {
      return permission.response;
    }

    const { id } = await params;
    const payload = await request.json().catch(() => ({}));
    const deletionReason = String(payload.deletion_reason || "").trim();
    const confirmationText = String(payload.confirmation_text || "").trim();

    if (id === ACTIVE_MRC_ORGANIZATION_ID) {
      return NextResponse.json(
        { error: "The active MRC organization cannot be deleted." },
        { status: 400 }
      );
    }

    if (confirmationText !== "DELETE" && deletionReason.length < 5) {
      return NextResponse.json(
        { error: "Enter a delete reason or type DELETE to confirm." },
        { status: 400 }
      );
    }

    const admin = adminClient();
    const { data: organization, error: organizationError } = await admin
      .from("organizations")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (organizationError) throw organizationError;

    if (!organization) {
      return NextResponse.json(
        { error: "Organization was not found." },
        { status: 404 }
      );
    }

    const [
      companies,
      sites,
      accessAssignments,
      vendors,
      workOrders,
      raBills,
      invoices,
      payments,
      debitNotes,
    ] = await Promise.all([
      getLinkedCount(admin, "companies", id),
      getLinkedCount(admin, "sites", id),
      getLinkedCount(admin, "user_access_assignments", id),
      getLinkedCount(admin, "vendors", id),
      getLinkedCount(admin, "work_orders", id),
      getLinkedCount(admin, "ra_bills", id),
      getLinkedCount(admin, "invoices", id),
      getLinkedCount(admin, "payments", id),
      getLinkedCount(admin, "debit_notes", id),
    ]);

    const linkedCounts = {
      companies,
      sites,
      user_access_assignments: accessAssignments,
      vendors,
      work_orders: workOrders,
      ra_bills: raBills,
      invoices,
      payments,
      debit_notes: debitNotes,
    };
    const hasLinkedRecords = Object.values(linkedCounts).some((count) => count > 0);

    if (hasLinkedRecords) {
      return NextResponse.json(
        {
          error: "Organization cannot be deleted because it has linked records.",
          linked_counts: linkedCounts,
        },
        { status: 409 }
      );
    }

    const { error: deleteError } = await admin
      .from("organizations")
      .delete()
      .eq("id", id);

    if (deleteError) throw deleteError;

    return NextResponse.json({ deleted: true, organization_id: id });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to delete organization." },
      { status: 500 }
    );
  }
}
