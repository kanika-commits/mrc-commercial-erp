import { insertNotificationOnce, resolveNotificationRecipients } from "@/lib/serverNotificationRecipients";

export async function notifyPilotOverQuantityException(admin: any, bill: any) {
  let workOrder = bill.work_order || {};
  if ((!workOrder.company_id || !workOrder.site_id) && bill.work_order_id) {
    const loaded = await admin.from("work_orders").select("organization_id,company_id,site_id").eq("id", bill.work_order_id).eq("organization_id", bill.organization_id).maybeSingle();
    if (loaded.error) throw loaded.error;
    workOrder = loaded.data || workOrder;
  }
  const organizationId = String(bill.organization_id || workOrder.organization_id || "");
  if (!organizationId) throw new Error("Pilot exception notification requires an organization.");
  const recipients = new Set(await resolveNotificationRecipients(admin, { organizationId, companyId: workOrder.company_id, siteId: workOrder.site_id, moduleCode: "work_orders", actionCode: "approve" }));
  for (const recipientUserId of recipients) {
    await insertNotificationOnce(admin, { organization_id: organizationId, recipient_user_id: recipientUserId, notification_type: "pilot_ra_bill_over_quantity_exception", title: "Pilot RA Bill over-quantity exception", message: `Pilot RA Bill ${bill.bill_number || bill.id} requires Super Admin exception approval.`, target_url: `/approvals?pilot_ra_bill=${bill.id}`, related_entity_type: "pilot_ra_bill", related_entity_id: bill.id });
  }
  return { recipient_count: recipients.size };
}
