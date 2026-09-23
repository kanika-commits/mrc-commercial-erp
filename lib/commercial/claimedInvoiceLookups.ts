const INVOICE_WORK_ORDER_BATCH_SIZE = 50;

/** Load claimed invoices without building an oversized PostgREST `in` URL. */
export async function loadClaimedInvoicesForWorkOrders(admin: any, workOrderIds: string[]) {
  const invoices: any[] = [];

  for (let index = 0; index < workOrderIds.length; index += INVOICE_WORK_ORDER_BATCH_SIZE) {
    const workOrderIdBatch = workOrderIds.slice(index, index + INVOICE_WORK_ORDER_BATCH_SIZE);
    const { data, error } = await admin
      .from("invoices")
      .select("id, invoice_number, work_order_id, vendor_id, invoice_amount, itc_status")
      .in("work_order_id", workOrderIdBatch)
      .ilike("itc_status", "claimed")
      .order("invoice_number");

    if (error) throw error;
    invoices.push(...(data || []));
  }

  return invoices.sort((left, right) =>
    String(left.invoice_number || "").localeCompare(String(right.invoice_number || "")),
  );
}
